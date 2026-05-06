/**
 * WHY: Desktop shell chrome — `ui-taskbar` + `ui-task` from FL-UI, `fest/lure` tasking `makeTask` / `getBy`,
 * and the same reactive device tray as {@link buildShellDeviceTray} (desktop-only via CSS).
 */
import { UITask, UITaskBar } from "fest/fl-ui";
import { effect, observe, type refType } from "fest/object";
import { getBy, makeTask, navigationEnable, type ITask } from "fest/lure";

import { buildShellDeviceTray, type ShellDeviceStatus } from "./statusbar";

void UITaskBar;
void UITask;

export type EnvironmentTaskbarOptions = {
    device: ShellDeviceStatus;
    onHome: () => void;
    onViewer: () => void;
    /** Which task is highlighted (home | viewer). */
    focusedTaskId: refType<string>;
};

export type MountTaskBarResult = {
    element: HTMLElement;
    taskList: ITask[];
    setFocusedTaskId: (id: "home" | "viewer") => void;
    dispose: () => void;
};

/**
 * Task bar with Home / Markdown (viewer) tasks (tasking back-nav registration) and reactive system tray.
 */
export function mountEnvironmentTaskBar(opts: EnvironmentTaskbarOptions): MountTaskBarResult {
    const taskList = observe<ITask[]>([]);
    navigationEnable(taskList);

    makeTask("#env-home", taskList, { title: "Home", icon: "house" }, {}, function (this: ITask) {
        for (const t of taskList) {
            if (t !== this) t.active = false;
        }
        this.active = true;
        opts.focusedTaskId.value = "home";
        opts.onHome();
    });

    makeTask("#env-viewer", taskList, { title: "Markdown", icon: "article" }, {}, function (this: ITask) {
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

    const tHome = document.createElement("ui-task");
    tHome.setAttribute("title", "Home");
    tHome.setAttribute("icon", "house");
    tHome.addEventListener("click", () => {
        getBy(taskList, "#env-home")!.focus = true;
    });

    const tViewer = document.createElement("ui-task");
    tViewer.setAttribute("title", "Markdown");
    tViewer.setAttribute("icon", "article");
    tViewer.addEventListener("click", () => {
        getBy(taskList, "#env-viewer")!.focus = true;
    });

    const trayHost = document.createElement("div");
    trayHost.className = "env-shell-taskbar__tray-host";
    trayHost.appendChild(buildShellDeviceTray(opts.device, "env-device-tray env-device-tray--taskbar"));

    bar.append(tHome, tViewer, trayHost);

    effect(
        () => {
            const id = opts.focusedTaskId.value;
            tHome.toggleAttribute("data-env-active", id === "home");
            tViewer.toggleAttribute("data-env-active", id === "viewer");
        },
        [opts.focusedTaskId],
        { triggerImmediately: true }
    );

    const setFocusedTaskId = (id: "home" | "viewer"): void => {
        const taskId = id === "home" ? "#env-home" : "#env-viewer";
        const t = getBy(taskList, taskId);
        if (t) {
            for (const x of taskList) {
                if (x !== t) x.active = false;
            }
            t.active = true;
        }
        opts.focusedTaskId.value = id;
    };

    const dispose = (): void => {
        /* NOTE: taskList / navigationEnable listeners persist for page lifetime; full teardown not wired. */
    };

    return { element: bar, taskList, setFocusedTaskId, dispose };
}
