# Dashboard plugins — design rules and precedents

Use this checklist to place new behavior and understand the incidents behind each rule.
The runtime contract is in [plugins-runtime.md](./plugins-runtime.md); selection, builds and
delivery are in [plugins-assembly.md](./plugins-assembly.md).

## Decision checklist

- **A new file type gets a plugin.** Whether it is delivered to everyone or kept in an external
  project is an audience decision. Both use the same entry point, catalogue and configuration.
- **App-wide behavior belongs in cms-core.** Examples include Git's application diff mode,
  authentication, creation from `kiao-user-config/file-templates` and folder browsing. Every
  assembly provides them.
- **An operation requiring the server is a server file action.** Add a manifest entry and an
  endpoint; see the [global design](/docs/solution-design/file-actions.md) and
  [authoring procedure](/.agents/skills/file-actions/SKILL.md). Keep a context-menu operation in
  a plugin when it needs state loaded in that browser tab, as static-version generation does.
- **Code needed by a second plugin moves into the kit.** Both import `@cms-kit/<module>`, with
  an explicit `tsconfig.paths.json` entry. There is deliberately no wildcard alias. Code used
  by one plugin stays in that plugin, as the ArchDia editing stack does.
- **A feature another plugin needs becomes a capability with defined absence behavior.** The kit
  owns its name and type, rather than either plugin. Use provider-independent names such as
  `chat.run`. Absence is a normal operating case.
- **Open a second file through the host's secondary-document interface.** Do not wrap another
  plugin's layout or implement another panel arrangement. Use `useSecondaryDocument().open(file)`
  to show the file in the second central area, and create it first if needed. See the
  [source map](./README.md#secondary-document-srccms-coresecondary-document).
- **App-lifetime state belongs in `providers`.** Persist per-file view state such as mode, tab,
  zoom and scroll through view state rather than `useState` or `localStorage`. Use one hook per
  scope key and do not persist a mode unsafe to reopen.
- **A shared module must justify its full shell size.** Published modules are not tree-shaken;
  the icon-package precedent below explains the cost.
- **Imports flow `plugins → kit → cms-core`.** Plugins import the `@cms-core` and explicit
  `@cms-kit/<module>` facades, never shell or kit internals by path, and never other plugins.
  The build rejects bundling shell internals.
- **A file-format plugin usually needs a companion skill.** Register it in `pluginOf`; tests
  reject unmapped skills and references to plugins removed from the catalogue.
- **Save as the user types.** Use a 1000 ms debounced writer, treat initial loading separately
  from editing, pass path and payload as writer arguments, flush on exit and before handing the
  file to a service. Ctrl+S suppresses the browser dialog and flushes. The skill gives the procedure.
- **Declare claimed suffixes.** New plugins must not use `fallback: true`; only `code-edit` and
  `text-edit` are fallbacks.
- **Keep `markdownRenderers` keys globally unique.** Registry merging silently overwrites duplicates.

## Precedents

**A second shell copy broke hooks.** A plugin inside `src/` could resolve
`../../ThemeContext`, but bundling it created another React context instance whose provider was
never mounted. `.graph.json` and `.arch.md` failed in production. `contractOnly` rejects that
bundle, and external project aliases deliberately omit `@/*`.

**CommonJS `export *` produced no named exports.** The React shim carried only `default`, without
`useState`; the JSX-runtime shim carried no exports. Every production plugin failed while the
development server worked. Shims now enumerate exports from each package, and `checkImports`
verifies requested names as well as specifiers.

**A second stylesheet was delivered but never loaded.** The loader links only `<id>/style.css`.
Running `alwaysAStylesheet` before real CSS renamed that real file to `style2.css`. The hook now
runs in `order: 'post'`, and `checkStylesheets` rejects extra CSS files.

**A plugin image silently became alternative text.** Using the app's base URL requested the asset
one level too high. The SPA router returned HTML with status 200, so only built assemblies lost
the image. Plugin bases now include `plugins/<id>/`, and `checkAssetUrls` checks emitted URLs.

**An offline shell could load no plugins.** The shell's service worker gathers its precache from
`build/` at shell-build completion. Building plugins afterward omitted them. The assembly therefore
builds plugins first.

**Desktop installation failed with two manifests.** A hand-written manifest preceded the generated
one, so browsers ignored the latter. The first had only a 64-pixel icon, below Chromium's
192-pixel requirement; mobile shortcuts did not expose the issue. `checkInstallable` verifies one
manifest, installability fields and all referenced build files.

**Two build sites omitted external projects.** A list held only by the local startup script left
server deployment and the installed executable without their plugins. Files fell back to source
editing, and the panel had no missing catalogue row to display. Audience-specific assemblies now
derive that list from their project directory; the shared image carries only its own catalogue.

**Plugin renames affect three readers.** Renames such as `claude` → `agent` → `chat`,
`movie-view` → `movie-edit`, `tasks-board` → `hybridflow-ui`, and
`claudeCodeEnabled` → `agentEnabled` → `chatEnabled` must preserve saved choices through
`PLUGIN_RENAMES` and `normalizeConfig`. Update the rename map, skill mapping and stored plugin
selection together. This is input normalization; it does not imply preserving every old environment
variable or API prefix.

**Eleven board imports became capabilities and kit code.** Imports from `claude`, `tags` and
`template-edit` became four capabilities and a kit module. The board now handles a disabled feature
and a feature never included in the assembly through the same absence behavior.

**`isEnabled` gates routes and tabs only.** `App.tsx` filters `appRoutes` and `toolBars`, refined
by per-tab enablement. File resolution, creation providers, app providers and capabilities remain
active. `chatEnabled: false` hides tabs while leaving the socket and capabilities mounted;
`useChatAvailable` therefore combines `chatEnabled && useChatRunAvailable()`.

**Catalogue order becomes assembly order.** Panel toggles save catalogue order rather than click
order. That order controls toolbar proposals and first-provider capability precedence. File
resolution instead compares claim kind and suffix specificity.

**Suffixes must be pooled across plugins.** `archdia-edit` declares `.arch.md`, while
`markdown-edit` declares `.md`. Reading only the active claimant's extensions could retain only
`.md` during a rename. A longest-first pool preserves the full suffix independently of
registration order.

## Sources

- Authoring procedure: [dashboard-plugin](/.agents/skills/dashboard-plugin/SKILL.md).
- Build precedents: [pluginBuild.mjs](/exchange/dashboard/vite-plugins/pluginBuild.mjs)
  (`contractOnly`, `alwaysAStylesheet`),
  [build-assembly.mjs](/exchange/dashboard/scripts/build-assembly.mjs) (the four checks),
  [assembly.ts](/exchange/dashboard/vite-plugins/assembly.ts) (shims),
  [assembly-shared.mjs](/exchange/dashboard/vite-plugins/assembly-shared.mjs) (`SHARED_MODULES`),
  [useChatAvailable.ts](/exchange/dashboard/src/plugins/hybridflow-ui/useChatAvailable.ts).
- [Decision index](/docs/solution-design/decisions/README.md): manifest and file actions
  (2026-07-16), assembly, external projects and capabilities (2026-08-31), agent naming
  (2026-09-03), and hybridflow naming (2026-09-15).
