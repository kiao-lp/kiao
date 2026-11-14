---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Git panel

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

Git is a core integration gated by `gitEnabled`, because it owns application diff mode.

| Source under `src/core/git/` | Responsibility |
| --- | --- |
| [GitPanel.tsx](../../GitPanel.tsx) | Status, staging and commit UI |
| [useGitStatus.ts](../../useGitStatus.ts) | Last-request-wins polling |
| [useGitActions.ts](../../useGitActions.ts) | Stage, revert, commit, consolidate and remote operations; local result reporting |
| [GitConsolidateModal.tsx](../../GitConsolidateModal.tsx) | Confirm history consolidation and show its report |
| [GitDiff-ctx.tsx](../../GitDiff-ctx.tsx), [GitDiffView.tsx](../../GitDiffView.tsx) | Diff target, draft and Document stack view |
| [GitSyncMonitor.tsx](../../GitSyncMonitor.tsx) | Fetch on mount, pull prompts and ahead/uncommitted counts |

Changes → More actions offers consolidation into one commit to reclaim history space.
For a tracking branch it also force-pushes the rewrite; confirmation describes this irreversible
operation. Its result needs a modal report rather than a transient toast.
