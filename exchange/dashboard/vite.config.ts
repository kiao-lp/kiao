/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import svgr from 'vite-plugin-svgr';
import { VitePWA } from 'vite-plugin-pwa';
import { assembly } from './vite-plugins/assembly';
import { configDefaults } from 'vitest/config';
import { droppedTestGlobs, droppedTestExcludes } from './vite-plugins/assembly-shared.mjs';

// A service worker that uninstalls itself and drops every cache it left behind.
const SELF_DESTROYING_SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister()
      .then(() => self.caches.keys())
      .then((names) => Promise.all(names.map((name) => self.caches.delete(name))))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  );
});
`;

/**
 * Kill switch, in dev only, for a service worker left over from a production build.
 *
 * A production build registers a Workbox service worker at <base>sw.js with scope <base>.
 * Once any production build has been served on the port the dev server later
 * reuses, that worker survives and keeps serving its precached production index.html —
 * which loads the production bundle, whose hashed <base>assets/* URLs do not exist on
 * the dev server. SVGs are not precached, so their requests reach the dev server, hit the
 * SPA fallback, and come back as HTML: every icon renders as a broken image.
 *
 * The dev server has no sw.js of its own, so the browser's update check fetches that same
 * HTML and refuses it — the stale worker would otherwise never be evicted. Answering
 * <base>sw.js with a self-destroying worker makes that update check uninstall it.
 */
const killProductionServiceWorker = (basePath: string): Plugin => {
    const prefix = basePath.replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const swRequest = new RegExp(`^(${prefix})?/sw\\.js(\\?|$)`);
    return {
        name: 'kiao:kill-production-service-worker',
        apply: 'serve',
        configureServer(server) {
            // Registered here (not in a returned callback) so it runs before Vite's SPA fallback.
            server.middlewares.use((req, res, next) => {
                if (!req.url || !swRequest.test(req.url)) {
                    next();
                    return;
                }
                res.setHeader('Content-Type', 'text/javascript');
                res.setHeader('Cache-Control', 'no-store');
                res.end(SELF_DESTROYING_SW);
            });
        },
    };
};

// Where the app is served from. Everything that needs to know — the router basename, the OIDC
// redirect, the resolution of the links stored in documents — reads it back as
// import.meta.env.BASE_URL, so moving the app is this one value plus the reverse proxy in front.
const BASE_PATH = process.env.VITE_BASE_PATH || '/dashboard/';

/**
 * Whether the build ships a service worker. It does when the SPA is served over a network, where
 * precaching the bundle is what it is for.
 *
 * It does not for kiao (VITE_NO_SERVICE_WORKER=true), which serves the same bundle from the
 * same machine the files are on: there is nothing to be offline from, and the precache costs a real
 * bug. Every reinstall rebuilds the bundle under new hashes, and a worker still serving the
 * previous precached index.html boots the previous entry chunk — whose lazily imported chunks are
 * no longer on disk. The first mermaid diagram opened then fails with "Failed to fetch dynamically
 * imported module". See bin/kiao-launcher/web.go, which evicts any worker left over from before.
 */
const SERVICE_WORKER = process.env.VITE_NO_SERVICE_WORKER !== 'true';

export default defineConfig({
    base: BASE_PATH,
    plugins: [
        react(),
        tsconfigPaths(),
        svgr(),
        killProductionServiceWorker(BASE_PATH),
        // The shell's half of the split: the runtime modules it publishes, the import map naming
        // them, and the catalogue of plugins this build was assembled with. The plugins themselves
        // are built afterwards, one Vite build each — see scripts/build-assembly.mjs.
        assembly(BASE_PATH),
        ...(SERVICE_WORKER
            ? [
                  VitePWA({
                      registerType: 'autoUpdate',
                      // The manifest is not generated here. `public/manifest.json` is it, and
                      // index.html links that one itself.
                      //
                      // Generating one as well is what made Dashboard uninstallable on Windows and
                      // Linux: the built page carried two <link rel="manifest">, and a browser
                      // reads the first and ignores the rest — which was the hand-written one, then
                      // still declaring a single 64x64 icon. Chromium wants at least 192px before
                      // it will offer to install, so no desktop ever offered it, while Android and
                      // iOS went on adding a home-screen shortcut, which needs no manifest at all.
                      //
                      // Keeping the file static is what keeps it correct everywhere else. This
                      // plugin is absent from a VITE_NO_SERVICE_WORKER build (see above), and a
                      // manifest generated here would leave with it, so kiao would ship an app
                      // that cannot be installed. And public/ is copied verbatim, so every URL in
                      // the manifest stays relative to it and follows VITE_BASE_PATH wherever the
                      // app is served from.
                      manifest: false,
                      // The precache globs .js, .css and .html and nothing else, which is why this
                      // list exists at all. The manifest and the icons it names join it: they are
                      // what a browser reads to answer "can this be installed?", and the icons the
                      // one it shows while asking — the old pair was named by the manifest and
                      // precached by nobody.
                      includeAssets: ['favicon.ico', 'robots.txt', 'BrainK.jpg', 'manifest.json', 'icon-*.png'],
                      workbox: {
                          maximumFileSizeToCacheInBytes: 10000000,
                          // The OIDC renewal frame navigates to silent-renew.html?code=…&state=….
                          // The query keeps it from matching its own precache entry, so the SPA
                          // navigation fallback would answer with index.html — booting a whole
                          // Dashboard in the hidden frame, which is exactly what that page exists
                          // to avoid.
                          navigateFallbackDenylist: [/\/silent-renew\.html/],
                      },
                  }),
              ]
            : []),
    ],
    css: {
        preprocessorOptions: {
            less: {
                javascriptEnabled: true,
            },
        },
    },
    define: {
        PACKAGE_VERSION: JSON.stringify('3.2.1'),
        BUILD_DATETIME: JSON.stringify(new Date().toISOString()),
    },
    server: {
        port: 3000,
        proxy: {
            [`${BASE_PATH.replace(/\/+$/, '')}/api/files`]: {
                target: process.env.VITE_BACKEND_URL || 'http://localhost:8080',
                changeOrigin: true,
                rewrite: (path) => path.replace(`${BASE_PATH.replace(/\/+$/, '')}/api/files`, ''),
            },
            '/api/files': {
                target: process.env.VITE_BACKEND_URL || 'http://localhost:8080',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/files/, ''),
            },
            // The boards service, a second backend beside the worker — usually a shared service's,
            // since the boards are one set shared by every instance. `KIAO_WORKER_HYBRIDFLOW_URL`
            // is **the** name for that address: the worker child reads it, the kiao
            // launcher reads it, and this reads it, because three names for one address is how two
            // of them end up pointing at different databases.
            //
            // Proxied rather than called at its own origin, so the dev server behaves like nginx
            // and like the launcher: one origin, /api/hybridflow on it, and a bundle that is right
            // in all three. The target may carry a path of its own (a server deployment publishes
            // the service under /api/hybridflow) — http-proxy prepends it, so the rewrite only strips ours.
            //
            // **The credential is added here, not in the browser.** A dev build has no Keycloak
            // session, and these two variables are read from the node process rather than through
            // import.meta.env on purpose: a `VITE_`-prefixed name would put the deployment's
            // service token in the bundle every developer serves.
            '/api/hybridflow': {
                target: process.env.KIAO_WORKER_HYBRIDFLOW_URL || 'http://localhost:18081',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/hybridflow/, ''),
                configure: (proxy) => {
                    proxy.on('proxyReq', request => {
                        const token = process.env.KIAO_WORKER_HYBRIDFLOW_TOKEN;
                        const actor = process.env.KIAO_HYBRIDFLOW_ACTOR;
                        if (token) request.setHeader('authorization', `Bearer ${token}`);
                        if (actor) request.setHeader('x-kiao-actor', actor);
                    });
                },
            },
            '/api/hybridflow-runner': {
                target: process.env.VITE_BACKEND_URL || 'http://localhost:8080',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/hybridflow-runner/, '/hybridflow-runner'),
            },
            // The same endpoints under the names they had before: `/agents`, and `/claude` from when
            // there was one agent. The service answers on all three, so a bundle cached from before
            // either rename keeps working.
            '/api/agents': {
                target: process.env.VITE_BACKEND_URL || 'http://localhost:8080',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/agents/, '/agents'),
            },
            '/api/claude': {
                target: process.env.VITE_BACKEND_URL || 'http://localhost:8080',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/claude/, '/claude'),
            },
            '/api/ws': {
                target: process.env.VITE_BACKEND_URL || 'http://localhost:8080',
                changeOrigin: true,
                ws: true,
                rewrite: (path) => path.replace(/^\/api\/ws/, '/ws'),
            },
        },
    },
    resolve: {
        dedupe: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/language',
            '@codemirror/autocomplete',
            '@codemirror/lint',
            '@codemirror/lang-markdown',
            '@lezer/highlight',
            '@uiw/react-codemirror',
        ],
    },
    build: {
        outDir: 'build',
        // Import-map modules share one stylesheet with the shell; importing their JS is optional.
        cssCodeSplit: false,
        // The plugin bundles are already there — scripts/build-assembly.mjs builds them first and
        // empties the directory itself. Emptying it here would take them with it.
        emptyOutDir: false,
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/setupTests.ts',
        // The shell and its plugins, plus the tests of any plugin project dropped into this
        // assembly — see droppedTestGlobs.
        include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)', ...droppedTestGlobs()],
        exclude: [...configDefaults.exclude, ...droppedTestExcludes()],
        deps: {
            inline: ['react-syntax-highlighter', 'refractor'],
        },
    },
});
