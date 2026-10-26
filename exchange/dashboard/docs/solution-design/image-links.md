# Image links

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

**An image is written against the document that holds it, and joined onto that document's folder
when it is fetched** ([`markdown/imageSource.ts`](../../src/cms-core/markdown/imageSource.ts)). `Urb.svg`
in `.../archdia/docs/ProjectDesc.md` is the picture beside it; `design.assets/01-mermaid.svg` in
`docs/design.md` is what *Generate static version* wrote in `docs/design.assets/`. That is what
markdown means everywhere it is read, and the point of writing it that way: the document shows its
pictures on GitHub and in an IDE preview too, which a link resolved by this app alone would not.

Worker takes root-relative paths only, so `ConfiguredMarkdown` does the join before calling
`getDownloadUrl`. The document's folder is the folder the browser is on; content the browser is *not*
showing passes its own through `documentFolder` — the Conversations panel hands it the conversation's
working folder, which is what the relative paths in a reply are written against.

A src starting with `/` names the store root instead, like a stored link, and is fetched from there.
That slash is the only thing separating the two readings, so `imageLinkPath`
([`kit/MarkdownEditor/imagePaste.ts`](../../src/kit/MarkdownEditor/imagePaste.ts)) writes it: an
image pasted into the document's own folder is linked relatively, one saved anywhere else from the
root.
