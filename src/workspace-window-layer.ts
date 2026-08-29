/*
 * Filename: workspace-window-layer.ts
 * FullPath: modules/shells/environment-shell/src/workspace-window-layer.ts
 * Change date and time: 23.10.00_23.08.2026
 * Reason for changes: Defer taskbar rebuild; cache z-boost so open does not force layout.
 * FIND:hang-open
 */
/**
 * WHY: Home (`mountViewModule` into workspace) stays under floating `ui-window`
 * shells; each SpeedDial / desktop `openView` resolves a lazy view module and mounts it
 * into a dedicated frame via {@link mountUiWindow} (z = model + `--env-window-z-boost`).
 *
 * INVARIANT: focus always (1) bumps model.z, (2) sets host z-index, (3) re-appends the
 * node so paint order matches even if a sibling stacking context ignores z alone.
 */
import type { ShellContext, ViewModule, ViewOptions } from "views/types";
import { numberRef } from "@fest-lib/object";
import { resolveOverlayMountPoint as resolveGlobalOverlay, resolveShellOverlaysMount } from "boot/shell-slots";

import {
    createChromeModel,
    type WindowChromeModel
} from "./window/frame/window-shell.ts";
import {
    MARKDOWN_VIEW_MANAGED_WINDOW_KEY,
    normalizeMarkdownViewWindowId,
    isMarkdownViewManagedWindowKey
} from "./window/views/markdown-view-window.ts";
import { mountViewModule } from "./window/views/view-mount.ts";
import { getOrCreateEnvironmentOverlayMount } from "./environment-overlay.ts";
import { mountUiWindow, readEnvWindowZBoost } from "./window/window/mount-ui-window.js";
import type { EnvWindowTaskDescriptor } from "./components/taskbar/element/TaskBar.js";
import { tryLaunchSiblingView } from "fl-ui/speed-dial/action-registry";

/** Direct-child managed window tagged via {@link mountUiWindow}'s `managedViewKey`. */
function findKeyedFrame(workspace: HTMLElement, key: string): HTMLElement | null {
    const selKey =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(key)
            : key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const el =
        workspace.querySelector(`:scope > ui-window[data-ui-window-view="${selKey}"]`) ||
        workspace.querySelector(`:scope > ui-window[data-wf-managed-view="${selKey}"]`) ||
        workspace.querySelector(`:scope > section.wf-frame[data-wf-managed-view="${selKey}"]`);
    return el instanceof HTMLElement ? el : null;
}

const VIEW_ICONS: Record<string, string> = {
    home: "house",
    viewer: "article",
    markdown: "article",
    browser: "globe",
    web: "globe",
    explorer: "books",
    settings: "gear-six",
    apps: "squares-four",
    workcenter: "briefcase",
    history: "clock-counter-clockwise",
    editor: "pencil-simple-line",
    network: "wifi-high",
    task: "list-checks",
    event: "calendar",
    bonus: "gift",
    person: "address-book"
};

export type BuiltInReaderWindow = {
    title?: string;
    /** Pre-built body (e.g. {@link buildViewerView}). */
    content: HTMLElement;
    seed?: Partial<{ x: number; y: number; w: number; h: number; z: number }>;
};

export type WorkspaceViewLoaderMap = Record<string, () => Promise<ViewModule>>;

export type WorkspaceWindowLayerOptions = {
    /**
     * Optional lightweight reader DOM for demos (`buildViewerView`).
     * When omitted, `openView("viewer" | "markdown" | …)` loads full `views/markdown-view` — see `markdown-view-window.ts`.
     */
    readerWindow?: BuiltInReaderWindow;
    /**
     * App root (e.g. `#app` / `.env-shell-root`) when no `cw-shell-*` exists: creates `[data-env-shell-overlays]`
     * for stacking menus/modals above windows (see {@link getOrCreateEnvironmentOverlayMount}).
     */
    overlayMountHost?: HTMLElement | null;
    /** When set, transient UI prefers this host's shadow `[data-shell-overlays]` over `overlayMountHost`. */
    environmentShellHost?: HTMLElement | null;
    /**
     * Host-app view loaders (CWSP: network/settings/…). Merged over built-in package loaders.
     * WHY: hybrid SoT — chrome in modules, CWSP views stay in the app.
     */
    viewLoaders?: WorkspaceViewLoaderMap;
    /** Optional title overrides for managed windows. */
    viewTitles?: Record<string, string>;
    /** Desktop taskbar / tasking: fired when open set or focus changes. */
    onTaskingChange?: (windows: EnvWindowTaskDescriptor[]) => void;
    /**
     * Open these view ids already in `native-mode` (mono `/explorer?native=1`).
     * Empty = never auto-native; host can still promote via `window-native`.
     */
    startNativeViewIds?: string[];
};

