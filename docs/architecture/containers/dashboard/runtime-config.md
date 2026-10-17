# Runtime configuration (`src/cms-core/config/`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

[`DashboardConfig-ctx.tsx`](../../../../exchange/dashboard/src/cms-core/config/DashboardConfig-ctx.tsx) loads the
`dashboard.json` **config document** (`WorkerClient.getConfigJson`) at startup and exposes
`{ chatEnabled, gitEnabled, plugins }`. Behaviour: document present →
normalized; missing (404) → seed defaults then use them; any other error → fail open with defaults.
Children render only after the config resolves, so plugin contributions never register a tab and
immediately drop it. The two flags gate the chat plugin and Git's core tool bar integration.

Both flags are **opt-out**: anything but an explicit `false` is on.

`plugins` is the third kind of answer and reads differently: **no list at all** is a store written
before the plugin set was a store's to choose, and gets everything the build carries; an **empty
list** is a choice, and is honoured. It is what `PluginAssemblyProvider` loads — see
*[The assembly](../../../../exchange/dashboard/ARCHITECTURE.md#the-assembly-what-is-shipped-and-what-is-loaded)*.
