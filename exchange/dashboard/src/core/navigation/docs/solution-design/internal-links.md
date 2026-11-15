---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Internal links

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

Store links use a leading slash, such as `/docs/guide.md`, without host or Dashboard mount
prefix. Resolve that prefix at display time so documents survive deployment changes.

[internal-links.ts](../../internal-links.ts) exports three helpers:

| Helper | Use |
| --- | --- |
| `toStoredLink` | Normalize links when writing Markdown, copying a file link or pasting into a mindmap; external URLs pass through |
| `resolveInternalLink` | Resolve stored links for display |
| `internalPathOf` | Return the internal router path designated by an href, or `null` |

The mount comes from Vite's `BASE_URL` (`VITE_BASE_PATH`, default `/dashboard/`), shared with
router basename and OIDC redirect. Root-relative hrefs already use the current origin.
`ConfiguredMarkdown` resolves ordinary anchors after custom `prefix::` handling; embed
renderers such as `template::` own their own resolution.

[InternalLinkNavigator](../../../files/navigation/InternalLinkNavigator.tsx) intercepts
internal anchor clicks once at application level, including diagram tooltips and plugin-written
anchors. It listens during bubbling and respects `defaultPrevented`, so React Router links and
plugin click handlers retain control.

## Stored links and relative paths

Worker's link fixer recognizes the leading slash. Write it in document references, including
bookmark links and node `settings.folder`, so renames can repair them. Use `storeLinkOf` and
`storePathOf` from `kiao-worker/utils` to convert links and API paths; do not manipulate the slash
by hand. Without it, Markdown links resolve relative to their containing document.

Resolution is idempotent for links containing the mount prefix. Such links display but cannot be repaired as store references by [LinkFixer](../../../../../../../operation/worker/internal/files/refactor/linkfix.go): the prefix prevents a path token boundary. All writes use bare store links.
