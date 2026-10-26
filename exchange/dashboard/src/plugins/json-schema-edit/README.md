# JSON Schema editor

`json-schema-edit` opens `.schema.json` files with syntax highlighting, inline JSON
and schema diagnostics, and completion for keywords and valid values. It claims the
full suffix, so these files open here before the generic JSON fallback.

**New → JSON Schema** creates `New Schema.schema.json` in the current folder and
opens its rename dialog. The initial object schema declares Draft 2020-12. Edits
save automatically through `useTextFileSync`, which also follows changes on disk.
Invalid and incomplete source remains editable and is saved as typed.

The editor validates against the JSON Schema meta-schema, defaulting to Draft 2020-12
when `$schema` is absent. Draft 4, 6, 7 and 2019-09 declarations are also supported.
Standard meta-schemas are bundled, so editing works offline. Custom remote meta-schemas
are not fetched; an unresolved declaration produces a diagnostic.

Ctrl+Space opens completion. Keywords and values are suggested at the cursor,
including within nested schemas. Enter accepts a suggestion; Tab visits its placeholders.

The reusable editor and schema integration live in
[`@cms-kit/code-editor`](../../kit/code-editor/README.md). Other plugins can use it
in a full document or text field and supply their own JSON Schema without loading
this file plugin.
