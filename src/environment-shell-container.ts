/*
 * Filename: environment-shell-container.ts
 * FullPath: modules/shells/environment-shell/src/environment-shell-container.ts
 * Change date and time: 07.10.00_29.07.2026
 * Reason for changes: Fix createElement NotSupportedError — no host attributes in constructor.
 */
/**
 * Multi-layer environment host: `underlying` (back), default `main` content, `overlay` (front).
 * Aligns with {@link SHELL_SLOT} from `boot/shell-slots` for cross-shell consistency.
 *
 * INVARIANT: Custom element constructor must NOT set attributes (incl. via `element.style`).
 * Chromium throws `NotSupportedError: The result must not have attributes` on
 * `document.createElement("env-shell-container")` if the constructor writes attrs.
 * Host display/box-sizing live in `:host` SCSS instead.
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
    #ready = false;

    get overlayMount(): HTMLElement | null {
        this.#ensureShadow();
        return this.shadowRoot?.querySelector("[data-shell-overlays]") ?? null;
    }

    constructor() {
        super();
        // WHY: only attach shadow + clone template — never setAttribute / .style here.
        this.#ensureShadow();
    }

    connectedCallback(): void {
        this.#ensureShadow();
    }

    #ensureShadow(): void {
        if (this.#ready && this.shadowRoot) return;
        const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        if (!root.querySelector(".esc-stack")) {
            root.appendChild(template.content.cloneNode(true));
        }
        if (root.adoptedStyleSheets.length === 0) {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(containerStyles as string);
            root.adoptedStyleSheets = [sheet];
        }
        this.#ready = true;
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

/**
 * Safe factory — prefers `new` after define so constructor attribute rules are explicit.
 * Falls back to `createElement` once the CE is upgraded.
 */
export function createEnvironmentShellContainer(): EnvironmentShellContainerElement {
    defineEnvironmentShellContainer();
    const Ctor = customElements.get(ENV_SHELL_CONTAINER_TAG) as
        | (new () => EnvironmentShellContainerElement)
        | undefined;
    if (Ctor) {
        try {
            return new Ctor();
        } catch (err) {
            console.warn("[env-shell-container] `new` failed, falling back to createElement", err);
        }
    }
    return document.createElement(ENV_SHELL_CONTAINER_TAG) as EnvironmentShellContainerElement;
}

export function isEnvironmentShellContainerHost(el: unknown): el is EnvironmentShellContainerElement {
    return el instanceof HTMLElement && el.localName === ENV_SHELL_CONTAINER_TAG;
}
