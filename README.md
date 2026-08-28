# environment-shell

Полная среда рабочего стола: статусбар, taskbar, App Menu, flyout (календарь / QS), обои, плавающие `ui-window`.

Это оболочка CWSP-shell и New Tab. Views подключаются лениво через `createWorkspaceWindowLayer`.

```text
fl-ui + home-view + прочие views
 └── environment-shell
      └── CWSP-shell / CWSP-crx New Tab
```

## Установка в хосте

```ts
import {
    mountEnvironmentChrome,
    createWorkspaceWindowLayer,
    seedEnvironmentWallpaperIfUnset,
    ENV_SHELL_WALLPAPER_STORAGE_KEY
} from "environment-shell";

seedEnvironmentWallpaperIfUnset("/wallpapers/demo.jpg");
const chrome = mountEnvironmentChrome(host, { shell, taskbar: true, introHtml });
```

SCSS: `environment-shell/scss/main.scss`. На Capacitor статусбар системный (safe-area); web рисует `ui-statusbar`.

Куски: `mountEnvironmentStatusBar`, `mountEnvironmentTaskBar`, `getOrCreateEnvironmentOverlayMount`, `createEnvironmentShellContainer`.

## Демо

```bash
cd modules/shells/environment-shell
npm run ssl:localhost
npm run dev              # HTTPS :443
npm run dev:8434
```

Не править копии под `*/shells/environment`.
