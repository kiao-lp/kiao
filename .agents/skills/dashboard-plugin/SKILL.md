---
name: dashboard-plugin
description: This skill should be used when the user asks to "create a Dashboard plugin", "add a plugin", "support a new file type", "modify a plugin", "add a toolbar tab", "add a creation command", "add a context menu entry", "offer a capability", "consume a capability", "add a side document", "add an app route", "write a plugin project", or works with Dashboard plugins, the plugin catalogue, plugin manifests, or files under exchange/dashboard/src/plugins/.
---

# Dashboard Plugin Authoring

A plugin teaches Dashboard to render and edit one file type. It is **one folder under
`exchange/dashboard/src/plugins/`** whose `index.tsx` exports a single `plugin: CmsPlugin`,
plus **one line** in `exchange/dashboard/src/plugins/catalogue.json`.

For the concepts — the contract, resolution, capabilities, how an assembly is built and loaded —
see [plugins-runtime](../../../docs/architecture/containers/dashboard/plugins-runtime.md),
[plugins-assembly](../../../docs/architecture/containers/dashboard/plugins-assembly.md) and
[plugins-rules](../../../docs/architecture/containers/dashboard/plugins-rules.md).
This skill is the procedure.

## 1. Delivered or own project?

Ask before starting. A plugin everybody's copy of KIAO should have goes in the lot, as below.
One editing a document only one person has — a CV, accounts — is a project of its own,
assembled through `VITE_PLUGIN_PATHS`. Same contract, same
`index.tsx`, same everything here; a `package.json` carrying the catalogue entry instead of a
catalogue line. See §8 for what differs.

## 2. The folder

`src/plugins/<name>/index.tsx` exports the manifest. The contract lives in
`src/cms-core/core/FileBasedPlugin.ts`:

```tsx
// src/plugins/foo-view/index.tsx
import { CmsPlugin, FileDto, MainViewCmp, FileLabelCmp, extractName } from '@cms-core';

const fileLabelCmp: FileLabelCmp = ({ file }) => <>{extractName(file.path)}</>;
const MainView: MainViewCmp = () => <div>…</div>;

// Claim the file, or return null to pass it on.
const fileConfigFor = (file: FileDto) =>
  file.path.endsWith('.foo') ? { fileLabelCmp, mainView: MainView } : null;

export const plugin: CmsPlugin = {
  id: 'foo-view',            // stable, unique — also the React key in plugin lists
  fileConfigFor,
  fileExtensions: ['.foo'],  // what you claim — how a contest is settled; declare them
  // CreationProvider,       // optional: "New <type>" command (§5)
  // toolBars,               // optional: tool bar tabs (§5)
  // markdownRenderers,      // optional: custom [[type:id|title]] renderers (§5)
  // sideDocuments,          // optional: documents offered beside another plugin's (§5)
  // capabilities,           // optional: features offered to other plugins (§6)
  // appRoutes,              // optional: pages that are not store documents (§5)
  // providers,              // optional: state living as long as the app (§5)
  // isEnabled,              // optional: runtime-config gate
};
```

Rich plugins keep `index.tsx` tiny: the editor under `components/`, model and logic in plain
`.ts` modules, per-plugin state in `*-ctx.tsx` contexts (see `unit-edit`, `mlex-edit`,
`mindmap-edit` for the pattern). Add a short `README.md` in the folder.

A main view renders the chrome, never reimplements it:

```tsx
const MainView: MainViewCmp = () => (
  <>
    <LayoutContent>
      <MyViewer />
    </LayoutContent>
    <TopBanner />
  </>
);
```

`LayoutContent` draws the top bar and the two columns around the document, each holding
whichever tool bar tabs this document puts in it.

## 3. Registration

Add one entry to `src/plugins/catalogue.json` — the build reads it to know what to compile,
the app to know what it may load, the Configuration panel to draw a row:

```json
{ "id": "foo-view", "title": "Foo", "description": "Shows a .foo." }
```

The `id` **is** the folder name and the entry point is `src/plugins/<id>/index.tsx` — no
exceptions. The `title` and `description` are what a person switching the plugin on or off
reads; write the description as one sentence about what the store gains.

Position in the file decides nothing: a specific claim beats a `fallback: true` one, and
between claims of the same kind the longest `fileExtensions` suffix wins. Only `code-edit`
and `text-edit` are fallbacks; never mark a new plugin as one.

**A plugin is not always loaded.** A store names the plugins it wants in
`.kiao-config/dashboard.json`, and a build may be assembled without yours (`VITE_PLUGINS`).
A file yours does not open falls to `code-edit` — nothing is needed from you for that — but
it is why §6 exists.

## 4. Reading, saving, remembering

**Save as you type. There is no Save button anywhere, and a new plugin must not add one.**
A change is a write through a debounced writer — 1000 ms is the house delay.

For a file opened as a document, reach for the hook before writing a load effect and a
debounced writer of your own:

