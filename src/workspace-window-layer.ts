/**
 * WHY: Home (`mountViewModule` into workspace) stays under floating `.wf-frame`
 * shells; each SpeedDial / desktop `openView` resolves a lazy view module and mounts it
 * into a dedicated frame via {@link mountWindowFrame} (z = model + `--env-window-z-boost`).
 */
import type { ShellContext, ViewModule, ViewOptions } from "views/types";
import { numberRef } from "fest/object";

import {
    createChromeModel,
    mountWindowFrame,
    type MountWindowFrameOptions,
    type WindowChromeModel
} from "../../window-frame/src/frame/window-shell";
import {
    MARKDOWN_VIEW_MANAGED_WINDOW_KEY,
    normalizeMarkdownViewWindowId,
    isMarkdownViewManagedWindowKey
} from "../../window-frame/src/views/markdown-view-window";
import { mountViewModule } from "../../window-frame/src/views/view-mount";

export type BuiltInReaderWindow = {
    title?: string;
    /** Pre-built body (e.g. {@link buildViewerView}). */
    content: HTMLElement;
    seed?: Partial<{ x: number; y: number; w: number; h: number; z: number }>;
};

export type WorkspaceWindowLayerOptions = {
    /**
     * Optional lightweight reader DOM for demos (`buildViewerView`).
     * When omitted, `openView("viewer" | "markdown" | …)` loads full `views/markdown-view` — see `markdown-view-window.ts`.
     */
    readerWindow?: BuiltInReaderWindow;
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
    airpad: "AirPad",
    workcenter: "Work Center",
    history: "History",
    editor: "Editor",
    task: "Plan",
    event: "Events",
    bonus: "Bonuses",
    person: "Contacts"
};

/** Lazy imports — paths resolved by this package's Vite/tsconfig aliases (real Settings + CustomInstructions). */
function viewLoaderForId(viewId: string): (() => Promise<ViewModule>) | null {
    const id =
        normalizeMarkdownViewWindowId(viewId) || String(viewId || "").trim().toLowerCase();
    switch (id) {
        case "explorer":
            return () => import("../../../views/explorer-view/src/index") as unknown as Promise<ViewModule>;
        case "settings":
            return () => import("../../../views/settings-view/src/index") as unknown as Promise<ViewModule>;
        case "airpad":
            return () => import("../../../views/airpad-view/src/index") as unknown as Promise<ViewModule>;
        case "workcenter":
            return () => import("../../../views/workcenter-view/src/index") as unknown as Promise<ViewModule>;
        case "history":
            return () => import("../../../views/history-view/src/index") as unknown as Promise<ViewModule>;
        case "editor":
            return () => import("../../../views/editor-view/src/index") as unknown as Promise<ViewModule>;
        case MARKDOWN_VIEW_MANAGED_WINDOW_KEY:
            return () => import("../../../views/markdown-view/src/index") as unknown as Promise<ViewModule>;
        default:
            return null;
    }
}

function titleForView(viewId: string): string {
    const id = normalizeMarkdownViewWindowId(viewId) || String(viewId || "").trim().toLowerCase();
    if (VIEW_TITLES[id]) return VIEW_TITLES[id];
    const raw = String(viewId || "").trim();
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "View";
}

function placeholderBody(viewId: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "wf-view-placeholder";
    wrap.setAttribute("part", "placeholder");
    wrap.innerHTML = `<p class="wf-view-placeholder__title">${titleForView(viewId)}</p>
<p class="wf-view-placeholder__hint">No window module is registered for this shortcut in environment-shell yet.</p>`;
    return wrap;
}

/**
 * Shell helpers: open registered views in `.wf-frame` overlays, keep `home` as a workspace underlay.
 */
export function createWorkspaceWindowLayer(
    workspace: HTMLElement,
    options: WorkspaceWindowLayerOptions = {}
): {
    shellContext: ShellContext;
    dispose: () => void;
    /** Bring keyed window to front if it exists. */
    focusWindow: (viewId: string) => boolean;
} {
    const topZ = numberRef(120);
    const managed = new Map<string, ManagedWindow>();
    let disposed = false;

    const elevateModel = (model: WindowChromeModel): void => {
        topZ.value += 1;
        model.z.value = topZ.value;
    };

    const shellContext: ShellContext = {};

    const openReaderWindow = (): void => {
        const rw = options.readerWindow;
        if (!rw?.content) return;

        const key = MARKDOWN_VIEW_MANAGED_WINDOW_KEY;
        const ex = managed.get(key);
        if (ex) {
            ex.model.visible.value = true;
            elevateModel(ex.model);
            return;
        }

        const seed = rw.seed || {};
        const model = createChromeModel(rw.title || titleForView(key), {
            x: seed.x ?? 96,
            y: seed.y ?? 96,
            w: seed.w ?? 420,
            h: seed.h ?? 340,
            z: seed.z ?? topZ.value + 1
        });
        topZ.value = model.z.value;

        let disposeFrame: () => void = () => {};
        disposeFrame = mountWindowFrame(workspace, model, rw.content, () => elevateModel(model), {
            onClose: () => {
                managed.get(key)?.disposeFrame();
                managed.delete(key);
            }
        });
        managed.set(key, { key, model, disposeFrame });
    };

    const openViewWindow = (viewId: string, opts?: ViewOptions): void => {
        if (disposed) return;
        const id = normalizeMarkdownViewWindowId(String(viewId || ""));
        if (!id || id === "home") return;

        /* WHY: Demo may pass `readerWindow`; both `viewer` and `markdown` requests collapse to the same key first. */
        if (isMarkdownViewManagedWindowKey(id) && options.readerWindow?.content) {
            openReaderWindow();
            return;
        }

        const existing = managed.get(id);
        if (existing) {
            existing.model.visible.value = true;
            elevateModel(existing.model);
            return;
        }

        const loader = viewLoaderForId(id);
        const body = document.createElement("div");
        body.className = "wf-view-host";
        body.setAttribute("part", "view-host");

        const offset = managed.size * 24;
        const title = titleForView(id);
        const model = createChromeModel(title, {
            x: 72 + offset,
            y: 72 + offset,
            w: 480,
            h: 360,
            z: topZ.value + 1
        });
        topZ.value = model.z.value;

        let disposeFrame: () => void = () => {};
        const frameOpts: MountWindowFrameOptions = {
            onClose: () => {
                const m = managed.get(id);
                m?.disposeView?.();
                m?.disposeFrame();
                managed.delete(id);
            }
        };

        disposeFrame = mountWindowFrame(workspace, model, body, () => elevateModel(model), frameOpts);

        const rec: ManagedWindow = { key: id, model, disposeFrame, disposeView: undefined };
        managed.set(id, rec);

        const mountOpts: ViewOptions = { ...(opts || {}), shellContext };

        if (!loader) {
            body.replaceChildren(placeholderBody(id));
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
                body.replaceChildren(placeholderBody(id));
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
    };

    const focusWindow = (viewId: string): boolean => {
        const id = normalizeMarkdownViewWindowId(String(viewId || ""));
        const m = managed.get(id);
        if (!m) return false;
        m.model.visible.value = true;
        elevateModel(m.model);
        return true;
    };

    return { shellContext, dispose, focusWindow };
}
