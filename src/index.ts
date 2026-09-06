/**
 * environment-shell — public entry for host apps: status bar, taskbar, wallpaper helpers.
 *
 * Import this module (or `environment-shell`) to register FL-UI `ui-statusbar` / `ui-taskbar`
 * via the re-exported component modules, then call {@link mountEnvironmentChrome} or mount pieces a la carte.
 */

import {
    attachShellDeviceStatus,
    attachStatusBarContrast,
    isNativeCapacitorHost,
    isShellStandaloneDisplay,
    matchShellDisplayMode,
    mountEnvironmentStatusBar,
    shouldShowStatusOverlay,
    type EnvironmentShellStatusRefs,
    type ShellDeviceStatus
} from "./components/statusbar/statusbar";
import { installCapacitorNativeSafeAreaInsets } from "./components/statusbar/capacitor-native-safe-area";
import {
    mountEnvironmentTaskBar,
    type EnvironmentTaskbarOptions,
    type MountTaskBarResult
} from "./components/taskbar/element/TaskBar";
import {
    createChromeBookmarksMenuApi,
    setBookmarksMenuApi
} from "./components/app-menu/bookmarks-menu";
import { isEnvironmentShellContainerHost } from "./environment-shell-container";
import { getOrCreateEnvironmentOverlayMount } from "./environment-overlay";
import { SHELL_SLOT } from "boot/shell-slots";
/* Side-effect: register `ui-calendar-flyout` / `ui-quick-settings` CEs. */
import { setChromeFlyoutShellHost } from "./components/flyout/ChromeFlyout";
import "./components/calendar/CalendarFlyout";
import { restoreQuickFilters } from "./components/settings/QuickSettings";
import { ensureViewportTracking } from "@fest-lib/dom";

export * from "./components/statusbar/statusbar";
export * from "./components/taskbar/element/TaskBar";
export * from "./components/wallpaper";
export * from "./components/flyout/ChromeFlyout";
export * from "./components/calendar/CalendarFlyout";
export * from "./components/settings/QuickSettings";

/** Floating `ui-window` layer over workspace home — lazy view modules + optional reader body. */
export {
    createWorkspaceWindowLayer,
    type BuiltInReaderWindow,
    type WorkspaceWindowLayerOptions,
    type WorkspaceViewLoaderMap,
    type WorkspaceWindowLayer
} from "./workspace-window-layer";

export { mountUiWindow, type MountUiWindowOptions } from "./window/window/mount-ui-window";

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
    ensureViewportTracking();
    const device = attachShellDeviceStatus();
    const nativeCapacitor = isNativeCapacitorHost();
    if (nativeCapacitor) {
        void installCapacitorNativeSafeAreaInsets();
    }
    let statusBar: ReturnType<typeof mountEnvironmentStatusBar>["element"];
    let disposeStatusBar: () => void;
    if (nativeCapacitor) {
        statusBar = document.createElement("ui-statusbar");
        statusBar.className = "env-ui-statusbar";
        statusBar.hidden = true;
        disposeStatusBar = () => {
            statusBar.remove();
        };
    } else {
        const mounted = mountEnvironmentStatusBar(options.shell, options.introHtml, device);
        statusBar = mounted.element;
        disposeStatusBar = mounted.dispose;
    }
    const root = document.createElement("div");
    root.className = "env-shell-chrome wf-chrome-no-select";

    let taskbar: MountTaskBarResult | undefined;
    if (options.taskbar) {
        /* CRX newtab: enable Win7-style Start menu over chrome.bookmarks when available. */
        try {
            const bookmarksApi = createChromeBookmarksMenuApi();
            if (bookmarksApi) setBookmarksMenuApi(bookmarksApi);
        } catch {
            /* non-CRX / no permission */
        }
        taskbar = mountEnvironmentTaskBar({ ...options.taskbar, device });
        root.append(taskbar.element, statusBar);
    } else {
        root.append(statusBar);
    }

    const shellRoot =
        (host.classList?.contains("env-shell-root") ? host : null) ||
        (host.closest?.(".env-shell-root") as HTMLElement | null) ||
        (host.closest?.("env-shell-container") as HTMLElement | null) ||
        host;

    /* WHY: Chrome flyouts share the env overlay mount (calendar / quick settings). */
    setChromeFlyoutShellHost(shellRoot);
    (globalThis as { __ENV_OVERLAY_MOUNT__?: typeof getOrCreateEnvironmentOverlayMount })
        .__ENV_OVERLAY_MOUNT__ = getOrCreateEnvironmentOverlayMount;
    getOrCreateEnvironmentOverlayMount(shellRoot);
    restoreQuickFilters();

    // WHY: Drive taskbar / status overlay from mq + display-mode + document fullscreen.
    const desktopMq =
        typeof matchMedia === "function" ? matchMedia("(min-width: 641px) and (not ((pointer: coarse) or (hover: none)))") : null;
    const displayMqs =
        typeof matchMedia === "function"
            ? [
                  "(display-mode: standalone)",
                  "(display-mode: fullscreen)",
                  "(display-mode: minimal-ui)",
                  "(display-mode: browser)",
                  "(display-mode: window-controls-overlay)"
              ].map((q) => matchMedia(q))
            : [];

    const syncChromeSurface = (): void => {
        const desktop = desktopMq ? desktopMq.matches : true;
        const displayMode = matchShellDisplayMode();
        const standalone = isShellStandaloneDisplay();
        const statusOverlay = shouldShowStatusOverlay({ desktop, standalone, displayMode });

        root.toggleAttribute("data-desktop", desktop);
        root.toggleAttribute("data-standalone", standalone);
        root.toggleAttribute("data-status-overlay", statusOverlay);
        root.dataset.chromeLayout = desktop ? "desktop" : "mobile";
        root.dataset.displayMode = displayMode;

        shellRoot.toggleAttribute("data-standalone", standalone);
        shellRoot.toggleAttribute("data-status-overlay", statusOverlay);
        shellRoot.dataset.displayMode = displayMode;
        // INVARIANT: windows title spacer + overlay height share this token.
        shellRoot.style.setProperty(
            "--env-status-inset-top",
            statusOverlay ? "max(2rem, env(safe-area-inset-top, 0px))" : "0px"
        );
        document.documentElement.toggleAttribute("data-env-status-overlay", statusOverlay);
        document.documentElement.toggleAttribute("data-env-standalone", standalone);
        // WHY: open ui-windows re-read gap / no-titlebar from these attrs.
        try {
            shellRoot.dispatchEvent(
                new CustomEvent("env-chrome-surface", {
                    bubbles: true,
                    detail: { statusOverlay, standalone, displayMode, desktop }
                })
            );
        } catch {
            /* ignore */
        }
    };
    syncChromeSurface();
    desktopMq?.addEventListener?.("change", syncChromeSurface);
    for (const mq of displayMqs) mq.addEventListener?.("change", syncChromeSurface);
    document.addEventListener("fullscreenchange", syncChromeSurface);
    document.addEventListener("webkitfullscreenchange", syncChromeSurface as EventListener);

    const disposeContrast = nativeCapacitor ? () => {} : attachStatusBarContrast(shellRoot);

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
            desktopMq?.removeEventListener?.("change", syncChromeSurface);
            for (const mq of displayMqs) mq.removeEventListener?.("change", syncChromeSurface);
            document.removeEventListener("fullscreenchange", syncChromeSurface);
            document.removeEventListener("webkitfullscreenchange", syncChromeSurface as EventListener);
            disposeContrast();
            disposeStatusBar();
            device.dispose();
            setChromeFlyoutShellHost(null);
        }
    };
}
