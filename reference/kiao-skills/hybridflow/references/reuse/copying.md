---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Copying cards

Read when transferring cards between boards or KIAO installations, or preparing JSON for a
person to paste. Clipboard paste performs remapping; a direct `board_add_cards` call takes
creation fields and does not perform the clipboard transformation.

## Clipboard format

```json
{"kind":"kiao-flow-node","version":1,"flowNode":{"id":"…","title":"…","type":"human","body":"…"}}
```

```json
{"kind":"kiao-flow-nodes","version":1,"flowNodes":[{"id":"…","title":"…","type":"human"}]}
```

A bare flow-node object or array is also accepted. The legacy `kiao-workflow-flow-node` wrapper
is still accepted. Offering clipboard JSON lets a person choose the destination and placement;
creating cards directly is appropriate when the requested board is already known.

## What paste preserves

- Paste always mints new card ids. Links travel only when both ends are copied together, and
  are rewritten to the new ids. Never assume source ids identify pasted cards.
- Description, criteria, complexity and status travel. An AI `chat` never travels: it belongs
  to a conversation in the source installation. Successful `output` is never copied.
- `valueType` schema references and task `outputType` travel only when the schema card is in
  the copied set; paste remaps internal references and clears external ones. Copy the schema
  with its users or select a destination schema afterward.
- Unknown managed agent ids and runner pins are cleared. Choose valid destination settings
  and check completeness before Play. Review placement against existing destination cards.

For an API-based copy, mint collision-free ids for the new set, remap its internal links and
schema references, and omit runtime fields. Use one creation batch for internal references,
then read the board back. [Cards](../cards.md) defines writable fields and
[operations](../operations.md) covers identities and verification.
