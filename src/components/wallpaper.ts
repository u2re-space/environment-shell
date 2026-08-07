/**
 * WHY: Wallpaper is served by `initializeAppCanvasLayer` in `fest/image` (Canvas-2 / `ui-canvas`).
 * Demos: set `localStorage["rs-wallpaper-image"]` or default `/assets/stock.jpg`, then call that helper.
 * Orient: layer syncs `data-orient` / `orient` via {@link syncCanvasOrient} (whenAnyScreenChanges).
 */
export {
    initializeAppCanvasLayer,
    setAppWallpaper,
    syncAppWallpaperOrient,
    syncCanvasOrient,
    applyThemeFromWallpaper,
    applyWallpaperThemeSeeds,
    restoreWallpaperThemeCache,
} from "@fest-lib/image";