type ManagedWindow = {
    key: string;
    model: WindowChromeModel;
    disposeFrame: () => void;
    /** Populated after async view mount; called on close. */
    disposeView?: () => void;
};

const VIEW_TITLES: Record<string, string> = {
    home: "Home",
    viewer: "Markdown",
    browser: "Browser",
    web: "Browser",
    explorer: "Explorer",
    settings: "Settings",
    apps: "Apps",
    workcenter: "Work Center",
    history: "History",
    editor: "Editor",
    network: "Network",
    task: "Plan",
    event: "Events",
    bonus: "Bonuses",
    person: "Contacts"
};

/** Stable managed-window key so each URL can have its own floating frame. */
function browserWindowKey(url: string): string {
    const href = String(url || "").trim();
    if (!href) return "browser";
    let h = 2166136261;
    for (let i = 0; i < href.length; i++) {
        h ^= href.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return `browser:${(h >>> 0).toString(36)}`;
}

function browserTitleFromUrl(url: string): string {
    try {
        const host = new URL(url).hostname.replace(/^www\./i, "");
        return host || "Browser";
    } catch {
        return "Browser";
    }
}

function normalizeBrowserViewId(raw: string): string {
    const id = String(raw || "").trim().toLowerCase();
    if (id === "browser" || id === "web" || id === "iframe" || id === "web-view" || id === "webview") {
        return "browser";
    }
    return id;
}

function iconForManagedKey(key: string): string {
    const id = String(key || "").trim().toLowerCase();
    if (VIEW_ICONS[id]) return VIEW_ICONS[id];
    if (id.startsWith("browser:")) return VIEW_ICONS.browser;
    return "app-window";
}

/**
 * Package-local defaults intentionally empty except built-in browser iframe view.
 * WHY: relative `../../../views/*-view` imports break when this file is consumed via
 * CWSP-shell's symlink (`src/frontend/shells/environment` → modules). Hosts must pass
 * {@link WorkspaceWindowLayerOptions.viewLoaders} (CWSP adapter / demo boot).
 */
function defaultViewLoaderForId(viewId: string): (() => Promise<ViewModule>) | null {
    const id = normalizeBrowserViewId(viewId);
    if (id === "browser") {
        return () => import("./window/views/browser-view.ts") as Promise<ViewModule>;
    }
    return null;
}

function readOpenViewExternalUrl(opts?: ViewOptions | Record<string, unknown> | null): string {
    if (!opts || typeof opts !== "object") return "";
    const o = opts as Record<string, unknown>;
    const nested =
        o.params && typeof o.params === "object" && !Array.isArray(o.params)
            ? (o.params as Record<string, unknown>)
            : {};
    const raw = String(
        nested.url || nested.href || nested.src || o.url || o.href || o.src || ""
    ).trim();
    return raw;
}

function titleForView(viewId: string, overrides?: Record<string, string>): string {
    const id = normalizeMarkdownViewWindowId(viewId) || String(viewId || "").trim().toLowerCase();
    const base = id.startsWith("browser:") ? "browser" : id;
    if (overrides?.[id]) return overrides[id];
    if (overrides?.[base]) return overrides[base];
    if (VIEW_TITLES[base]) return VIEW_TITLES[base];
    const raw = String(viewId || "").trim();
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "View";
}

function placeholderBody(viewId: string, overrides?: Record<string, string>): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "wf-view-placeholder";
    wrap.setAttribute("part", "placeholder");
    wrap.innerHTML = `<p class="wf-view-placeholder__title">${titleForView(viewId, overrides)}</p>
<p class="wf-view-placeholder__hint">No window module is registered for this shortcut in environment-shell yet.</p>`;
    return wrap;
}

