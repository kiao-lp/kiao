---
status: DRAFT
role: PRIMARY_SOURCE
---

# Entry point

Part of the [Dashboard solution design](README.md).

[`src/index.tsx`](../../src/index.tsx) mounts `<App/>` under `<React.StrictMode>`, loads `kiao-style` CSS (tools + dark + light themes) and logs `BUILD_DATETIME` (injected by `vite.config.ts`). `App` selects the secured or no-security tree from `securityEnabled` (`VITE_NO_SECURITY`) and supplies its worker client to [DashboardApp](../../src/cms-core/dashboard-ui/app/DashboardApp.tsx). `ThemeProvider` mounts inside `DashboardApp`, below the providers that read the view-state file holding the theme. [`index.html`](../../index.html) carries `data-theme="dark"` for screens before that mount.

The web app manifest is the static file [`public/manifest.json`](../../public/manifest.json). `public/` files copy verbatim, so manifest URLs stay relative and follow `VITE_BASE_PATH`. A `VITE_NO_SERVICE_WORKER` build has no `vite-plugin-pwa` manifest. The page names exactly one manifest; browsers read only the first link. The icon is at least 192px, or Chromium offers no install. `checkInstallable` in [`scripts/build-assembly.mjs`](../../scripts/build-assembly.mjs) fails the build otherwise.
