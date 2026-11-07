---
id: "00039"
title: "an archived task is a dated markdown file beside the board"
status: accepted
date: 2026-09-04
tags: ["hybridflow", "archive", "board"]
components: ["dashboard"]
paths: []
symbols: ["toStoreName", "archive/"]
triggers: ["delete card", "archive", "tidy board", "Done column", "chat cleanup", "name taken"]
supersedes: []
superseded_by: []
---

# 00039 — an archived task is a dated markdown file beside the board

**Decision:** **Delete** removes a card. **Archive** writes the card as Markdown to an `archive` folder beside the board, named by archive date and task title, then removes the card. Both then ask about the task's chat.

Archive preserves the asked description, the returned log and the filed column after the card leaves the board. The file is ordinary store Markdown: no `docType`, no id, nothing reads it back. The store naming rule (`toStoreName`) applies. The date leads, so the folder sorts by completion. A taken name gets a suffix, never an overwrite.

Safety order: write first, remove second. A failed write leaves the card unchanged. The conversation id is not written into the file; the log carries the readable content. Conversation deletion is asked separately after removal.
