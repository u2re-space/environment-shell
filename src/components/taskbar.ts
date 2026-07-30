/*
 * Filename: taskbar.ts
 * FullPath: modules/shells/environment-shell/src/components/taskbar.ts
 * Change date and time: 18.06.00_30.07.2026
 * Reason for changes: Direct Win toggle (bypass ITask focus no-op); icon attrs before connect.
 */
/**
 * WHY: Desktop shell chrome — `ui-taskbar` + `ui-task` from FL-UI, `fest/lure` tasking `makeTask` / `getBy`,
 * and the same reactive device tray as {@link buildShellDeviceTray} (desktop-only via CSS + data-desktop).
 * Mobile: transparent nav, centered house icon; long-press lists open windows.
 * Desktop: no Home pin; icon-only tasks; Win-style click toggle; context menus; tray clock.
 */
import { UITask, UITaskBar } from "fest/fl-ui";
import "fest/icon";
import { createPanelUnderShadow, type UnderlyingShadow } from "fest/lure";
import { effect, observe, type refType } from "fest/object";
import { getBy, makeTask, navigationEnable, type ITask } from "fest/lure";
import {
    openUnifiedContextMenu,
    type ContextMenuEntry
} from "../views/explorer/ts/ContextMenu";

import { buildShellDeviceTray, type ShellDeviceStatus } from "./statusbar";

void UITaskBar;
void UITask;

/** Open floating window entry for the desktop taskbar. */
export type EnvWindowTaskDescriptor = {
    id: string;
    title: string;
    icon?: string;
    focused?: boolean;
    minimized?: boolean;
    visible?: boolean;
};

export type EnvironmentTaskbarOptions = {
    device: ShellDeviceStatus;
    onHome: () => void;
    onViewer: () => void;
    /** Which pinned task is highlighted (home | viewer | window id). */
    focusedTaskId: refType<string>;
    /** Activate / restore a managed window task (view id). */
    onWindowTask?: (viewId: string) => void;
    /** Minimize a managed window (desktop Win toggle). */
    onMinimizeWindow?: (viewId: string) => void;
    /** Close a managed window. */
    onCloseWindow?: (viewId: string) => void;
};

export type MountTaskBarResult = {
    element: HTMLElement;
    taskList: ITask[];
    setFocusedTaskId: (id: string) => void;
    /** Replace dynamic window tasks (Home / Markdown pins stay). */
    syncWindowTasks: (windows: EnvWindowTaskDescriptor[]) => void;
    dispose: () => void;
};

const HOME_TASK = "#env-home";
const VIEWER_TASK = "#env-viewer";
const WIN_TASK_PREFIX = "#env-win-";
/** Long-press threshold for mobile Home → process switcher (ms). */
const HOME_LONG_PRESS_MS = 420;
const CLOCK_TICK_MS = 30_000;

function winTaskId(viewId: string): string {
    return `${WIN_TASK_PREFIX}${String(viewId || "").trim().toLowerCase()}`;
}

function isMobileChrome(): boolean {
    const chrome = document.querySelector(".env-shell-chrome");
    if (chrome instanceof HTMLElement && chrome.hasAttribute("data-desktop")) return false;
    if (chrome instanceof HTMLElement && chrome.dataset.chromeLayout === "mobile") return true;
    return typeof matchMedia === "function" && matchMedia("(max-width: 640px)").matches;
}

function formatTrayClock(now = new Date()): { time: string; date: string } {
    const time = now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
    });
    const date = now.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short"
    });
    return { time, date };
}

/**
 * Task bar with Home / Markdown pins + dynamic open-window tasks and reactive system tray.
 */
