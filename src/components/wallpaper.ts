/**
 * WHY: Wallpaper is served by `initializeAppCanvasLayer` in `fest/image` (Canvas-2 / `ui-canvas`).
 * Demos: set `localStorage["rs-wallpaper-image"]` or default `/assets/stock.jpg`, then call that helper.
 */
export { initializeAppCanvasLayer, setAppWallpaper } from "fest/image";
