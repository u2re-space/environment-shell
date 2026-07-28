/**
 * environment-shell — public entry for host apps: status bar, taskbar, wallpaper helpers.
 *
 * Import this module (or `environment-shell`) to register FL-UI `ui-statusbar` / `ui-taskbar`
 * via the re-exported component modules, then call {@link mountEnvironmentChrome} or mount pieces a la carte.
 */

import {
    attachShellDeviceStatus,
    mountEnvironmentStatusBar,
    type EnvironmentShellStatusRefs,
    type ShellDeviceStatus
} from "./components/statusbar";
import {
    mountEnvironmentTaskBar,
    type EnvironmentTaskbarOptions,
    type MountTaskBarResult
} from "./components/taskbar";
import { isEnvironmentShellContainerHost } from "./environment-shell-container";
import { SHELL_SLOT } from "boot/shell-slots";

export * from "./components/statusbar";
export * from "./components/taskbar";
export * from "./components/wallpaper";

/** Floating `ui-window` layer over workspace home — lazy view modules + optional reader body. */
export {
    createWorkspaceWindowLayer,
    type BuiltInReaderWindow,
    type WorkspaceWindowLayerOptions,
    type WorkspaceViewLoaderMap,
    type WorkspaceWindowLayer
} from "./workspace-window-layer";

export { mountUiWindow, type MountUiWindowOptions } from "./mount-ui-window";

export {
    ENV_SHELL_OVERLAYS_ATTR,
    getOrCreateEnvironmentOverlayMount
} from "./environment-overlay";

export {
    ENV_SHELL_CONTAINER_TAG,
    defineEnvironmentShellContainer,
    isEnvironmentShellContainerHost,
    createEnvironmentShellContainer,
    type EnvironmentShellContainerElement
} from "./environment-shell-container";

/** Default `localStorage` key for {@link initializeAppCanvasLayer} wallpaper URL (`fest/image` Canvas-2). */
export const ENV_SHELL_WALLPAPER_STORAGE_KEY = "rs-wallpaper-image";

/**
 * If no wallpaper URL is stored yet, set `defaultUrl` (idempotent, swallows storage errors).
 * Call before `initializeAppCanvasLayer` when embedding the stock/demo background.
 */
export function seedEnvironmentWallpaperIfUnset(
    defaultUrl: string,
    storageKey: string = ENV_SHELL_WALLPAPER_STORAGE_KEY
): void {
    try {
        if (!localStorage.getItem(storageKey)) {
            localStorage.setItem(storageKey, defaultUrl);
        }
    } catch {
        /* ignore */
    }
}

export type MountEnvironmentChromeOptions = {
    shell: EnvironmentShellStatusRefs;
    introHtml: string;
    /** Omit for status bar only (e.g. constrained mobile shell). */
    taskbar?: Omit<EnvironmentTaskbarOptions, "device">;
};

export type MountEnvironmentChromeResult = {
    /** Wrapper with `env-shell-chrome` — taskbar (if any) then `ui-statusbar`. */
    root: HTMLElement;
    device: ShellDeviceStatus;
    statusBar: HTMLElement;
    taskbar?: MountTaskBarResult;
    /** Stops battery/network listeners; call when tearing down the shell. */
    disposeDevice: () => void;
};

/**
 * One-call chrome mount: shared {@link ShellDeviceStatus}, `ui-statusbar`, optional `ui-taskbar` + tasking tray.
 * Appends a `.env-shell-chrome` node to `host` (import `environment-shell/scss/main.scss` or the partials you need).
 */
export function mountEnvironmentChrome(
    host: HTMLElement,
    options: MountEnvironmentChromeOptions
): MountEnvironmentChromeResult {
    const device = attachShellDeviceStatus();
    const { element: statusBar } = mountEnvironmentStatusBar(options.shell, options.introHtml, device);
    const root = document.createElement("div");
    root.className = "env-shell-chrome wf-chrome-no-select";

    let taskbar: MountTaskBarResult | undefined;
    if (options.taskbar) {
        taskbar = mountEnvironmentTaskBar({ ...options.taskbar, device });
        root.append(taskbar.element, statusBar);
    } else {
        root.append(statusBar);
    }

    // WHY: Drive taskbar visibility from JS mq as well as CSS media (desktop screens).
    const desktopMq =
        typeof matchMedia === "function" ? matchMedia("(min-width: 641px)") : null;
    const syncDesktopAttr = (): void => {
        const desktop = desktopMq ? desktopMq.matches : true;
        root.toggleAttribute("data-desktop", desktop);
        root.dataset.chromeLayout = desktop ? "desktop" : "mobile";
    };
    syncDesktopAttr();
    desktopMq?.addEventListener?.("change", syncDesktopAttr);

    if (isEnvironmentShellContainerHost(host)) {
        root.slot = SHELL_SLOT.overlay;
    }
    host.appendChild(root);

    return {
        root,
        device,
        statusBar,
        taskbar,
        disposeDevice: () => {
            desktopMq?.removeEventListener?.("change", syncDesktopAttr);
            device.dispose();
        }
    };
}
