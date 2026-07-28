/*
 * Filename: taskbar.ts
 * FullPath: modules/shells/environment-shell/src/components/taskbar.ts
 * Change date and time: 06.40.00_29.07.2026
 * Reason for changes: Desktop taskbar — show on desktop, dynamic window tasks, focus sync.
 */
/**
 * WHY: Desktop shell chrome — `ui-taskbar` + `ui-task` from FL-UI, `fest/lure` tasking `makeTask` / `getBy`,
 * and the same reactive device tray as {@link buildShellDeviceTray} (desktop-only via CSS + data-desktop).
 */
import { UITask, UITaskBar } from "fest/fl-ui";
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

function winTaskId(viewId: string): string {
    return `${WIN_TASK_PREFIX}${String(viewId || "").trim().toLowerCase()}`;
}

function viewIdFromTask(taskId: string): string | null {
    const raw = String(taskId || "").replace(/^#/, "");
    if (raw.startsWith("env-win-")) return raw.slice("env-win-".length);
    return null;
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
    tHome.addEventListener("click", () => {
        getBy(taskList, HOME_TASK)!.focus = true;
    });

    const tViewer = document.createElement("ui-task");
    tViewer.setAttribute("title", "Markdown");
    tViewer.setAttribute("icon", "article");
    tViewer.setAttribute("data-id", VIEWER_TASK);
    tViewer.addEventListener("click", () => {
        getBy(taskList, VIEWER_TASK)!.focus = true;
    });

    pinsHost.append(tHome, tViewer);

    const trayHost = document.createElement("div");
    trayHost.className = "env-shell-taskbar__tray-host";
    trayHost.appendChild(buildShellDeviceTray(opts.device, "env-device-tray env-device-tray--taskbar"));

    bar.append(pinsHost, windowsHost, trayHost);

    const windowTaskEls = new Map<string, HTMLElement>();

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
        windowTaskEls.clear();
        windowsHost.replaceChildren();
        /* NOTE: taskList / navigationEnable listeners persist for page lifetime; full teardown not wired. */
    };

    void viewIdFromTask;

    return { element: bar, taskList, setFocusedTaskId, syncWindowTasks, dispose };
}
