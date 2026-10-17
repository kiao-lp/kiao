# Dashboard Plugins

Plugins extend Dashboard by adding support for new file types. Each plugin lives in its own
directory under `src/plugins/` and is listed in [`catalogue.json`](./catalogue.json); which of
them a given store actually loads is that store's own configuration.

A plugin that is **not delivered with Dashboard** is the same thing in a project of its own,
dropped into an assembly through `VITE_PLUGIN_PATHS` — a comma-separated list of plugin project
directories, each holding an `index.tsx` and a `package.json` declaring its `kiaoPlugin` id.
See [`plugins-assembly.md`](../../../../docs/architecture/containers/dashboard/plugins-assembly.md).

> How to write a plugin — manifest, file I/O, view state, and the optional integration points
> (`CreationProvider`, `toolBars`, `markdownRenderers`, `sideDocuments`, `capabilities`,
> `appRoutes`, context-menu entries) — is the `dashboard-plugin` skill:
> [`/.agents/skills/dashboard-plugin/SKILL.md`](../../../../.agents/skills/dashboard-plugin/SKILL.md)
> (discovery entry in `.claude/skills/`). How the extension system works — the contract,
> resolution, capabilities, how an assembly is built and loaded — is
> [`plugins-runtime.md`](../../../../docs/architecture/containers/dashboard/plugins-runtime.md),
> [`plugins-assembly.md`](../../../../docs/architecture/containers/dashboard/plugins-assembly.md) and
> [`plugins-rules.md`](../../../../docs/architecture/containers/dashboard/plugins-rules.md).

## Existing Plugins

[`catalogue.json`](./catalogue.json) is the list. What each one *claims* is in the table in
[`../../ARCHITECTURE.md`](../../ARCHITECTURE.md#the-plugins-today-srcpluginscataloguejson), which
is kept in step with it; neither is duplicated here.
