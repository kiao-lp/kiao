# Code editors

Import from `@cms-kit/code-editor`. These components own no file state or layout;
their callers supply `value` and `onChange`. They follow the Dashboard theme.

- `CodeMirrorCodeEditor` selects syntax highlighting from `path`, defaulting to JSON
  without one. `extensions` adds CodeMirror behavior to that instance.
- `CodeMirrorJsonEditor` adds JSON syntax diagnostics and schema completion. Pass a
  `schema` object or boolean for validation and property/value suggestions. The document's
  `$schema`, when present, selects its schema instead of this default.
- `JSON_SCHEMA_META_SCHEMA` selects the bundled Draft 2020-12 meta-schema for editing
  schemas themselves. Draft 4, 6, 7 and 2019-09 declarations also use bundled meta-schemas.

For a text field, use the same component with `height="auto"`, `minHeight="80px"`,
`maxHeight="240px"` and `lineNumbers={false}`. It also accepts `placeholder`,
`readOnly`, `autoFocus`, `onEditor` and additional `extensions`.

```tsx
import { CodeMirrorJsonEditor, type JsonSchema } from '@cms-kit/code-editor';

const settingsSchema: JsonSchema = {
    type: 'object',
    properties: { mode: { enum: ['draft', 'ready'] } },
    required: ['mode'],
};

<CodeMirrorJsonEditor
    value={text}
    onChange={setText}
    schema={settingsSchema}
    height="auto"
    minHeight="80px"
    maxHeight="240px"
    lineNumbers={false}
/>;
```

Keep schema objects and extension arrays stable between renders. Changing `schema`
reconfigures assistance for that instance. Every instance has its own language service;
validation and completion share a parsed snapshot. Completion works with incomplete JSON.
Ctrl+Space opens suggestions; Enter accepts one and Tab visits snippet placeholders.

The integration uses `vscode-json-languageservice` and bundled meta-schemas, without
network requests. Local `$ref` pointers within a supplied schema are resolved. External
schema loading is not configured; unresolved schema declarations/references appear as
diagnostics. The default meta-schema applies when a schema document omits `$schema`.

`jsonSchemaExtensions(schema)` exposes the same assistance for an existing CodeMirror
instance with the JSON language. It has no dependency on the JSON Schema file plugin.
