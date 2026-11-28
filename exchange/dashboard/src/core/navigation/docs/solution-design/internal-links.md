---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Internal links

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

Use DCMS links for document references such as `/docs/guide.md`. Dashboard adds its mount
point at display time so the document can move between deployments. See the
[DCMS concept catalog](../../../../../../../docs/architecture/data/dcms-concept-catalog.md).

[internal-links.ts](../../internal-links.ts) handles links at the Dashboard boundary.

| Helper | Use |
| --- | --- |
| `normalizeDocumentLink` | Remove the current origin and mount from Dashboard hrefs. For a file or folder this produces a DCMS link. Preserve external URLs and document-relative links. |
| `encodedDcmsLinkOf` | Convert a file API path to a percent-encoded DCMS link for a Markdown destination. |
| `resolveInternalLink` | Add the mount point to a DCMS link for display. |
| `internalPathOf` | Return the router path for a Dashboard href or `null` outside the app. |
| `storePathOfHref` | Return the decoded file API path for a Dashboard href, dropping query and fragment. |

The mount comes from Vite's `BASE_URL` (`VITE_BASE_PATH`, default `/dashboard/`), shared with
router basename and OIDC redirect. A rendered href such as `/dashboard/docs/guide.md` is
relative to the web origin.
`ConfiguredMarkdown` resolves ordinary anchors after custom `prefix::` handling; embed
renderers such as `template::` own their own resolution.

[InternalLinkNavigator](../../../files/navigation/InternalLinkNavigator.tsx) intercepts
internal anchor clicks once at application level, including diagram tooltips and plugin-written
anchors. It listens during bubbling and respects `defaultPrevented`, so React Router links and
plugin click handlers retain control.

## Writing DCMS links

Use `dcmsLinkOf` and `storePathOf` from `kiao-worker/utils` to convert between file API
paths and raw DCMS links. For example, **Copy DCMS link** copies `/docs/guide.md`, while
**Copy markdown link** copies `[guide.md](/docs/guide.md)` with a Markdown destination.
Structured fields such as a node's `settings.folder` also use DCMS links.

Resolution also accepts legacy hrefs with the mount point. The mount point prevents a
path token boundary for link repair, which is why writers use DCMS links.
[LinkFixer](../../../../../../../operation/worker/internal/files/refactor/linkfix.go)
