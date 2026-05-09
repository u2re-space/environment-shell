/**
 * Multi-layer environment host: `underlying` (back), default `main` content, `overlay` (front).
 * Aligns with {@link SHELL_SLOT} from `boot/shell-slots` for cross-shell consistency.
 */
//@ts-ignore vite inline
import containerStyles from "./scss/environment-shell-container.scss?inline";

import { SHELL_SLOT } from "boot/shell-slots";

export const ENV_SHELL_CONTAINER_TAG = "env-shell-container";

export interface EnvironmentShellContainerElement extends HTMLElement {
    /** Shadow `[data-shell-overlays]` — use with {@link resolveShellOverlaysMount}. */
    readonly overlayMount: HTMLElement | null;
}

declare global {
    interface HTMLElementTagNameMap {
        "env-shell-container": EnvironmentShellContainerElement;
    }
}

const template = document.createElement("template");
template.innerHTML = `
<div class="esc-stack" part="stack">
  <div class="esc-layer esc-underlying" part="underlying">
    <slot name="${SHELL_SLOT.underlying}"></slot>
  </div>
  <div class="esc-layer esc-main" part="main" data-shell-content role="main">
    <slot></slot>
  </div>
  <div
    class="esc-layer esc-overlays"
    part="overlays"
    data-shell-overlays
    data-env-shell-overlays
  >
    <slot name="${SHELL_SLOT.overlay}"></slot>
  </div>
</div>`;

class EnvironmentShellContainer extends HTMLElement implements EnvironmentShellContainerElement {
    get overlayMount(): HTMLElement | null {
        return this.shadowRoot?.querySelector("[data-shell-overlays]") ?? null;
    }

    constructor() {
        super();
        const root = this.attachShadow({ mode: "open" });
        root.appendChild(template.content.cloneNode(true));
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(containerStyles as string);
        root.adoptedStyleSheets = [sheet];
        this.style.display = "block";
        this.style.boxSizing = "border-box";
    }
}

let defined = false;

/** Registers `<env-shell-container>` once (open shadow, three named layers). */
export function defineEnvironmentShellContainer(): typeof EnvironmentShellContainer {
    if (!defined && !customElements.get(ENV_SHELL_CONTAINER_TAG)) {
        customElements.define(ENV_SHELL_CONTAINER_TAG, EnvironmentShellContainer);
        defined = true;
    }
    return EnvironmentShellContainer;
}

export function isEnvironmentShellContainerHost(el: unknown): el is EnvironmentShellContainerElement {
    return el instanceof HTMLElement && el.localName === ENV_SHELL_CONTAINER_TAG;
}