```tsx
import { useDocumentFileSync, useTextFileSync } from '@cms-core';

// Structured document: the codec is your two arrows between text and structure.
const { doc, onDocChange, text, onTextChange } = useDocumentFileSync(path, { parse, serialize });

// Text editors (markdown-edit, text-edit, code-edit): the identity codec.
const { text, onTextChange } = useTextFileSync(path);
```

The hook reads, debounce-saves, and **follows the file on disk** — a change made elsewhere
(a link repaired after a rename, a Claude turn, a `git pull`) is read back into the open
document. For anything else (creating, renaming, raw blobs), use `useWorkerClient()`:
`client.getFileText(path)`, `client.update(path, content)`.

Rules for writers that stay hand-rolled:

- **Loading is not an edit.** Route edits through a setter that schedules the write; let the
  initial load bypass it.
- **Give the debounced writer its path and payload as arguments**, not from a closure over
  the current file: a write still pending when another file opens must land where it was made.
- **Flush on the way out** — provider unmount and `beforeunload`.
- **Flush before handing the file to a service.** Publishing or building reads the file from
  the store, so those paths flush first and await the write.
- **Ctrl+S** keeps only its two jobs: swallow the browser's "save page" dialog, and flush.

**View state** — anything the user expects to find as left (open preview, active tab, zoom,
scroll offset) — belongs in the view state, not in `useState` (lost on navigation) and not
in `localStorage` (not keyable per file):

```tsx
import { useFileViewState, useScrollMemory, useCodeMirrorScrollMemory } from '@cms-core';

const [view, setView] = useFileViewState('my-view', { mode: 'preview', zoom: 1 });
setView({ mode: 'source' });   // a patch, like setState
```

Stored values merge over the defaults, so adding a key later does not invalidate what is
stored. Two rules: **one hook per scope key** (two calls sharing a key overwrite each
other), and **do not persist a mode unsafe to reopen in** (`mindmap-edit` forgets its
editor mode on purpose). Plugins without their own scroller inherit `LayoutContent`'s for
free; a plugin with one names it with `useScrollMemory` / `useCodeMirrorScrollMemory`.

**Styling:** set `className="file-label-icon"` on the `<img>` in `fileLabelCmp`, and use the
CMS CSS variables (`var(--bg-surface)`, `var(--fg)`, `var(--border)`) so the plugin follows
the active theme.

## 5. Integration points

Beyond `fileConfigFor`, all optional and all declared on the manifest or through a hook.

**`CreationProvider` — a "New \<type\>" entry.** A wrapper calling `useCreationCommand`,
composed app-wide from the manifest:

```tsx
export const MyCreationPlugin: FC<{ children?: ReactNode }> = ({ children }) => {
  const client = useWorkerClient();
  const refreshFileList = useRefreshFileList();
  const create = useCallback(async (currentPath: string) => {
    const path = `${currentPath.replace(/\/?$/, '/')}New File.foo`;
    await client.update(path, '');
    refreshFileList();
  }, [client, refreshFileList]);

  useCreationCommand('foo-view', {
    id: 'new-foo', label: 'Foo', icon: <FileOutlined />, order: 20,
    execute: ctx => create(ctx.currentPath),   // ctx is { currentPath }
  }, [create]);

  return <>{children}</>;
};
// export const plugin: CmsPlugin = { id, fileConfigFor, CreationProvider: MyCreationPlugin };
```

**Context-menu entries** — an operation on a file, offered where the file is pointed at:

```tsx
useContextMenuItems('foo-view', [{
  id: 'foo-action', label: 'Do it', group: '6-actions',
  enabledWhen: ctx => ctx.pointedFile?.path.endsWith('.foo') ?? false,
  execute: async ctx => { /* … */ },
}], [/* deps */]);
```

Prefer a **server file action** (manifest entry plus endpoint, no plugin code) when the
operation needs the server; keep it here when it needs what is loaded in the tab.

**`toolBars` — a panel of your own:**

```tsx
toolBars: [{
  id: 'foo-panel', title: 'Foo', icon: <MyIcon />,
  // defaultBar: 'right',   // 'top' | 'left' | 'right' — the default; only the starting point
  render: bar => <MyPanel />,   // bar.orientation for a panel reading across vs down
}],
```

Where the tab is drawn is not yours: the user moves it from the Show menu and the choice is
remembered per document. `useToolBars().showTab(id)` brings a panel up, back into the layout
if taken out. A tab drawing edge-to-edge rows sets `flush: true`.

**`markdownRenderers` — `[[foo:id|Title]]` in markdown previews:**

```tsx
const markdownRenderers = { foo: MyEmbedComponent };  // LinkRenderer: { id, title, isLink? }
```

Merged app-wide; keys must be globally unique across plugins.

**`sideDocuments` — offering one beside another plugin's document:**

```tsx
export const plugin: CmsPlugin = { id, fileConfigFor, sideDocuments: [{
  id: 'foo', title: 'Foo', icon: <FooOutlined />,
  pathFor: file => file.path.endsWith('.foo') ? null : `${file.path}.foo`,
  create: (path, client) => client.saveDocument(path, emptyFooDocument()),
  render: ({ path }) => <FooPane path={path} />,
}]};
```

