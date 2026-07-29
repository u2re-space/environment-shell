/*
 * Filename: taskbar.ts
 * FullPath: modules/shells/environment-shell/src/components/taskbar.ts
 * Change date and time: 13.15.00_29.07.2026
 * Reason for changes: Mobile nav bar — icon Home + long-press open-process switcher.
 */
/**
 * WHY: Desktop shell chrome — `ui-taskbar` + `ui-task` from FL-UI, `fest/lure` tasking `makeTask` / `getBy`,
 * and the same reactive device tray as {@link buildShellDeviceTray} (desktop-only via CSS + data-desktop).
 * Mobile: thin nav bar, centered house icon; long-press lists open windows.
 */
import { UITask, UITaskBar } from "fest/fl-ui";
import "fest/icon";
import { effect, observe, type refType } from "fest/object";
import { getBy, makeTask, navigationEnable, type ITask } from "fest/lure";

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

function winTaskId(viewId: string): string {
    return `${WIN_TASK_PREFIX}${String(viewId || "").trim().toLowerCase()}`;
}

function viewIdFromTask(taskId: string): string | null {
    const raw = String(taskId || "").replace(/^#/, "");
    if (raw.startsWith("env-win-")) return raw.slice("env-win-".length);
    return null;
}

function isMobileChrome(): boolean {
    const chrome = document.querySelector(".env-shell-chrome");
    if (chrome instanceof HTMLElement && chrome.hasAttribute("data-desktop")) return false;
    if (chrome instanceof HTMLElement && chrome.dataset.chromeLayout === "mobile") return true;
    return typeof matchMedia === "function" && matchMedia("(max-width: 640px)").matches;
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
    tViewer.addEventListener("click", () => {
        getBy(taskList, VIEWER_TASK)!.focus = true;
    });

    pinsHost.append(tHome, tViewer);

    const trayHost = document.createElement("div");
    trayHost.className = "env-shell-taskbar__tray-host";
    trayHost.appendChild(buildShellDeviceTray(opts.device, "env-device-tray env-device-tray--taskbar"));

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
    const cleanupFns: Array<() => void> = [];

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
        // WHY: long-press already opened the switcher — suppress the Home navigation click.
        if (longPressFired) {
            ev.preventDefault();
            ev.stopPropagation();
            longPressFired = false;
            return;
        }
        if (!isMobileChrome()) {
            goHome();
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
    // WHY: do not cancel on pointerleave — small finger drift during hold would abort the switcher.
    tHome.addEventListener("pointerup", endHomePress, { capture: true });
    tHome.addEventListener("pointercancel", endHomePress, { capture: true });

    tHome.addEventListener("contextmenu", (ev) => {
        if (!isMobileChrome()) return;
        ev.preventDefault();
        longPressFired = true;
        clearLongPress();
        openSwitcher();
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
        let el = windowTaskEls.get(viewId);
        if (!el) {
            // WHY: makeTask with null list avoids auto-focus / history push on every open.
            const task = makeTask(
                taskId,
                null,
                { title: desc.title || viewId, icon: desc.icon || "app-window" },
                { viewId },
                function (this: ITask) {
                    for (const t of taskList) {
                        if (t !== this) t.active = false;
                    }
                    this.active = true;
                    opts.focusedTaskId.value = viewId;
                    opts.onWindowTask?.(viewId);
                }
            );
            task.list = taskList;
            taskList.push(task);

            el = document.createElement("ui-task");
            el.setAttribute("data-id", taskId);
            el.setAttribute("data-view", viewId);
            el.addEventListener("click", () => {
                const t = getBy(taskList, taskId);
                if (t) t.focus = true;
                else opts.onWindowTask?.(viewId);
            });
            windowTaskEls.set(viewId, el);
            windowsHost.appendChild(el);
        }
        el.setAttribute("title", desc.title || viewId);
        el.setAttribute("icon", desc.icon || "app-window");
        el.toggleAttribute("data-minimized", Boolean(desc.minimized));
        el.hidden = desc.visible === false;
    };

    const syncWindowTasks = (windows: EnvWindowTaskDescriptor[]): void => {
        lastWindows = Array.isArray(windows) ? windows.slice() : [];
        const seen = new Set<string>();
        for (const w of windows) {
            const id = String(w.id || "").trim().toLowerCase();
            if (!id || id === "home") continue;
            // Markdown is already a pin; still show as window chip when open (optional skip).
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

    const dispose = (): void => {
        clearLongPress();
        closeSwitcher();
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
        /* NOTE: taskList / navigationEnable listeners persist for page lifetime; full teardown not wired. */
    };

    void viewIdFromTask;

    return { element: bar, taskList, setFocusedTaskId, syncWindowTasks, dispose };
}
