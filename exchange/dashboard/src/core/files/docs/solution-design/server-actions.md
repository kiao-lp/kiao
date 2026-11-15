---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Server file actions (`src/core/files/actions/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

The **server** offers file operations; Dashboard renders each as a context-menu entry. No Dashboard code or plugin is involved per action. System design: [file-actions](../../../../../../../docs/solution-design/partitions/dcms/file-actions.md). Authoring: [file-actions skill](../../../../../../../.agents/skills/file-actions/SKILL.md).

- **`useServerActions.ts`** — fetches descriptors once (`client.listActions()`) and registers one `ContextMenuItemDescriptor` per action under plugin id `server-actions`, group `6-actions`. A server with no actions, or unreachable, registers nothing.
- **`appliesTo.ts`** — evaluates applicability locally from `{ path, isDirectory }`. Its counterpart is `ActionApplies` in `operation/worker/internal/files/actions/actions.go`. Worker's `PROTOCOL.md` is the shared contract; both test tables mirror each other.
- **`ActionParamsModal-cmp.tsx`** — one generic form for all actions, from declared params (`enum` → Select, `string` → Input, `boolean` → Switch).
- **`ServerActions-cmp.tsx`** — mounted in `FileBrowsingPlugin` beside `RenameModal` / `DeleteConfirmModal`.

Deployed actions are deployment configuration. An export action also runs from an editor button: one implementation, no browser-assembled payload. An export builder without an action endpoint receives a direct editor post of the open document; no chain resolves in the browser.