export function mountEnvironmentTaskBar(opts: EnvironmentTaskbarOptions): MountTaskBarResult {
    const taskList = observe<ITask[]>([]);
    navigationEnable(taskList);

    makeTask(HOME_TASK, taskList, { title: "Home", icon: "house" }, {}, function (this: ITask) {
        for (const t of taskList) {
            if (t !== this) t.active = false;
        }
        this.active = true;
        opts.focusedTaskId.value = "home";
        opts.onHome();
    });

    makeTask(VIEWER_TASK, taskList, { title: "Markdown", icon: "article" }, {}, function (this: ITask) {
        for (const t of taskList) {
            if (t !== this) t.active = false;
        }
        this.active = true;
        opts.focusedTaskId.value = "viewer";
        opts.onViewer();
    });

    const bar = document.createElement("ui-taskbar");
    bar.className = "env-shell-taskbar wf-chrome-no-select";
    bar.setAttribute("part", "taskbar");
    bar.setAttribute("data-type", "desktop");

    const pinsHost = document.createElement("div");
    pinsHost.className = "env-shell-taskbar__pins";

    const windowsHost = document.createElement("div");
    windowsHost.className = "env-shell-taskbar__windows";

    const tHome = document.createElement("ui-task");
    tHome.setAttribute("title", "Home");
    tHome.setAttribute("icon", "house");
    tHome.setAttribute("data-id", HOME_TASK);
    tHome.setAttribute("data-env-home", "");
    tHome.setAttribute("aria-label", "Home");
    tHome.setAttribute("aria-haspopup", "menu");
    tHome.setAttribute("aria-keyshortcuts", "LongPress");

    const tViewer = document.createElement("ui-task");
    tViewer.setAttribute("title", "Markdown");
    tViewer.setAttribute("icon", "article");
    tViewer.setAttribute("data-id", VIEWER_TASK);
    tViewer.setAttribute("data-env-pin", "viewer");
    tViewer.setAttribute("aria-label", "Markdown");

    pinsHost.append(tHome, tViewer);

    const trayHost = document.createElement("div");
    trayHost.className = "env-shell-taskbar__tray-host";

    const clockHost = document.createElement("div");
    clockHost.className = "env-shell-taskbar__clock";
    clockHost.setAttribute("role", "timer");
    clockHost.setAttribute("aria-live", "polite");
    const clockTime = document.createElement("span");
    clockTime.className = "env-shell-taskbar__clock-time";
    const clockDate = document.createElement("span");
    clockDate.className = "env-shell-taskbar__clock-date";
    clockHost.append(clockTime, clockDate);

    const paintClock = (): void => {
        const { time, date } = formatTrayClock();
        clockTime.textContent = time;
        clockDate.textContent = date;
        clockHost.title = `${time} · ${date}`;
    };
    paintClock();
    const clockTimer = setInterval(paintClock, CLOCK_TICK_MS);

    trayHost.append(
        buildShellDeviceTray(opts.device, "env-device-tray env-device-tray--taskbar"),
        clockHost
    );

    /* Mobile process switcher — lives above the nav bar, opened by Home long-press. */
    const switcher = document.createElement("div");
    switcher.className = "env-shell-navbar__switcher";
    switcher.setAttribute("role", "menu");
    switcher.setAttribute("aria-label", "Open apps");
    switcher.hidden = true;

    const switcherList = document.createElement("ul");
    switcherList.className = "env-shell-navbar__switcher-list";
    switcher.appendChild(switcherList);

    bar.append(pinsHost, windowsHost, trayHost, switcher);

    const windowTaskEls = new Map<string, HTMLElement>();
    let lastWindows: EnvWindowTaskDescriptor[] = [];
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressFired = false;
    let switcherOpen = false;
    let barUnder: UnderlyingShadow | null = null;
    const cleanupFns: Array<() => void> = [];
    cleanupFns.push(() => clearInterval(clockTimer));

    const findWindowDesc = (viewId: string): EnvWindowTaskDescriptor | undefined =>
        lastWindows.find((w) => String(w.id || "").trim().toLowerCase() === viewId);

    /**
     * Win-style task click: minimized → restore+focus; focused+visible → minimize; else → focus.
     * WHY: do NOT route through `task.focus = true` — ITask focus setter only runs takeAction when
     * focus *changes*, so a second click on an already-focused task never minimized.
     */
    const activateWindowTask = (viewId: string): void => {
        const id = String(viewId || "").trim().toLowerCase();
        if (!id) return;
        const desc = findWindowDesc(id);
        const focusedId = String(opts.focusedTaskId.value || "").trim().toLowerCase();
        const isFocused =
            Boolean(desc?.focused) ||
            focusedId === id ||
            (focusedId === "markdown" && id === "viewer") ||
            (focusedId === "viewer" && (id === "viewer" || id === "markdown"));

        if (desc?.minimized) {
            desc.minimized = false;
            desc.focused = true;
            windowTaskEls.get(id)?.toggleAttribute("data-minimized", false);
            opts.focusedTaskId.value = id === "markdown" ? "viewer" : id;
            opts.onWindowTask?.(id);
            return;
        }
        if (isFocused && desc && desc.visible !== false) {
            desc.minimized = true;
            desc.focused = false;
            windowTaskEls.get(id)?.toggleAttribute("data-minimized", true);
            opts.onMinimizeWindow?.(id);
            return;
        }
        opts.focusedTaskId.value = id === "markdown" ? "viewer" : id;
        opts.onWindowTask?.(id);
    };

    const openTaskContextMenu = (ev: MouseEvent, viewId: string, title: string): void => {
        if (isMobileChrome()) return;
        ev.preventDefault();
        ev.stopPropagation();
        const id = String(viewId || "").trim().toLowerCase();
        const desc = findWindowDesc(id);
        const minimized = Boolean(desc?.minimized);
        const items: ContextMenuEntry[] = [
            {
                id: minimized ? "restore" : "minimize",
                label: minimized ? "Restore" : "Minimize",
                icon: minimized ? "arrow-square-out" : "minus",
                action: () => {
                    if (minimized) {
                        opts.focusedTaskId.value = id;
                        opts.onWindowTask?.(id);
                    } else {
                        opts.onMinimizeWindow?.(id);
                    }
                }
            },
            {
                id: "close",
                label: "Close",
                icon: "x",
                danger: true,
                action: () => opts.onCloseWindow?.(id)
            }
        ];
        openUnifiedContextMenu({
            x: ev.clientX,
            y: ev.clientY,
            compact: true,
            anchor: ev.target instanceof Element ? ev.target : bar,
            items
        });
        void title;
    };

    const openBarContextMenu = (ev: MouseEvent): void => {
        if (isMobileChrome()) return;
        const path =
            typeof ev.composedPath === "function" ? ev.composedPath() : [];
        for (const n of path) {
            if (n instanceof Element && n.closest?.("ui-task")) return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        const items: ContextMenuEntry[] = [
            {
                id: "show-desktop",
                label: "Show desktop",
                icon: "desktop",
                action: () => opts.onHome()
            },
            {
                id: "home",
                label: "Home",
                icon: "house",
                action: () => opts.onHome()
            }
        ];
        openUnifiedContextMenu({
            x: ev.clientX,
            y: ev.clientY,
            compact: true,
            anchor: bar,
            items
        });
    };

    bar.addEventListener("contextmenu", openBarContextMenu);

    const closeSwitcher = (): void => {
        switcherOpen = false;
        switcher.hidden = true;
        switcherList.replaceChildren();
        bar.removeAttribute("data-switcher-open");
    };

    const openSwitcher = (): void => {
        const open = lastWindows.filter((w) => w.visible !== false && String(w.id || "").trim());
        switcherList.replaceChildren();

        if (!open.length) {
            const empty = document.createElement("li");
            empty.className = "env-shell-navbar__switcher-empty";
            empty.textContent = "No open apps";
            switcherList.appendChild(empty);
        } else {
            for (const w of open) {
                const id = String(w.id || "").trim().toLowerCase();
                const li = document.createElement("li");
                li.setAttribute("role", "none");
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "env-shell-navbar__switcher-item";
                btn.setAttribute("role", "menuitem");
                btn.toggleAttribute("data-active", Boolean(w.focused));
                const icon = document.createElement("ui-icon");
                icon.setAttribute("icon", w.icon || "app-window");
                icon.setAttribute("icon-style", "duotone");
                icon.setAttribute("aria-hidden", "true");
                const label = document.createElement("span");
                label.textContent = w.title || id;
                btn.append(icon, label);
                btn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeSwitcher();
                    opts.focusedTaskId.value = id;
                    const taskId = winTaskId(id);
                    const t = getBy(taskList, taskId);
                    if (t) t.focus = true;
                    else opts.onWindowTask?.(id);
                });
                li.appendChild(btn);
                switcherList.appendChild(li);
            }
        }

        switcherOpen = true;
        switcher.hidden = false;
        bar.setAttribute("data-switcher-open", "");
    };

    const clearLongPress = (): void => {
        if (longPressTimer != null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    const goHome = (): void => {
        closeSwitcher();
        getBy(taskList, HOME_TASK)!.focus = true;
    };

    tHome.addEventListener("click", (ev) => {
        if (longPressFired) {
            ev.preventDefault();
            ev.stopPropagation();
            longPressFired = false;
            return;
        }
        goHome();
    });

    tHome.addEventListener(
        "pointerdown",
        (ev) => {
            if (!isMobileChrome()) return;
            if (ev.button != null && ev.button !== 0) return;
            longPressFired = false;
            clearLongPress();
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                longPressFired = true;
                try {
                    tHome.releasePointerCapture?.(ev.pointerId);
                } catch {
                    /* ignore */
                }
                openSwitcher();
            }, HOME_LONG_PRESS_MS);
            try {
                tHome.setPointerCapture?.(ev.pointerId);
            } catch {
                /* ignore */
            }
        },
        { capture: true }
    );

    const endHomePress = (): void => {
        clearLongPress();
    };
    tHome.addEventListener("pointerup", endHomePress, { capture: true });
    tHome.addEventListener("pointercancel", endHomePress, { capture: true });

    tHome.addEventListener("contextmenu", (ev) => {
        if (!isMobileChrome()) return;
        ev.preventDefault();
        longPressFired = true;
        clearLongPress();
        openSwitcher();
    });

    tViewer.addEventListener("click", () => {
        const desc = findWindowDesc("viewer") || findWindowDesc("markdown");
        if (desc) {
            activateWindowTask(String(desc.id || "viewer").toLowerCase());
            return;
        }
        getBy(taskList, VIEWER_TASK)!.focus = true;
    });

    tViewer.addEventListener("contextmenu", (ev) => {
        const desc = findWindowDesc("viewer") || findWindowDesc("markdown");
        if (!desc) {
            if (isMobileChrome()) return;
            ev.preventDefault();
            openUnifiedContextMenu({
                x: ev.clientX,
                y: ev.clientY,
                compact: true,
                anchor: tViewer,
                items: [
                    {
                        id: "open-markdown",
                        label: "Open Markdown",
                        icon: "article",
                        action: () => opts.onViewer()
                    }
                ]
            });
            return;
        }
        openTaskContextMenu(ev, String(desc.id || "viewer"), desc.title || "Markdown");
    });

    const onDocPointer = (ev: Event): void => {
        if (!switcherOpen) return;
        const path = typeof (ev as PointerEvent).composedPath === "function" ? (ev as PointerEvent).composedPath() : [];
        for (const n of path) {
            if (n === switcher || n === tHome) return;
            if (n instanceof Element && (n === switcher || switcher.contains(n) || n === tHome)) return;
        }
        closeSwitcher();
    };
    document.addEventListener("pointerdown", onDocPointer, { capture: true });
    cleanupFns.push(() => document.removeEventListener("pointerdown", onDocPointer, { capture: true } as EventListenerOptions));

    const paintActive = (): void => {
        const id = String(opts.focusedTaskId.value || "home");
        const mark = (el: HTMLElement, active: boolean) => {
            el.toggleAttribute("data-env-active", active);
            el.toggleAttribute("data-active", active);
            el.toggleAttribute("data-focus", active);
        };
        mark(tHome, id === "home");
        mark(tViewer, id === "viewer" || id === "markdown");
        for (const [viewId, el] of windowTaskEls) {
            mark(el, id === viewId);
        }
    };

    effect(
        () => {
            paintActive();
        },
        [opts.focusedTaskId],
        { triggerImmediately: true }
    );

    const ensureWindowTask = (desc: EnvWindowTaskDescriptor): void => {
        const viewId = String(desc.id || "").trim().toLowerCase();
        if (!viewId || viewId === "home") return;
        const taskId = winTaskId(viewId);
        const title = desc.title || viewId;
        const iconName = String(desc.icon || "").trim() || "app-window";
        let el = windowTaskEls.get(viewId);
        if (!el) {
            const task = makeTask(
                taskId,
                null,
                { title, icon: iconName },
                { viewId },
                function (this: ITask) {
                    for (const t of taskList) {
                        if (t !== this) t.active = false;
                    }
                    this.active = true;
                    activateWindowTask(viewId);
                }
            );
            task.list = taskList;
            taskList.push(task);

            el = document.createElement("ui-task");
            // WHY: set attrs before connect so first UITask render sees real title/icon.
            el.setAttribute("data-id", taskId);
            el.setAttribute("data-view", viewId);
            el.setAttribute("title", title);
            el.setAttribute("aria-label", title);
            el.setAttribute("icon", iconName);
            el.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                // Direct toggle path — do not use `task.focus = true` (no-op when already focused).
                activateWindowTask(viewId);
            });
            el.addEventListener("contextmenu", (ev) => {
                openTaskContextMenu(ev, viewId, title);
            });
            windowTaskEls.set(viewId, el);
            windowsHost.appendChild(el);
        }
        el.setAttribute("title", title);
        el.setAttribute("aria-label", title);
        el.setAttribute("icon", iconName);
        el.toggleAttribute("data-minimized", Boolean(desc.minimized));
        el.hidden = desc.visible === false;
    };

    const syncWindowTasks = (windows: EnvWindowTaskDescriptor[]): void => {
        lastWindows = Array.isArray(windows) ? windows.slice() : [];
        const seen = new Set<string>();
        for (const w of windows) {
            const id = String(w.id || "").trim().toLowerCase();
            if (!id || id === "home") continue;
            seen.add(id);
            ensureWindowTask(w);
            if (w.focused) {
                opts.focusedTaskId.value = id;
            }
        }
        for (const [viewId, el] of [...windowTaskEls.entries()]) {
            if (seen.has(viewId)) continue;
            const taskId = winTaskId(viewId);
            const t = getBy(taskList, taskId);
            if (t) {
                const idx = taskList.indexOf(t);
                if (idx >= 0) taskList.splice(idx, 1);
            }
            el.remove();
            windowTaskEls.delete(viewId);
        }
        paintActive();
        if (switcherOpen) openSwitcher();
    };

    const setFocusedTaskId = (id: string): void => {
        const raw = String(id || "home").toLowerCase();
        let taskId = HOME_TASK;
        if (raw === "viewer" || raw === "markdown") taskId = VIEWER_TASK;
        else if (raw !== "home") taskId = winTaskId(raw);

        const t = getBy(taskList, taskId);
        if (t) {
            for (const x of taskList) {
                if (x !== t) x.active = false;
            }
            t.active = true;
        }
        opts.focusedTaskId.value = raw === "markdown" ? "viewer" : raw;
        paintActive();
    };

    const syncAcrylicUnder = (): void => {
        const desktop = !isMobileChrome();
        if (desktop) {
            if (!barUnder && bar.isConnected) {
                barUnder = createPanelUnderShadow(bar, {
                    className: "env-shell-taskbar-under",
                    shadowBlur: 28,
                    shadowOffsetY: 8,
                    shadowColor: "rgba(0, 0, 0, 0.4)"
                });
            }
        } else if (barUnder) {
            barUnder.destroy();
            barUnder = null;
        }
    };

    queueMicrotask(syncAcrylicUnder);
    const mq =
        typeof matchMedia === "function" ? matchMedia("(min-width: 641px)") : null;
    const onMq = (): void => syncAcrylicUnder();
    mq?.addEventListener?.("change", onMq);
    cleanupFns.push(() => mq?.removeEventListener?.("change", onMq));

    const dispose = (): void => {
        clearLongPress();
        closeSwitcher();
        barUnder?.destroy();
        barUnder = null;
        for (const fn of cleanupFns) {
            try {
                fn();
            } catch {
                /* ignore */
            }
        }
        cleanupFns.length = 0;
        windowTaskEls.clear();
        windowsHost.replaceChildren();
    };

    return { element: bar, taskList, setFocusedTaskId, syncWindowTasks, dispose };
}
