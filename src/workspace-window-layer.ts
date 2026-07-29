/*
 * Filename: workspace-window-layer.ts
 * FullPath: modules/shells/environment-shell/src/workspace-window-layer.ts
 * Change date and time: 09.55.00_29.07.2026
 * Reason for changes: nativeMode promote/restore; Home exits native; mono startNative.
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
import { numberRef } from "fest/object";
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
import { mountUiWindow } from "./mount-ui-window.ts";
import type { EnvWindowTaskDescriptor } from "./components/taskbar.ts";

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

function readEnvWindowZBoost(workspace: HTMLElement): number {
    const shell =
        workspace.closest?.(".env-shell-root") ??
        workspace.closest?.("env-shell-container") ??
        workspace.parentElement;
    if (!(shell instanceof HTMLElement)) return 0;
    const raw = getComputedStyle(shell).getPropertyValue("--env-window-z-boost").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
}

const VIEW_ICONS: Record<string, string> = {
    home: "house",
    viewer: "article",
    markdown: "article",
    explorer: "books",
    settings: "gear-six",
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
    explorer: "Explorer",
    settings: "Settings",
    workcenter: "Work Center",
    history: "History",
    editor: "Editor",
    network: "Network",
    task: "Plan",
    event: "Events",
    bonus: "Bonuses",
    person: "Contacts"
};

/**
 * Package-local defaults intentionally empty.
 * WHY: relative `../../../views/*-view` imports break when this file is consumed via
 * CWSP-shell's symlink (`src/frontend/shells/environment` → modules). Hosts must pass
 * {@link WorkspaceWindowLayerOptions.viewLoaders} (CWSP adapter / demo boot).
 */
function defaultViewLoaderForId(_viewId: string): (() => Promise<ViewModule>) | null {
    return null;
}

function titleForView(viewId: string, overrides?: Record<string, string>): string {
    const id = normalizeMarkdownViewWindowId(viewId) || String(viewId || "").trim().toLowerCase();
    if (overrides?.[id]) return overrides[id];
    if (VIEW_TITLES[id]) return VIEW_TITLES[id];
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
    /** Clear window focus markers (e.g. when Home task is selected). */
    blurWindows: () => void;
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

    const emitTasking = (): void => {
        options.onTaskingChange?.(listWindowTasks());
    };

    const listWindowTasks = (): EnvWindowTaskDescriptor[] => {
        const out: EnvWindowTaskDescriptor[] = [];
        for (const m of managed.values()) {
            if (!findKeyedFrame(workspace, m.key)) continue;
            out.push({
                id: m.key,
                title: m.model.title || titleForView(m.key, options.viewTitles),
                icon: VIEW_ICONS[m.key] || "app-window",
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
            if (frame.parentElement === workspace) {
                workspace.appendChild(frame);
            }
        }
        emitTasking();
    };

    const shellContext: ShellContext = {};

    const envOverlayMount =
        options.overlayMountHost ? getOrCreateEnvironmentOverlayMount(options.overlayMountHost) : null;

    shellContext.resolveOverlayMountPoint = (anchor) => {
        if (options.environmentShellHost) {
            const fromShell = resolveShellOverlaysMount(options.environmentShellHost);
            if (fromShell) return fromShell;
        }
        if (envOverlayMount) return envOverlayMount;
        return resolveGlobalOverlay(anchor ?? null);
    };

    const viewLoaderForId = (viewId: string): (() => Promise<ViewModule>) | null => {
        const id =
            normalizeMarkdownViewWindowId(viewId) || String(viewId || "").trim().toLowerCase();
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
                managed.get(key)?.disposeFrame();
                managed.delete(key);
                if (focusedKey === key) focusedKey = null;
                emitTasking();
            }
        });
        managed.set(key, { key, model, disposeFrame });
        elevateModel(model, key);
    };

    const openViewWindow = (viewId: string, opts?: ViewOptions): void => {
        if (disposed) return;
        const id = normalizeMarkdownViewWindowId(String(viewId || ""));
        if (!id || id === "home") return;
        // WHY: airpad removed from environment launcher UI (transport aliases stay elsewhere).
        if (id === "airpad") return;

        /* WHY: Demo may pass `readerWindow`; both `viewer` and `markdown` requests collapse to the same key first. */
        if (isMarkdownViewManagedWindowKey(id) && options.readerWindow?.content) {
            openReaderWindow();
            return;
        }

        const existing = managed.get(id);
        if (existing && findKeyedFrame(workspace, id)) {
            elevateModel(existing.model, id);
            return;
        }
        if (existing && !findKeyedFrame(workspace, id)) {
            /* WHY: `mountViewModule(host.replaceChildren)` on the workspace drops window nodes; reconcile stale refs. */
            existing.disposeView?.();
            managed.delete(id);
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

        const offset = managed.size * 24;
        const title = titleForView(id, options.viewTitles);
        const model = createChromeModel(title, {
            x: 72 + offset,
            y: 72 + offset,
            w: 480,
            h: 360,
            z: topZ.value + 1
        });
        topZ.value = model.z.value;

        const startNativeIds = new Set(
            (options.startNativeViewIds || []).map((v) =>
                normalizeMarkdownViewWindowId(String(v || ""))
            )
        );
        const wantNative =
            startNativeIds.has(id) ||
            String((opts as ViewOptions & { native?: unknown })?.native || "") === "1" ||
            String((opts as { params?: { native?: string } })?.params?.native || "") === "1";

        let disposeFrame: () => void = () => {};
        disposeFrame = mountUiWindow(workspace, model, body, () => elevateModel(model, id), {
            managedViewKey: id,
            startNative: wantNative,
            onChromeChange: emitTasking,
            onClose: () => {
                const m = managed.get(id);
                m?.disposeView?.();
                m?.disposeFrame();
                managed.delete(id);
                if (focusedKey === id) focusedKey = null;
                emitTasking();
            }
        });
        if (wantNative) {
            model.nativeMode.value = true;
            exitNativeExcept(id);
        }

        const rec: ManagedWindow = { key: id, model, disposeFrame, disposeView: undefined };
        managed.set(id, rec);
        elevateModel(model, id);

        const mountOpts: ViewOptions = { ...(opts || {}), shellContext };

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
                const cur = managed.get(id);
                if (cur) cur.disposeView = unmountView;
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

    const blurWindows = (): void => {
        // WHY: Home / launcher — exit native mono so env chrome returns.
        exitNativeExcept(null);
        focusedKey = null;
        clearFocusedAttrs();
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
        blurWindows,
        enterNative,
        exitNative,
        listWindowTasks,
        getFocusedKey: () => focusedKey
    };
}