export type WorkspaceWindowLayer = {
    shellContext: ShellContext;
    dispose: () => void;
    /** Bring keyed window to front if it exists. */
    focusWindow: (viewId: string) => boolean;
    /** Minimize / collapse a managed window (desktop + mobile). */
    minimizeWindow: (viewId: string) => boolean;
    /** Minimize every managed window (Home / Show desktop). */
    minimizeAllWindows: () => void;
    /** Close / dispose a managed window. */
    closeWindow: (viewId: string) => boolean;
    /** Clear window focus markers (e.g. when Home task is selected). */
    blurWindows: () => void;
    /** Dispose all managed windows (explicit close-all / leave view). */
    closeAllWindows: () => void;
    /** Promote a managed window to `native-mode` (mono/task). */
    enterNative: (viewId: string) => boolean;
    /** Exit native on one view or all. */
    exitNative: (viewId?: string) => void;
    /** Snapshot of open managed windows for taskbar sync. */
    listWindowTasks: () => EnvWindowTaskDescriptor[];
    /** Currently focused managed window key (or null when home / none). */
    getFocusedKey: () => string | null;
};

/**
 * Shell helpers: open registered views in `ui-window` overlays, keep `home` as a workspace underlay.
 */
export function createWorkspaceWindowLayer(
    workspace: HTMLElement,
    options: WorkspaceWindowLayerOptions = {}
): WorkspaceWindowLayer {
    const topZ = numberRef(120);
    const managed = new Map<string, ManagedWindow>();
    let disposed = false;
    let focusedKey: string | null = null;
    // PERF: resolve --env-window-z-boost once while the home layer is already laid out.
    readEnvWindowZBoost(workspace);

    let taskingRaf = 0;
    const emitTasking = (): void => {
        if (disposed) return;
        if (taskingRaf) return;
        taskingRaf = requestAnimationFrame(() => {
            taskingRaf = 0;
            if (!disposed) options.onTaskingChange?.(listWindowTasks());
        });
    };

    const listWindowTasks = (): EnvWindowTaskDescriptor[] => {
        const out: EnvWindowTaskDescriptor[] = [];
        for (const m of managed.values()) {
            if (!findKeyedFrame(workspace, m.key)) continue;
            out.push({
                id: m.key,
                title: m.model.title || titleForView(m.key, options.viewTitles),
                icon: iconForManagedKey(m.key),
                focused: focusedKey === m.key,
                minimized: Boolean(m.model.minimized.value),
                visible: Boolean(m.model.visible.value)
            });
        }
        return out;
    };

    const clearFocusedAttrs = (): void => {
        for (const m of managed.values()) {
            const frame = findKeyedFrame(workspace, m.key);
            if (!frame) continue;
            frame.toggleAttribute("data-focused", false);
            const clear = (frame as HTMLElement & { clearFocused?: () => void }).clearFocused;
            if (typeof clear === "function") clear.call(frame);
        }
    };

    const exitNativeExcept = (keepKey: string | null): void => {
        for (const [k, m] of managed) {
            if (keepKey && k === keepKey) continue;
            if (m.model.nativeMode?.value) {
                m.model.nativeMode.value = false;
            }
        }
    };

    const elevateModel = (model: WindowChromeModel, key: string): void => {
        /*
         * WHY: `Windows2` dispatches `window-focus` on every `pointerdown` inside the window.
         * Without this guard, each click in settings/explorer re-runs `clearFocusedAttrs()`
         * (strips `data-focused` from all windows), `workspace.appendChild(frame)` (DOM move →
         * reflow), and the `applyChrome` effect (z-increment + setVisible). The resulting
         * reflow storm looks like a "reload" and can swallow the very click that triggered it.
         * Skip when already focused + not minimized + already last child (top of paint order).
         */
        if (focusedKey === key && !model.minimized.value) {
            const frame = findKeyedFrame(workspace, key);
            if (frame && frame === workspace.lastElementChild) return;
        }
        topZ.value += 1;
        model.z.value = topZ.value;
        model.minimized.value = false;
        model.visible.value = true;
        focusedKey = key;
        // WHY: only one native mono task at a time.
        if (model.nativeMode?.value) exitNativeExcept(key);

        const frame = findKeyedFrame(workspace, key);
        if (frame) {
            const zBoost = readEnvWindowZBoost(workspace);
            const zNow = (model.z.value ?? 10) + zBoost;
            clearFocusedAttrs();
            frame.style.zIndex = String(zNow);
            frame.toggleAttribute("data-focused", true);
            const bring = (frame as HTMLElement & { bringToFront?: (z: number) => void }).bringToFront;
            if (typeof bring === "function") bring.call(frame, zNow);
            // WHY: DOM order is a reliable paint fallback when siblings share stacking quirks.
            if (frame.parentElement === workspace && frame !== workspace.lastElementChild) {
                workspace.appendChild(frame);
            }
        }
        emitTasking();
    };

    const shellContext: ShellContext = {
        showMessage: (msg: unknown) => {
            console.log(`[environment] ${typeof msg === "string" ? msg : String(msg ?? "")}`);
        }
    };

    const envOverlayMount =
        options.overlayMountHost ? getOrCreateEnvironmentOverlayMount(options.overlayMountHost) : null;

    shellContext.resolveOverlayMountPoint = (anchor) => {
        // WHY: Prefer light-DOM `.env-shell-overlays` (document CSS + z > chrome). Shadow
        // `[data-shell-overlays]` swallows document stylesheets so menus lose position/z-index
        // and paint under the taskbar / mobile nav.
        if (envOverlayMount) return envOverlayMount;
        if (options.environmentShellHost) {
            const fromShell = resolveShellOverlaysMount(options.environmentShellHost);
            if (fromShell) return fromShell;
        }
        return resolveGlobalOverlay(anchor ?? null);
    };

    const viewLoaderForId = (viewId: string): (() => Promise<ViewModule>) | null => {
        const id = normalizeBrowserViewId(
            normalizeMarkdownViewWindowId(viewId) || String(viewId || "").trim().toLowerCase()
        );
        const fromHost = options.viewLoaders?.[id];
        if (fromHost) return fromHost;
        return defaultViewLoaderForId(id);
    };

    const openReaderWindow = (): void => {
        const rw = options.readerWindow;
        if (!rw?.content) return;

        const key = MARKDOWN_VIEW_MANAGED_WINDOW_KEY;
        const ex = managed.get(key);
        if (ex && findKeyedFrame(workspace, key)) {
            elevateModel(ex.model, key);
            return;
        }
        if (ex && !findKeyedFrame(workspace, key)) {
            managed.delete(key);
            try {
                ex.disposeFrame();
            } catch {
                /* detached */
            }
        }

        const seed = rw.seed || {};
        const model = createChromeModel(rw.title || titleForView(key, options.viewTitles), {
            x: seed.x ?? 96,
            y: seed.y ?? 96,
            w: seed.w ?? 420,
            h: seed.h ?? 340,
            z: seed.z ?? topZ.value + 1
        });
        topZ.value = model.z.value;

        let disposeFrame: () => void = () => {};
        disposeFrame = mountUiWindow(workspace, model, rw.content, () => elevateModel(model, key), {
            managedViewKey: key,
            onChromeChange: emitTasking,
            onClose: () => {
                // WHY: delete first so disposeFrame re-entry cannot dispose twice.
                const m = managed.get(key);
                if (!m) return;
                managed.delete(key);
                if (focusedKey === key) focusedKey = null;
                try {
                    m.disposeFrame();
                } catch {
                    /* already detached */
                }
                emitTasking();
            }
        });
        managed.set(key, { key, model, disposeFrame });
        elevateModel(model, key);
    };

    const openViewWindow = (viewId: string, opts?: ViewOptions): void => {
        if (disposed) return;
        let id = normalizeMarkdownViewWindowId(String(viewId || "").trim());
        id = normalizeBrowserViewId(id);
        if (!id || id === "home") return;
        // WHY: airpad removed from environment launcher UI (transport aliases stay elsewhere).
        if (id === "airpad") return;
        // INVARIANT: Capacitor launcher APK must not mount explorer/document in-process.
        // WHY: web u2re.space stamps data-cwsp-sku=launcher too — do not wait on launcher IPC.
        try {
            const native =
                document.documentElement.dataset.cwspNativeShell === "capacitor" ||
                Boolean((globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
            if (document.documentElement.dataset.cwspSku === "launcher" && native) {
                void tryLaunchSiblingView(id).then((launched) => {
                    if (!launched) openViewWindowContinue(id, opts);
                });
                return;
            }
        } catch {
            /* tests */
        }
        openViewWindowContinue(id, opts);
    };

    const openViewWindowContinue = (id: string, opts?: ViewOptions): void => {
        if (disposed) return;

        const params = {
            ...((((opts as ViewOptions | undefined)?.params || {}) as Record<string, string>) || {})
        };
        const externalUrl = readOpenViewExternalUrl(opts);
        if (externalUrl) {
            params.url = externalUrl;
            params.href = externalUrl;
        }
        const managedKey =
            id === "browser"
                ? String(params.windowKey || "").trim() || browserWindowKey(externalUrl)
                : id;

        /* WHY: Demo may pass `readerWindow`; both `viewer` and `markdown` requests collapse to the same key first. */
        if (isMarkdownViewManagedWindowKey(id) && options.readerWindow?.content) {
            openReaderWindow();
            return;
        }

        const startNativeIds = new Set(
            (options.startNativeViewIds || []).map((v) =>
                normalizeMarkdownViewWindowId(String(v || ""))
            )
        );
        const wantNative =
            startNativeIds.has(id) ||
            String((opts as ViewOptions & { native?: unknown })?.native || "") === "1" ||
            String(params.native || "") === "1";

        const existing = managed.get(managedKey);
        if (existing && findKeyedFrame(workspace, managedKey)) {
            elevateModel(existing.model, managedKey);
            /* WHY: reopen / boot navigate must still promote to native immersive. */
            if (wantNative && existing.model.nativeMode) {
                existing.model.nativeMode.value = true;
                existing.model.minimized.value = false;
                existing.model.visible.value = true;
                exitNativeExcept(managedKey);
            }
            /* Re-apply src into an already-open markdown window. */
            if (isMarkdownViewManagedWindowKey(id)) {
                const src = String(params.src || params.source || params.path || "").trim();
                const filename = String(params.filename || params.name || "").trim();
                const content = String(params.content || "");
                if (src || content.trim()) {
                    try {
                        globalThis.dispatchEvent(
                            new CustomEvent("cwsp:document-open", {
                                detail: { src, filename, content }
                            })
                        );
                    } catch {
                        /* viewer listener optional */
                    }
                }
            }
            /* Re-apply URL into an already-open browser iframe (params may have been late). */
            if (id === "browser" && externalUrl) {
                try {
                    const frame = findKeyedFrame(workspace, managedKey);
                    const iframe = frame?.querySelector?.("iframe.wf-browser__frame") as
                        | HTMLIFrameElement
                        | null;
                    const input = frame?.querySelector?.("input.wf-browser__url") as
                        | HTMLInputElement
                        | null;
                    if (iframe && iframe.src !== externalUrl) {
                        iframe.src = externalUrl;
                    }
                    if (input) input.value = externalUrl;
                    if (externalUrl) {
                        try {
                            existing.model.title = browserTitleFromUrl(externalUrl);
                        } catch {
                            /* title optional */
                        }
                    }
                } catch {
                    /* ignore */
                }
            }
            return;
        }
        if (existing && !findKeyedFrame(workspace, managedKey)) {
            /* WHY: `mountViewModule(host.replaceChildren)` on the workspace drops window nodes; reconcile stale refs. */
            existing.disposeView?.();
            managed.delete(managedKey);
            try {
                existing.disposeFrame();
            } catch {
                /* frame already detached */
            }
        }

        const loader = viewLoaderForId(id);
        const body = document.createElement("div");
        body.className = "wf-view-host env-ui-window__view-host";
        body.setAttribute("part", "view-host");
        /* WHY: async import can take a beat — never leave a blank native frame with no feedback. */
        {
            const loading = document.createElement("p");
            loading.className = "wf-view-placeholder__hint";
            loading.style.cssText = "margin:1rem;font:400 .9rem/1.4 system-ui,sans-serif;opacity:.8";
            loading.textContent = `Loading ${titleForView(id, options.viewTitles)}…`;
            body.append(loading);
        }

        const offset = managed.size * 24;
        const title =
            id === "browser" && externalUrl
                ? browserTitleFromUrl(externalUrl)
                : titleForView(id, options.viewTitles);
        const model = createChromeModel(title, {
            x: 72 + offset,
            y: 72 + offset,
            w: id === "browser" ? 720 : 640,
            h: id === "browser" ? 520 : 480,
            z: topZ.value + 1
        });
        topZ.value = model.z.value;

        let disposeFrame: () => void = () => {};
        disposeFrame = mountUiWindow(workspace, model, body, () => elevateModel(model, managedKey), {
            managedViewKey: managedKey,
            startNative: wantNative,
            onChromeChange: emitTasking,
            onClose: () => {
                // WHY: delete first so disposeFrame re-entry cannot dispose twice.
                const m = managed.get(managedKey);
                if (!m) return;
                managed.delete(managedKey);
                if (focusedKey === managedKey) focusedKey = null;
                try {
                    m.disposeView?.();
                } catch {
                    /* view unmount optional */
                }
                try {
                    m.disposeFrame();
                } catch {
                    /* already detached */
                }
                emitTasking();
            }
        });
        if (wantNative) {
            model.nativeMode.value = true;
            exitNativeExcept(managedKey);
        }

        const rec: ManagedWindow = { key: managedKey, model, disposeFrame, disposeView: undefined };
        managed.set(managedKey, rec);
        elevateModel(model, managedKey);

        const mountOpts: ViewOptions = { ...(opts || {}), shellContext };
        if (id === "browser" && externalUrl) {
            mountOpts.params = {
                ...(mountOpts.params || {}),
                url: externalUrl,
                href: externalUrl
            };
        } else if (externalUrl && !(mountOpts.params && (mountOpts.params.url || mountOpts.params.href))) {
            /* Flat opts.url callers (viewer redirect / ShellContext typing). */
            mountOpts.params = {
                ...(mountOpts.params || {}),
                url: externalUrl,
                href: externalUrl
            };
        }

        if (!loader) {
            body.replaceChildren(placeholderBody(id, options.viewTitles));
            return;
        }

        void mountViewModule(loader, body, mountOpts).then(
            (unmountView) => {
                if (disposed) {
                    unmountView();
                    return;
                }
                const cur = managed.get(managedKey);
                if (cur) cur.disposeView = unmountView;
                /*
                 * WHY: boot races (focusHome / minimizeAll / early enterNative) can leave the
                 * frame minimized or non-native before the view finishes mounting — blank window.
                 */
                if (wantNative || model.nativeMode?.value) {
                    model.nativeMode.value = true;
                    model.minimized.value = false;
                    model.visible.value = true;
                    exitNativeExcept(managedKey);
                    elevateModel(model, managedKey);
                }
            },
            (err) => {
                console.error(`[workspace-window-layer] mountViewModule failed for view "${id}"`, err);
                body.replaceChildren(placeholderBody(id, options.viewTitles));
            }
        );
    };

    shellContext.navigate = (viewId, opts) => {
        openViewWindow(String(viewId), opts as ViewOptions | undefined);
    };
    shellContext.openView = (viewId, opts) => {
        openViewWindow(String(viewId), opts as ViewOptions | undefined);
    };

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        if (taskingRaf) {
            cancelAnimationFrame(taskingRaf);
            taskingRaf = 0;
        }
        for (const m of managed.values()) {
            m.disposeView?.();
            m.disposeFrame();
        }
        managed.clear();
        focusedKey = null;
        emitTasking();
    };

    const focusWindow = (viewId: string): boolean => {
        const id = normalizeMarkdownViewWindowId(String(viewId || ""));
        const m = managed.get(id);
        if (!m || !findKeyedFrame(workspace, id)) return false;
        elevateModel(m.model, id);
        return true;
    };

    const minimizeWindow = (viewId: string): boolean => {
        const id = normalizeMarkdownViewWindowId(String(viewId || ""));
        const m = managed.get(id);
        if (!m || !findKeyedFrame(workspace, id)) return false;
        // WHY: Home / taskbar collapse must keep the process for switcher restore (not dispose).
        if (m.model.nativeMode?.value) m.model.nativeMode.value = false;
        if (m.model.desktopMaximized?.value) m.model.desktopMaximized.value = false;
        m.model.visible.value = true;
        m.model.minimized.value = true;
        if (focusedKey === id) {
            focusedKey = null;
            clearFocusedAttrs();
        }
        emitTasking();
        return true;
    };

    /** Collapse all floating views so the launcher shows — apps stay in the switcher. */
    const minimizeAllWindows = (): void => {
        if (disposed) return;
        exitNativeExcept(null);
        focusedKey = null;
        clearFocusedAttrs();
        for (const m of managed.values()) {
            if (!findKeyedFrame(workspace, m.key)) continue;
            if (m.model.desktopMaximized?.value) m.model.desktopMaximized.value = false;
            m.model.visible.value = true;
            m.model.minimized.value = true;
        }
        emitTasking();
    };

    const closeWindow = (viewId: string): boolean => {
        const id = normalizeMarkdownViewWindowId(String(viewId || ""));
        const m = managed.get(id);
        if (!m) return false;
        managed.delete(id);
        if (focusedKey === id) focusedKey = null;
        try {
            m.disposeView?.();
        } catch {
            /* optional */
        }
        try {
            m.disposeFrame();
        } catch {
            /* already detached */
        }
        emitTasking();
        return true;
    };

    const blurWindows = (): void => {
        // WHY: Home / launcher — exit native mono so env chrome returns.
        exitNativeExcept(null);
        focusedKey = null;
        clearFocusedAttrs();
        emitTasking();
    };

    /**
     * WHY: Mobile Home replaces title Close — dispose all floating views so the
     * launcher is visible again under always-maximized windows.
     */
    const closeAllWindows = (): void => {
        if (disposed) return;
        exitNativeExcept(null);
        for (const m of [...managed.values()]) {
            try {
                m.disposeView?.();
            } catch {
                /* optional */
            }
            try {
                m.disposeFrame();
            } catch {
                /* already detached */
            }
        }
        managed.clear();
        focusedKey = null;
        emitTasking();
    };

    const enterNative = (viewId: string): boolean => {
        const id = normalizeMarkdownViewWindowId(String(viewId || ""));
        const m = managed.get(id);
        if (!m || !findKeyedFrame(workspace, id)) return false;
        exitNativeExcept(id);
        m.model.nativeMode.value = true;
        m.model.minimized.value = false;
        m.model.visible.value = true;
        elevateModel(m.model, id);
        return true;
    };

    const exitNative = (viewId?: string): void => {
        if (viewId) {
            const id = normalizeMarkdownViewWindowId(String(viewId || ""));
            const m = managed.get(id);
            if (m?.model.nativeMode) m.model.nativeMode.value = false;
            emitTasking();
            return;
        }
        exitNativeExcept(null);
        emitTasking();
    };

    return {
        shellContext,
        dispose,
        focusWindow,
        minimizeWindow,
        minimizeAllWindows,
        closeWindow,
        blurWindows,
        closeAllWindows,
        enterNative,
        exitNative,
        listWindowTasks,
        getFocusedKey: () => focusedKey
    };
}
