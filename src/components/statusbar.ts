/**
 * WHY: Uses FL-UI `ui-statusbar` (left/center/right slots) — not a parallel component.
 * Reactive network/battery chips are shared via {@link attachShellDeviceStatus} for the desktop taskbar.
 */
import { StatusBar } from "fest/fl-ui";
import { E, H } from "fest/lure";
import { effect, ref, type refType } from "fest/object";

void StatusBar;

export type EnvironmentShellStatusRefs = {
    selectedPath: refType<string>;
    viewerStatus: refType<string>;
    navEcho: refType<string>;
    mqLabel: refType<string>;
};

type NavConn = EventTarget & {
    effectiveType?: string;
    downlink?: number;
    saveData?: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
};

function connectionOf(nav: Navigator): NavConn | undefined {
    return (nav as Navigator & { connection?: NavConn }).connection;
}

function networkIconForEffectiveType(etRaw: string): string {
    const et = etRaw.toLowerCase();
    if (et === "slow-2g") return "wifi-low";
    if (et === "2g") return "wifi-medium";
    return "wifi-high";
}

/** Single subscription for battery + network; bind into multiple `H` trays with the same refs. */
export type ShellDeviceStatus = {
    networkIcon: refType<string>;
    networkTitle: refType<string>;
    batteryIcon: refType<string>;
    batteryTitle: refType<string>;
    batteryPct: refType<string>;
    dispose: () => void;
};

export function attachShellDeviceStatus(): ShellDeviceStatus {
    const networkIcon = ref("wifi-high");
    const networkTitle = ref("");
    const batteryIcon = ref("battery-full");
    const batteryTitle = ref("");
    const batteryPct = ref("");

    const syncNetwork = (): void => {
        if (!navigator.onLine) {
            networkIcon.value = "wifi-slash";
            networkTitle.value = "Offline";
            return;
        }
        const c = connectionOf(navigator);
        if (!c || typeof c.effectiveType !== "string") {
            networkIcon.value = "globe";
            networkTitle.value = "Online (connection details unavailable)";
            return;
        }
        const et = String(c.effectiveType || "").toLowerCase();
        const down = typeof c.downlink === "number" ? `${c.downlink} Mb/s` : "";
        const save = c.saveData ? " · Data saver" : "";
        networkTitle.value = [et.toUpperCase(), down].filter(Boolean).join(" · ") + save;
        networkIcon.value = networkIconForEffectiveType(et);
    };

    let batteryLevelHandler: (() => void) | null = null;
    let batteryChargingHandler: (() => void) | null = null;
    let batteryManager: EventTarget | null = null;

    const applyBattery = (level: number, charging: boolean): void => {
        const pct = Math.max(0, Math.min(100, Math.round(level * 100)));
        batteryPct.value = `${pct}%`;
        if (charging) {
            batteryIcon.value = "battery-charging-vertical";
            batteryTitle.value = `Charging · ${batteryPct.value}`;
            return;
        }
        batteryTitle.value = `Battery · ${batteryPct.value}`;
        if (level <= 0.08) batteryIcon.value = "battery-warning";
        else if (level <= 0.22) batteryIcon.value = "battery-low";
        else if (level <= 0.5) batteryIcon.value = "battery-medium";
        else if (level <= 0.8) batteryIcon.value = "battery-high";
        else batteryIcon.value = "battery-full";
    };

    syncNetwork();
    window.addEventListener("online", syncNetwork);
    window.addEventListener("offline", syncNetwork);
    const conn = connectionOf(navigator);
    conn?.addEventListener?.("change", syncNetwork);

    if (typeof navigator.getBattery === "function") {
        void navigator.getBattery().then((b) => {
            batteryManager = b;
            batteryLevelHandler = () => applyBattery(b.level, b.charging);
            batteryChargingHandler = batteryLevelHandler;
            b.addEventListener("levelchange", batteryLevelHandler);
            b.addEventListener("chargingchange", batteryChargingHandler);
            applyBattery(b.level, b.charging);
        });
    } else {
        batteryIcon.value = "question";
        batteryTitle.value = "Battery status not supported in this browser";
        batteryPct.value = "—";
    }

    const dispose = (): void => {
        window.removeEventListener("online", syncNetwork);
        window.removeEventListener("offline", syncNetwork);
        conn?.removeEventListener?.("change", syncNetwork);
        if (batteryManager && batteryLevelHandler && batteryChargingHandler) {
            batteryManager.removeEventListener("levelchange", batteryLevelHandler);
            batteryManager.removeEventListener("chargingchange", batteryChargingHandler);
        }
    };

    return { networkIcon, networkTitle, batteryIcon, batteryTitle, batteryPct, dispose };
}

/** Reactive tray; use two instances (taskbar + footer) with visibility toggled by CSS — same refs update both. */
export function buildShellDeviceTray(device: ShellDeviceStatus, trayClass: string): HTMLElement {
    const row = H`<div class="env-status-bar__tray ${trayClass}">
        <span class="env-status-bar__chip" title=${device.networkTitle} aria-label=${device.networkTitle}>
            <ui-icon icon=${device.networkIcon} aria-hidden="true"></ui-icon>
        </span>
        <span class="env-status-bar__chip" title=${device.batteryTitle} aria-label=${device.batteryTitle}>
            <ui-icon icon=${device.batteryIcon} aria-hidden="true"></ui-icon>
            <span class="env-status-bar__pct"></span>
        </span>
    </div>` as HTMLElement;

    const pctSpan = row.querySelector(".env-status-bar__pct");
    if (pctSpan instanceof HTMLElement) {
        E(pctSpan, { properties: { textContent: device.batteryPct } });
    }
    return row;
}

export type MountStatusBarResult = {
    element: HTMLElement;
    dispose: () => void;
};

/**
 * `ui-statusbar`: intro (left), shell meta (center), device tray (right, hidden on desktop when taskbar shows icons).
 */
export function mountEnvironmentStatusBar(
    shell: EnvironmentShellStatusRefs,
    introInnerHtml: string,
    device: ShellDeviceStatus
): MountStatusBarResult {
    const bar = document.createElement("ui-statusbar");
    bar.className = "env-ui-statusbar wf-chrome-no-select";
    bar.setAttribute("part", "status-bar");

    const left = document.createElement("div");
    left.slot = "left";
    left.className = "env-ui-statusbar__intro";
    if (introInnerHtml) left.innerHTML = introInnerHtml;

    const center = document.createElement("div");
    center.slot = "center";
    const meta = document.createElement("p");
    meta.className = "env-status-bar__meta";
    center.appendChild(meta);

    const right = document.createElement("div");
    right.slot = "right";
    right.className = "env-ui-statusbar__right";
    right.appendChild(buildShellDeviceTray(device, "env-device-tray env-device-tray--footer"));

    bar.append(left, center, right);

    effect(
        () => {
            const nav = shell.navEcho.value ? ` │ ${shell.navEcho.value}` : "";
            meta.textContent = `doc=${shell.selectedPath.value} │ viewer=${shell.viewerStatus.value} │ layout=${shell.mqLabel.value}${nav}`;
        },
        [shell.selectedPath, shell.viewerStatus, shell.mqLabel, shell.navEcho],
        { triggerImmediately: true }
    );

    const dispose = (): void => {
        /* Host disposes {@link ShellDeviceStatus} once (shared with taskbar). */
    };

    return { element: bar, dispose };
}
