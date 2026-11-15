---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# File actions

← [worker wire protocol](/operation/worker/PROTOCOL.md).

This page is the normative wire contract. For how the system fits together see
[file-actions](/docs/solution-design/partitions/dcms/file-actions.md); for how to add one, the
[file-actions](/.agents/skills/file-actions/SKILL.md) skill.

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/actions` | — | `ActionDescriptor[]` — every declared action |
| GET | `/actions` | `path` | `ActionDescriptor[]` — the ones applying to that entry; unknown path → 404 |
| POST | `/actions/run` | `{ id, path, params? }` | `ActionResult` |

```ts
interface ActionDescriptor {
    id: string;          // e.g. "audio.speech"
    label: string;       // shown in the menu, verbatim
    group?: string;      // menu sort key, e.g. "6-actions"
    order?: number;
    appliesTo: { extensions?: string[]; directory?: boolean };
    params?: { name: string; label?: string; type: 'string' | 'boolean' | 'enum';
               values?: string[]; default?: unknown }[];
}
interface ActionResult { ok: boolean; message: string; changedPaths: string[]; }
```

**Applicability is the contract.** Both keys of `appliesTo` are optional and are AND-ed, so an
empty rule matches any entry. `extensions` matches case-insensitively against the end of the *file
name* (not the path), which is what makes compound extensions like `.ttst.md` and `.mlunit.json`
work. `directory`, when present, requires the entry to be (or not to be) a directory. The
vocabulary stays this small on purpose: everything in it is decidable from `{ path, isDirectory }`,
which a client already holds, so a context menu can be built without a round trip. That means the
rule is implemented twice — `actionApplies` in `internal/files/actions/actions.go` and
`appliesTo.ts` in Dashboard — and
**this paragraph, not either implementation, is what they must agree with.**

Which service implements an action is deployment configuration and is never disclosed: a client
names an action by id and this service routes it. Running one forwards the caller's `Authorization`
header and `X-Request-Id` to the provider. Failures split in two: an operation the provider refused
comes back `200 {"ok": false, "message": "…"}` (the same choice the [Git contract](./git.md)
makes for a failed command), while a provider that cannot be reached or that exceeds the
10-minute budget is a `502`.
An unknown action id is `404`, and a `path` escaping the storage root is `400`, refused before
anything leaves the service.
