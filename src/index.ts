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

export * from "./components/statusbar";
export * from "./components/taskbar";
export * from "./components/wallpaper";

/** Floating `.wf-frame` layer over workspace home — lazy view modules + optional reader body. */
export {
    createWorkspaceWindowLayer,
    type BuiltInReaderWindow,
    type WorkspaceWindowLayerOptions
} from "./workspace-window-layer";

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

    host.appendChild(root);

    return {
        root,
        device,
        statusBar,
        taskbar,
        disposeDevice: () => device.dispose()
    };
}
