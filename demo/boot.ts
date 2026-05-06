/**
 * WHY: Full environment demo — HTTPS :443, `ui-canvas` wallpaper (`/assets/stock.jpg`),
 * oriented home launcher, floating view windows over home, FL-UI `ui-statusbar` + `ui-taskbar` (tasking).
 */
import type { ShellContext } from "views/types";
import { ref } from "fest/object";
import "fest/icon";
import { initializeAppCanvasLayer } from "fest/image";

import "../../window-frame/public/demo/wf-demo.css";
import "../src/scss/main.scss";

import { mountViewModule } from "../../window-frame/src/views/view-mount.ts";
import { buildViewerView } from "../../window-frame/src/views/viewer-view.ts";
import { createWorkspaceWindowLayer } from "../src/workspace-window-layer.ts";
import { mountEnvironmentChrome, seedEnvironmentWallpaperIfUnset } from "../src/index";

seedEnvironmentWallpaperIfUnset("/assets/stock.jpg");

const selectedPath = ref("/demo/sample.md");
const viewerStatus = ref("(idle)");
const navEcho = ref("");
const focusedTaskId = ref<"home" | "viewer">("home");

const viewerBody = buildViewerView(selectedPath, viewerStatus);

let setFocusedTaskId: ((id: "home" | "viewer") => void) | null = null;

const app = document.getElementById("app") ?? document.body;
app.classList.add("env-shell-root", "wf-demo-root");

const wallpaperHost = document.createElement("div");
wallpaperHost.className = "env-shell-wallpaper";
initializeAppCanvasLayer(wallpaperHost);
app.appendChild(wallpaperHost);

const workspace = document.createElement("div");
workspace.className = "env-shell-workspace";
app.appendChild(workspace);

const viewWindows = createWorkspaceWindowLayer(workspace, {
    readerWindow: {
        title: "Markdown",
        content: viewerBody,
        seed: { x: 96, y: 96, w: 420, h: 340 }
    }
});

function focusHomeShell(): void {
    setFocusedTaskId?.("home");
}

function openViewerForShell(): void {
    selectedPath.value = "/demo/sample.md";
    if (!viewWindows.focusWindow("viewer")) {
        void viewWindows.shellContext.openView?.("viewer");
    }
    setFocusedTaskId?.("viewer");
}

const shellContext: ShellContext = {
    navigate: (viewId, opts) => {
        navEcho.value = `shell.navigate("${viewId}")`;
        const id = String(viewId || "").trim();
        if (id === "home") {
            focusHomeShell();
            return;
        }
        void viewWindows.shellContext.navigate?.(id, opts);
    },
    openView: (viewId, opts) => {
        navEcho.value = `shell.openView("${viewId}")`;
        const id = String(viewId || "").trim();
        if (id === "home") {
            focusHomeShell();
            return;
        }
        void viewWindows.shellContext.openView?.(id, opts);
    },
    showMessage: (msg) => {
        navEcho.value = `shell.showMessage(${JSON.stringify(msg).slice(0, 160)})`;
    }
};

void mountViewModule(() => import("views/home-view"), workspace, { shellContext }).catch((err) => {
    console.warn("[environment-shell] home-view failed", err);
    workspace.innerHTML =
        `<p style="color:#eee;padding:1rem;font-family:system-ui">Home view failed to load. Check console.</p>`;
});

const introHtml = `<p><strong>${location.protocol}//${location.host}/</strong> — Wallpaper: ui-canvas + stock.jpg. Desktop: desk panel; phone: launcher. Drag window title strip. SpeedDial opens views in frames above home.</p>`;

const mobileMq = matchMedia("(max-width: 640px)");
const mqLabel = ref(mobileMq.matches ? "mobile" : "desktop");
mobileMq.addEventListener("change", () => {
    mqLabel.value = mobileMq.matches ? "mobile" : "desktop";
});

const chromeResult = mountEnvironmentChrome(app, {
    shell: { selectedPath, viewerStatus, navEcho, mqLabel },
    introHtml,
    taskbar: {
        focusedTaskId,
        onHome: () => {
            navEcho.value = "task.home";
            focusHomeShell();
        },
        onViewer: () => {
            openViewerForShell();
        }
    }
});
setFocusedTaskId = chromeResult.taskbar?.setFocusedTaskId ?? null;
