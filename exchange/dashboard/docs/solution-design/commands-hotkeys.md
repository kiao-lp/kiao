# Hotkey system (`src/cms-core/commands/`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Plugins contribute hotkeys declaratively; the framework owns registration, context
and dispatch.

- **[`HotkeyRegistry.ts`](../../src/cms-core/commands/HotkeyRegistry.ts)** — a plain class keyed by
  plugin id. `HotkeyDescriptor` = `{ id, key, title, group?, enabledWhen?(ctx), execute(ctx) }`.
  `getHotkeys(ctx)` returns the enabled hotkeys for the current `CommandContext`
  (`{ pointedElement, selection, currentPath, currentFile, … }`).
- **`HotkeyRegistry-ctx.tsx`** — the React provider wrapping the registry.
- **`usePluginHotkeys.ts`** — the hook a plugin calls to register its
  hotkeys for its lifetime.
- **`HotkeyDispatcher-ctx.ts`** — assembles the live `CommandContext`
  and routes keydown matching.

The svg-edit plugin is the reference: `Ctrl+D` duplicates, `Ctrl+Shift+F` /
`Ctrl+Shift+B` restack, `Alt+Arrow` resizes (and grows a text's font on
`Alt+Up/Down`), the wheel resizes a shape — or a text's font — under the pointer,
and a right-click opens the same verbs as a menu.
