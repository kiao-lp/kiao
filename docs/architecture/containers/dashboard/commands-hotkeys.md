# Command & hotkey system (`src/cms-core/commands/`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Plugins contribute commands and hotkeys declaratively; the framework owns registration, context
and dispatch.

- **[`CommandRegistry.ts`](../../../../exchange/dashboard/src/cms-core/commands/CommandRegistry.ts)** — a plain class keyed by
  plugin id. `CommandDescriptor` = `{ id, shortcut, title, group?, enabledWhen?(ctx), execute(ctx) }`.
  `getCommands(ctx)` returns the enabled commands for the current `CommandContext`
  (`{ pointedElement, selection, currentPath, currentFile, … }`).
- **`CommandRegistry-ctx.tsx` / `HotkeyRegistry-ctx.tsx`** — React providers wrapping the
  registries; **`HotkeyRegistry.ts`** is the hotkey equivalent (`HotkeyDescriptor`).
- **`usePluginCommands.ts` / `usePluginHotkeys.ts`** — the hooks a plugin calls to register its
  commands/hotkeys for its lifetime.
- **`CommandDispatcher-ctx.ts` / `HotkeyDispatcher-ctx.ts`** — assemble the live `CommandContext`
  and route execution / keydown matching. `CommandUtils.tsx` holds shared helpers.

> Typed multi-letter shortcuts (`grp`, `pl`, `sr`, …) are **deprecated**: no new
> `shortcut` may be added, and the `CommandRegistry` goes away once the mindmap has migrated
> its remaining ones. A plugin needing a key reaches for a standard hotkey (modifiers
> included), a context menu, or a gesture instead. The svg-edit plugin is the reference:
> `Ctrl+D` duplicates, `Ctrl+Shift+F` / `Ctrl+Shift+B` restack, `Alt+Arrow` resizes (and
> grows a text's font on `Alt+Up/Down`), the wheel resizes a shape — or a text's font —
> under the pointer, and a right-click opens the same verbs as a menu.
