# Server file actions (`src/cms-core/files/actions/`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Beyond what plugins contribute, the **server** can offer operations on a file, and Dashboard
turns every one into a contextual-menu entry: **no code here, and no plugin**. How the system fits
together is [file-actions](../../../../docs/solution-design/file-actions.md); how to add one is the
[file-actions](../../../../.agents/skills/file-actions/SKILL.md) skill. What follows is only this side's half.

- **`useServerActions.ts`** — fetches the descriptors once (`client.listActions()`) and registers
  one `ContextMenuItemDescriptor` per action under the plugin id `server-actions`, in group
  `6-actions` (after everything the browser itself offers). A server with no actions, or one that
  cannot be reached, registers nothing and the menu is what it was before.
- **`appliesTo.ts`** — evaluates the applicability rule locally from `{ path, isDirectory }`.
  Its other half is `ActionApplies` in `operation/worker/internal/files/actions/actions.go`; worker's `PROTOCOL.md` is the
  contract both agree with, and both test tables mirror each other.
- **`ActionParamsModal-cmp.tsx`** — one generic form for every action that will ever exist, built
  from the declared params (`enum` → Select, `string` → Input, `boolean` → Switch).
- **`ServerActions-cmp.tsx`** — mounted in `FileBrowsingPlugin` beside `RenameModal` /
  `DeleteConfirmModal`.

Which actions exist is deployment configuration (see [file-actions](../../../../docs/solution-design/file-actions.md)).
An export action can also be run from an editor button, so exporting has one implementation, and
the browser no longer assembles an export payload.

An export whose builder has no action endpoint is the exception to that: the editor posts to it
directly. Everything it sends is in the one open document, though, so there is still no chain to
resolve in the browser.
