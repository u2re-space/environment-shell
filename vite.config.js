/**
 * Environment shell HTTPS demo.
 * Port 443 + certs via shared helpers (see markdown-view).
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { getViewResolveAliases, workspaceRoot, viewsRoot } from "../../views/view-resolve-aliases.js";
import { tryLoadDevSslFromDir } from "../../views/shared/vite.view.config.js";

const pkgRoot = resolve(import.meta.dirname);
const crosswordFrontend = resolve(workspaceRoot, "apps/CrossWord/src/frontend");
const shellsRoot = resolve(workspaceRoot, "modules/shells");
const sharedSrc = resolve(workspaceRoot, "modules/shared/src");
const subsystemSrc = resolve(workspaceRoot, "modules/projects/subsystem/src");

function resolveDevServerPort() {
    const raw = process.env.VIEW_DEV_PORT;
    if (raw != null && String(raw).trim() !== "") {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 443;
    }
    return 443;
}

const port = resolveDevServerPort();
const useHttps = process.env.VIEW_DEV_HTTP !== "1";
const projectSsl = tryLoadDevSslFromDir(pkgRoot, { sslDir: "certs" });
const plugins = useHttps ? (projectSsl !== null ? [] : [basicSsl()]) : [];
const serverHttps = !useHttps ? false : projectSsl !== null ? projectSsl : undefined;

const viteDevOrigin = (process.env.VITE_DEV_ORIGIN || "").trim();

const fsAllow = [
    searchForWorkspaceRoot(pkgRoot),
    workspaceRoot,
    viewsRoot,
    resolve(workspaceRoot, "modules/views"),
    shellsRoot
];
if (existsSync(crosswordFrontend)) fsAllow.push(crosswordFrontend);

export default defineConfig({
    root: pkgRoot,
    plugins,
    resolve: {
        alias: getViewResolveAliases(pkgRoot, [
            {
                /* WHY: `getViewResolveAliases` + local `views/*` do not resolve this package — demo dynamic import uses `views/home-view`. */
                find: "views/home-view",
                replacement: resolve(viewsRoot, "home-view/src/index.ts")
            },
            { find: "core/config/Settings", replacement: resolve(sharedSrc, "other/config/Settings.ts") },
            { find: "core/config/SettingsTypes", replacement: resolve(sharedSrc, "other/config/SettingsTypes.ts") },
            /* WHY: Settings UI expects async {@link loadSettings} + registry snapshot (not subsystem/runtime stubs). */
            { find: "com/config/Settings", replacement: resolve(sharedSrc, "other/config/Settings.ts") },
            { find: "com/config/SettingsTypes", replacement: resolve(sharedSrc, "other/config/SettingsTypes.ts") },
            { find: "com/config/Names", replacement: resolve(sharedSrc, "other/config/Names.ts") },
            {
                find: "com/core/UniformInterop",
                replacement: resolve(sharedSrc, "routing/channel/UniformInterop.ts")
            },
            {
                find: "com/service/instructions/CustomInstructions",
                replacement: resolve(subsystemSrc, "service/instructions/CustomInstructions.ts")
            }
        ])
    },
    server: {
        host: "0.0.0.0",
        open: false,
        strictPort: false,
        port,
        ...(viteDevOrigin ? { origin: viteDevOrigin } : {}),
        https: serverHttps,
        fs: {
            allow: fsAllow
        }
    },
    build: {
        target: "esnext",
        outDir: "dist",
        emptyOutDir: true,
        /* WHY: lightningcss minify fails on some Veela `::slotted` shapes (same as markdown-view). */
        cssMinify: false,
        rollupOptions: {
            input: {
                main: resolve(pkgRoot, "index.html")
            }
        }
    },
    css: {
        preprocessorOptions: {
            scss: {
                quietDeps: true
            }
        }
    }
});
