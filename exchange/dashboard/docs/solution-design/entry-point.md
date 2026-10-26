# Entry point

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

[`src/index.tsx`](../../src/index.tsx) mounts `<App/>` under `<React.StrictMode>`, loads the `kiao-style`
CSS (tools + dark + light themes), and logs `BUILD_DATETIME` (injected by `vite.config.ts`). `App`
chooses the secured vs no-security tree based on `securityEnabled` (`VITE_NO_SECURITY`). `ThemeProvider` is *not* here:
the theme is stored in the view-state file, so it mounts inside `MainApp` below the providers that
can read it, and [`index.html`](../../index.html) carries `data-theme="dark"` to style the screens shown
before that.

**Installing it.** The same file names the web app manifest, which is what lets a browser install
Dashboard as an application of its own rather than a tab. The manifest is a static file,
[`public/manifest.json`](../../public/manifest.json), rather than something `vite-plugin-pwa` generates:
a `VITE_NO_SERVICE_WORKER` build drops that plugin entirely and would take a generated manifest
with it, and a file under `public/` is copied verbatim, so every URL in it stays relative and
follows `VITE_BASE_PATH`. It has to be the **only** manifest the page names — a browser reads the
first link and ignores the rest — with an icon of at least 192px, or Chromium never offers the
install. `checkInstallable` in
[`scripts/build-assembly.mjs`](../../scripts/build-assembly.mjs) fails the build on any of it.
