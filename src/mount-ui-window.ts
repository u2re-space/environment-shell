/*
 * Filename: mount-ui-window.ts
 * FullPath: modules/shells/environment-shell/src/mount-ui-window.ts
 * Change date and time: 09.55.00_29.07.2026
 * Reason for changes: nativeMode — full-bleed ui-window + hide env chrome while active.
 */
/**
 * WHY: Replaces `.wf-frame` / {@link mountWindowFrame} for environment-shell floating views.
 * Keeps {@link WindowChromeModel} as the reactive bounds source; chrome is `ui-window`.
 *
 * INVARIANT: With `managed`, Windows2 only emits intents (`window-maximize` / `minimize` /
 * `restore` / `close` / `window-native` / `window-exit-native`). This module applies attrs +
 * geometry and notifies the tasking layer.
 */
import { booleanRef, effect } from "fest/object";
import { Windows2 } from "fest/fl-ui";
import type { WindowChromeModel } from "./window/frame/window-shell.ts";

void Windows2;

const DESK_INSET = 8;

/** When mounted under `.env-shell-root`, add this boost so windows stack above the home layer. */
function readEnvWindowZBoost(host: HTMLElement | null | undefined): number {
    const shell = host?.closest?.(".env-shell-root") ?? host?.closest?.("env-shell-container");
    if (!(shell instanceof HTMLElement)) return 0;
    const raw = getComputedStyle(shell).getPropertyValue("--env-window-z-boost").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
}

function resolveEnvShellRoot(host: HTMLElement): HTMLElement | null {
    const shell =
        host.closest?.(".env-shell-root") ??
        host.closest?.("env-shell-container") ??
        document.querySelector?.(".env-shell-root, env-shell-container");
    return shell instanceof HTMLElement ? shell : null;
}

/** Sync host `data-env-native-task` when any managed window is in nativeMode. */
function syncEnvNativeTaskAttr(host: HTMLElement): void {
    const root = resolveEnvShellRoot(host);
    if (!root) return;
    const anyNative = Boolean(
        root.querySelector?.("ui-window[native-mode], ui-window[data-native-active]")
    );
    root.toggleAttribute("data-env-native-task", anyNative);
}

export type MountUiWindowOptions = {
    onClose?: () => void;
    /** Fired after minimize / maximize / restore / native so taskbar can refresh. */
    onChromeChange?: () => void;
    /**
     * Stamped as `data-ui-window-view` (and COMPAT `data-wf-managed-view`) so hosts can
     * detect orphaned chrome after workspace remounts.
     */
    managedViewKey?: string;
    /** When true, start already in native-mode (mono `/explorer?native=1`). */
    startNative?: boolean;
};

/**
 * Mounts a managed `<ui-window>` around `content`, wiring model bounds + chrome events.
 */
