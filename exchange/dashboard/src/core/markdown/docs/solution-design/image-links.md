---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Image links

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

[imageSource.ts](../../imageSource.ts) resolves relative sources against
the containing document's folder: `Urb.svg` names a sibling image and
`design.assets/01-mermaid.svg` names an asset below it. These links also work in repository
and IDE previews.

`ConfiguredMarkdown` joins the path before calling worker's `getDownloadUrl`. It uses the
current document folder by default; off-document content supplies `documentFolder`, as the
Conversations panel does with its working directory. A source written as a DCMS link resolves
from the DCMS root.

[imageLinkPath](../../../../kit/MarkdownEditor/imagePaste.ts) uses a document-relative link
for images under the document's folder and a DCMS link for other images. Callers can also
request a DCMS link explicitly.
