---
status: DRAFT
role: PRIMARY_SOURCE
---

# Dashboard plugins — design rules and precedents

Use this checklist to place new behavior and understand the incidents behind each rule.
The runtime contract is in [plugins-runtime.md](./plugins-runtime.md); selection, builds and
delivery are in [plugins-assembly.md](./plugins-assembly.md).

## Decision checklist

- **A new file type gets a plugin.** Whether it is delivered to everyone or kept in an external
  project is an audience decision. Both use the same entry point, catalogue and configuration.
- **Plugins may be independent of file types.** Optional panels, application pages, providers
  and capabilities can omit `fileConfigFor`, `fileExtensions` and `fallback`.
- **App-wide behavior belongs in cms-core.** Examples include Git's application diff mode,
  authentication, creation from `kiao-user-config/file-templates` and folder browsing. Every
  assembly provides them.
- **An operation requiring the server is a server file action.** Add a manifest entry and an
  endpoint; see the [global design](/docs/solution-design/partitions/dcms/file-actions.md) and
  [authoring procedure](/.agents/skills/file-actions/SKILL.md). Keep a context-menu operation in
  a plugin when it needs state loaded in that browser tab, as static-version generation does.
- **Reusable UI belongs in `cms-core/ui-foundation/`.** Controls and interaction helpers that
  work outside KIAO live there, even when first found in one plugin. Keep application state
  and store access in adapters beside their owning feature. Import widgets through `@cms-core`.
- **Other code needed by a second plugin moves into the kit.** Both import `@cms-kit/<module>`, with
  an explicit `tsconfig.paths.json` entry. There is deliberately no wildcard alias. Code used
  by one plugin stays there: the ArchDia file hook is local, while the engine shared with
  Markdown rendering belongs in the kit.
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

## Invariants

**One shell instance.** A bundled second copy of shell state creates a provider-less React context. `contractOnly` rejects shell files in plugin bundles. External project aliases omit `@/*`.

**Shims enumerate exports.** `export *` through CommonJS interop yields no named exports. Shims list each package's exports; `checkImports` verifies specifiers and requested names.

**One stylesheet per plugin.** The loader links only `<id>/style.css`. `alwaysAStylesheet` runs `order: 'post'`; `checkStylesheets` rejects extra CSS files.

**Plugin base includes `plugins/<id>/`.** The app base requests a SPA route and returns HTML 200 for assets. `checkAssetUrls` verifies emitted URLs.

**Plugins build before the shell.** The service worker precache gathers from `build/` at shell-build completion.

**One manifest.** `checkInstallable` verifies one manifest, installability fields and all referenced build files. The icon is at least 192px.

**External projects derive from the project directory.** Audience assemblies derive `VITE_PLUGIN_PATHS` from the directory. The shared image carries only its own catalogue.

**Renames update three readers.** `PLUGIN_RENAMES` and `normalizeConfig` preserve saved choices. The rename map, skill mapping and stored selection update together. Environment variables and API prefixes are not preserved.

**Capabilities replace cross-plugin imports.** The board consumes four capabilities and one kit module. Disabled and unassembled features share the same absence behavior.

**`isEnabled` gates routes, tabs and Tools menu entries only.** File resolution, creation providers, app providers and capabilities stay active. `useChatAvailable` combines `chatEnabled && useChatRunAvailable()`.

**Catalogue order is assembly order.** Panel toggles save catalogue order. That order controls toolbar proposals and first-provider capability precedence. File resolution compares claim kind and suffix specificity.

**Suffixes pool across plugins.** Extensions pool longest-first. A rename keeps the full suffix (`.arch.md` over `.md`) regardless of registration order.

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