Derive `pathFor` from the host path so the pair travels together on rename; `create` runs
only for a path the store does not hold. **Accepting them** (two lines, names none):

```tsx
<LayoutContent>
  <SideDocumentRow hostHidden={nothingOfMineShowing}><MyEditor /></SideDocumentRow>
</LayoutContent>
<TopBanner additionalPanels={<><MyToolbar /><SideDocumentToggles /></>} />
```

**`appRoutes` — a page that is not a store document** (boards live in a database):

```tsx
appRoutes: [{ prefix: '/boards', render: () => <BoardsPage />, menu: { label: 'Boards' } }],
```

Claims the prefix and everything under it; drawn in place of the document; the menu entry is
how the page is reached (omit it for link-only pages).

**`providers` / `withGlobalProvider` — lifetime.** `providers` mount for the life of the app
(a live connection, an in-flight request); everything else unmounts on navigation to another
plugin's document. `withGlobalProvider` wraps the tree only while this plugin's file is open
— guard against `currentFile` being `null`.

## 6. If another plugin needs something of yours

**Never import it.** A plugin the assembly did not load has no module to import. One
question decides the answer: *would the other plugin still work with yours absent?*

- **Yes — it is a widget.** Move the code to the kit, give it an entry in
  `tsconfig.paths.json`, and both import `@cms-kit/<module>`.
- **No — it is a feature.** Publish it as a **capability**: a value under a name in your
  manifest's `capabilities`, with the name, its type and *what a consumer does without it*
  declared in `@cms-kit/capabilities`:

```tsx
// Provider
export const plugin: CmsPlugin = {
  id: 'tags', fileConfigFor: () => null,
  providers: [TagsProvider],
  capabilities: { 'tags.ui': { TagChips, TagPicker } },
};

// Consumer — degrades to a working no-op where nobody published it
const { TagChips } = useTagsUi();
if (!useTagsAvailable()) { /* do not draw the chips-only row at all */ }
```

A capability may be a hook: the registry is fixed for the life of the app, so the function
is the same object on every render. Keep your own vocabulary out of the name (`chat.run`,
not `claude.run`).

## 7. Import rules

Three zones, one direction: **`plugins → kit → cms-core`**.

| You need | Import from |
|---|---|
| Anything the framework offers | `@cms-core`, never a file inside `src/cms-core/` |
| Something another plugin also needs | `@cms-kit/<module>`, never a file inside `src/kit/` |
| Something only your plugin needs | your own folder |

A module used by exactly one plugin belongs **in that plugin**. Promote one to `src/kit/`
the day a *second* plugin needs it, with its own entry in `tsconfig.paths.json` — there is
no `@cms-kit/*` wildcard, on purpose. Plugins never import from one another (§6).

## 8. A plugin of its own project

Registered by its `package.json` instead of the catalogue:

```json
{ "kiaoPlugin": { "id": "foo-view", "title": "Foo", "description": "Shows a .foo." } }
```

and named in `VITE_PLUGIN_PATHS`. Entries are *added* to the catalogue, so everything from
here on is the same. What is not the same: `@/…` does not resolve (you get `@cms-core`,
`@cms-kit/*` and the shared surface — the whole contract), the project carries no vitest or
playwright config (the assembly lends its `node_modules` and runs the tests), and its
`tsconfig.json` extends the assembly's — plus the assembly's test setup, so the jest-dom
matchers typecheck. A dependency nothing else uses goes in the project's own `package.json`
(one `npm install` in its directory): the assembly lends the rest into its `node_modules`,
and the dependency is bundled into the plugin. **Its tests stay with it:**
unit tests beside the source, the e2e spec in the project's own `e2e/` with fixtures in
`e2e/files/` — nothing of yours belongs in the delivered suite.

## 9. Tests and verification

- **Unit**: pure logic (matcher, model, assembler) gets a Vitest file next to it — see
  `plugins/archdia-edit/index.test.ts` for a minimal `fileConfigFor` test.
- **e2e smoke**: extend `e2e/tests/dashboard/plugin-smoke.spec.ts` (creates a file of each
  type, asserts the right editor mounts). A real edit round-trip also gets a case in
  `edit-roundtrip.spec.ts`. Add the plugin to the complete assembly the harness pins,
  `e2e/data/files-template/.kiao-config/dashboard.json`, or the suite runs without it.

```bash
npm run build && npm test          # from exchange/dashboard
cd ../../e2e && npm test            # if you touched UI behaviour
```

`npm run build` builds the plugin into `build/plugins/<id>/` and checks every bare import
left in it against the shell's import map. If it fails there, you imported something
neither on the shared surface nor bundleable. Note what no test run covers: **nothing run
against the dev server exercises the import map** — a plugin can pass everything and load
in no built assembly. A browser on a real `npm run build` is what confirms it.