export function mountUiWindow(
    host: HTMLElement,
    model: WindowChromeModel,
    content: HTMLElement,
    onFocus: () => void,
    options: MountUiWindowOptions = {}
): () => void {
    const { bounds, z, maximizedMobile, minimized, desktopMaximized, visible, isMobileMq } = model;
    // COMPAT: older chrome models may lack nativeMode until createChromeModel refresh.
    if (!model.nativeMode) {
        model.nativeMode = booleanRef(Boolean(options.startNative));
    }
    const nativeMode = model.nativeMode;
    if (options.startNative) nativeMode.value = true;

    const win = document.createElement("ui-window") as Windows2 & HTMLElement;
    win.setAttribute("managed", "");
    win.className = "env-ui-window";
    win.setAttribute("part", "window");

    const titleEl = document.createElement("span");
    titleEl.slot = "title";
    titleEl.className = "env-ui-window__title";
    titleEl.textContent = model.title;

    content.slot = "content";
    content.classList.add("env-ui-window__body");

    win.append(titleEl, content);
    host.appendChild(win);

    const managedKey = String(options?.managedViewKey ?? "").trim();
    if (managedKey) {
        win.setAttribute("data-ui-window-view", managedKey);
        // COMPAT: older selectors still look for data-wf-managed-view.
        win.setAttribute("data-wf-managed-view", managedKey);
    }

    let savedDesktop: { x: number; y: number; w: number; h: number } | null = null;

    const notifyChrome = (): void => {
        options.onChromeChange?.();
        syncEnvNativeTaskAttr(host);
    };

    const clearDeskMaxInline = (): void => {
        win.style.right = "";
        win.style.bottom = "";
    };

    const applyDeskMaxGeometry = (): void => {
        win.style.left = `${DESK_INSET}px`;
        win.style.top = `${DESK_INSET}px`;
        win.style.right = `${DESK_INSET}px`;
        win.style.bottom = `${DESK_INSET}px`;
        win.style.width = "auto";
        win.style.height = "auto";
        win.style.removeProperty("--ui-win-width");
        win.style.removeProperty("--ui-win-height");
    };

    const applyNativeGeometry = (): void => {
        win.style.left = "0";
        win.style.top = "0";
        win.style.right = "0";
        win.style.bottom = "0";
        win.style.width = "100%";
        win.style.height = "100%";
        win.style.removeProperty("--ui-win-width");
        win.style.removeProperty("--ui-win-height");
    };

    const applyChrome = (): void => {
        const mqMobile = Boolean(isMobileMq.matches);
        const zBoost = readEnvWindowZBoost(host);
        const zNow = (z.value ?? 10) + zBoost;
        win.style.zIndex = String(zNow);

        const isNative = Boolean(nativeMode.value);
        const isMin = Boolean(minimized.value);
        const isDeskMax = !mqMobile && Boolean(desktopMaximized.value) && !isNative;
        const isMobMax = mqMobile && Boolean(maximizedMobile.value) && !isNative;

        win.toggleAttribute("native-mode", isNative);
        win.toggleAttribute("minimized", isMin);
        win.toggleAttribute("data-mobile-max", isMobMax);
        win.toggleAttribute("data-desk-max", isDeskMax);
        win.toggleAttribute("maximized", isDeskMax || isMobMax || isNative);

        if (isMin) {
            win.setVisible(false);
            syncEnvNativeTaskAttr(host);
            return;
        }

        win.setVisible(Boolean(visible.value));
        if (!visible.value) {
            syncEnvNativeTaskAttr(host);
            return;
        }

        if (isNative) {
            applyNativeGeometry();
            syncEnvNativeTaskAttr(host);
            return;
        }

        if (isMobMax) {
            win.style.left = "0";
            win.style.top = "0";
            win.style.right = "0";
            win.style.bottom = "0";
            win.style.width = "100%";
            win.style.height = "100%";
            syncEnvNativeTaskAttr(host);
            return;
        }

        if (isDeskMax) {
            applyDeskMaxGeometry();
            syncEnvNativeTaskAttr(host);
            return;
        }

        clearDeskMaxInline();
        win.applyBounds({
            x: bounds.x.value,
            y: bounds.y.value,
            w: bounds.w.value,
            h: bounds.h.value,
            z: zNow
        });
        syncEnvNativeTaskAttr(host);
    };

    const onMq = (): void => {
        if (isMobileMq.matches) {
            if (!nativeMode.value) maximizedMobile.value = true;
            if (desktopMaximized.value) {
                desktopMaximized.value = false;
                if (savedDesktop) {
                    bounds.x.value = savedDesktop.x;
                    bounds.y.value = savedDesktop.y;
                    bounds.w.value = savedDesktop.w;
                    bounds.h.value = savedDesktop.h;
                    savedDesktop = null;
                }
            }
        }
        applyChrome();
        notifyChrome();
    };

    const stopFx = effect(
        () => {
            applyChrome();
        },
        [
            bounds.x,
            bounds.y,
            bounds.w,
            bounds.h,
            z,
            maximizedMobile,
            minimized,
            desktopMaximized,
            nativeMode,
            visible
        ],
        { triggerImmediately: true }
    );

    isMobileMq.addEventListener("change", onMq);
    onMq();

    const onWinFocus = (): void => {
        // WHY: Focusing a minimized window restores it (taskbar / click-through).
        if (minimized.value) {
            minimized.value = false;
            visible.value = true;
        }
        onFocus();
        const zBoost = readEnvWindowZBoost(host);
        const zNow = (z.value ?? 10) + zBoost;
        if (typeof (win as Windows2).bringToFront === "function") {
            (win as Windows2).bringToFront(zNow);
        } else {
            win.style.zIndex = String(zNow);
            win.toggleAttribute("data-focused", true);
        }
        notifyChrome();
    };

    const onWinMove = (ev: Event): void => {
        const detail = (ev as CustomEvent<{ x?: number; y?: number }>).detail;
        if (nativeMode.value || desktopMaximized.value || maximizedMobile.value || minimized.value) {
            return;
        }
        if (typeof detail?.x === "number") bounds.x.value = detail.x;
        if (typeof detail?.y === "number") bounds.y.value = detail.y;
    };

    const onWinResize = (ev: Event): void => {
        const detail = (ev as CustomEvent<{ w?: number; h?: number }>).detail;
        if (nativeMode.value || desktopMaximized.value || maximizedMobile.value || minimized.value) {
            return;
        }
        if (typeof detail?.w === "number") bounds.w.value = detail.w;
        if (typeof detail?.h === "number") bounds.h.value = detail.h;
    };

    const onWinMinimize = (): void => {
        if (nativeMode.value) {
            nativeMode.value = false;
        }
        if (desktopMaximized.value && !isMobileMq.matches) {
            desktopMaximized.value = false;
            if (savedDesktop) {
                bounds.x.value = savedDesktop.x;
                bounds.y.value = savedDesktop.y;
                bounds.w.value = savedDesktop.w;
                bounds.h.value = savedDesktop.h;
                savedDesktop = null;
            }
        }
        minimized.value = true;
        applyChrome();
        notifyChrome();
    };

    const onWinMaximize = (): void => {
        // WHY: from native, maximize/restore exits native.
        if (nativeMode.value) {
            onWinExitNative();
            return;
        }
        if (isMobileMq.matches) {
            // Phone: second maximize from mobile-max promotes to native mono.
            if (maximizedMobile.value) {
                onWinNative();
                return;
            }
            minimized.value = false;
            maximizedMobile.value = true;
            applyChrome();
            notifyChrome();
            return;
        }
        if (minimized.value) minimized.value = false;
        // Desktop: maximize once → desk max; again → native-mode (WCO / full-bleed).
        if (desktopMaximized.value) {
            onWinNative();
            return;
        }
        savedDesktop = {
            x: bounds.x.value,
            y: bounds.y.value,
            w: bounds.w.value,
            h: bounds.h.value
        };
        desktopMaximized.value = true;
        applyChrome();
        notifyChrome();
    };

    const onWinNative = (): void => {
        if (minimized.value) {
            minimized.value = false;
            visible.value = true;
        }
        if (!nativeMode.value && !desktopMaximized.value && !maximizedMobile.value) {
            savedDesktop = {
                x: bounds.x.value,
                y: bounds.y.value,
                w: bounds.w.value,
                h: bounds.h.value
            };
        }
        desktopMaximized.value = false;
        maximizedMobile.value = false;
        nativeMode.value = true;
        applyChrome();
        notifyChrome();
    };

    const onWinExitNative = (): void => {
        if (!nativeMode.value) return;
        nativeMode.value = false;
        if (savedDesktop) {
            bounds.x.value = savedDesktop.x;
            bounds.y.value = savedDesktop.y;
            bounds.w.value = savedDesktop.w;
            bounds.h.value = savedDesktop.h;
            savedDesktop = null;
        }
        if (isMobileMq.matches) {
            maximizedMobile.value = true;
        }
        applyChrome();
        notifyChrome();
    };

    const onWinRestore = (): void => {
        if (nativeMode.value) {
            onWinExitNative();
            return;
        }
        // WHY: restore clears minimize and/or desk/mobile maximize back to saved bounds.
        if (minimized.value) {
            minimized.value = false;
            visible.value = true;
        }
        if (isMobileMq.matches) {
            if (maximizedMobile.value) maximizedMobile.value = false;
        } else if (desktopMaximized.value) {
            desktopMaximized.value = false;
            if (savedDesktop) {
                bounds.x.value = savedDesktop.x;
                bounds.y.value = savedDesktop.y;
                bounds.w.value = savedDesktop.w;
                bounds.h.value = savedDesktop.h;
                savedDesktop = null;
            }
        }
        applyChrome();
        notifyChrome();
    };

    const onWinClose = (ev: Event): void => {
        ev.preventDefault();
        if (nativeMode.value) nativeMode.value = false;
        visible.value = false;
        options.onClose?.();
        syncEnvNativeTaskAttr(host);
    };

    /**
     * WHY: Bubble-phase fallback only. Windows2 handles controls in shadow capture and
     * stopImmediatePropagation — if that wiring misses, composed click still reaches host.
     * Do NOT use capture here or max/min will double-toggle.
     */
    const hitTitleControl = (
        ev: Event
    ): "minimize" | "maximize" | "close" | "exit-native" | null => {
        const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
        for (const n of path) {
            if (!(n instanceof Element)) continue;
            if (n.matches?.(".title-close")) return "close";
            if (n.matches?.(".title-exit-native")) return "exit-native";
            if (n.matches?.(".title-maximize")) return "maximize";
            if (n.matches?.(".title-minimize")) return "minimize";
        }
        return null;
    };

    const onHostControlBubble = (ev: Event): void => {
        if ((ev as Event & { defaultPrevented?: boolean }).defaultPrevented) return;
        const which = hitTitleControl(ev);
        if (!which) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (which === "close") {
            onWinClose(ev);
            return;
        }
        if (which === "exit-native") {
            onWinExitNative();
            return;
        }
        if (which === "maximize") {
            if (nativeMode.value || desktopMaximized.value || maximizedMobile.value) onWinRestore();
            else onWinMaximize();
            return;
        }
        if (minimized.value) onWinRestore();
        else onWinMinimize();
    };

    win.addEventListener("window-focus", onWinFocus);
    win.addEventListener("window-move", onWinMove);
    win.addEventListener("window-resize", onWinResize);
    win.addEventListener("window-minimize", onWinMinimize);
    win.addEventListener("window-maximize", onWinMaximize);
    win.addEventListener("window-restore", onWinRestore);
    win.addEventListener("window-native", onWinNative);
    win.addEventListener("window-exit-native", onWinExitNative);
    win.addEventListener("window-close", onWinClose);
    win.addEventListener("click", onHostControlBubble);

    return () => {
        stopFx?.();
        isMobileMq.removeEventListener("change", onMq);
        win.removeEventListener("window-focus", onWinFocus);
        win.removeEventListener("window-move", onWinMove);
        win.removeEventListener("window-resize", onWinResize);
        win.removeEventListener("window-minimize", onWinMinimize);
        win.removeEventListener("window-maximize", onWinMaximize);
        win.removeEventListener("window-restore", onWinRestore);
        win.removeEventListener("window-native", onWinNative);
        win.removeEventListener("window-exit-native", onWinExitNative);
        win.removeEventListener("window-close", onWinClose);
        win.removeEventListener("click", onHostControlBubble);
        try {
            if (nativeMode.value) nativeMode.value = false;
            win.remove();
        } catch {
            /* already detached */
        }
        syncEnvNativeTaskAttr(host);
    };
}
