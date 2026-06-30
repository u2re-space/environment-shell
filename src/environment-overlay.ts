/**
 * Stacking root for transient UI when the app has no `cw-shell-*` element (typical environment demo).
 * Create once under e.g. `#app` / `.env-shell-root`; mount menus/modals as children (use pointer-events on children).
 */

import { isEnvironmentShellContainerHost } from "./environment-shell-container";
import { SHELL_SLOT } from "boot/shell-slots";

export const ENV_SHELL_OVERLAYS_ATTR = "data-env-shell-overlays";

/** Z-order above `.wf-frame` (+ `--env-window-z-boost`) and env chrome — see `_variables.scss` $z-shell-chrome. */
const ENV_OVERLAY_Z = "2147483600";

export function getOrCreateEnvironmentOverlayMount(host: HTMLElement): HTMLElement {
    const sel = `[${ENV_SHELL_OVERLAYS_ATTR}]`;
    const existing = host.querySelector(sel) as HTMLElement | null;
    if (existing) return existing;
    const el = document.createElement("div");
    el.setAttribute(ENV_SHELL_OVERLAYS_ATTR, "");
    el.className = "env-shell-overlays";
    el.setAttribute("data-part", "env-overlays");
    /* WHY: Slotted under `<env-shell-container>` shadow overlay layer instead of leaking into default (main). */
    if (isEnvironmentShellContainerHost(host)) {
        el.slot = SHELL_SLOT.overlay;
        el.style.cssText = "position:absolute;inset:0;pointer-events:none;box-sizing:border-box;";
        host.appendChild(el);
        return el;
    }
    el.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${ENV_OVERLAY_Z};box-sizing:border-box;`;
    host.appendChild(el);
    return el;
}
