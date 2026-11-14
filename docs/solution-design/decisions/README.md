---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Solution design decision records

Read this index fully; open a detail file when its triggers match the task. It covers current
global and container-local decisions in the base distribution. Global records live here;
single-container records live in that container's `docs/solution-design/decisions/`.
The [architecture preliminaries](../../architecture/README.md) define ownership and the
[solution design index](../README.md) links the designs.

## Maintaining the catalogue

Use [kiao-adr](/reference/kiao-skills/kiao-adr/SKILL.md) for the format, authoring and
catalogue maintenance rules. This base catalogue uses chronological, consecutive,
five-digit IDs starting at `00001`, shared across the global and container-local
directories linked below. Its sequence is independent of other catalogues.
After a deletion or move out of this catalogue, close numbering gaps and update all
references together. These numbering conventions belong to this repository.

## Adding a decision

Take the next ID (`00069`), in this directory for a global decision or in the owning
container's decision directory. Add its entry to this index using the skill's conventions.

File-store V001–V018 references describe retired migration history. For current delivery,
read the [2026-10-20 baseline and upgrade procedure](../../../migrations/cutover-2026-10-20.md).

## Index

### [00001 — Handlers return errors; one classifier maps HTTP statuses.](../../../operation/worker/docs/solution-design/decisions/00001-http-error-taxonomy.md)

**Read when:** status code; handler error; 5xx; error response; sentinel error.

### [00002 — kiao-worker alone holds TypeScript wire contract types.](00002-kiao-worker-wire-contract.md)

**Read when:** wire change; new DTO; field rename; contract drift; exhaustive switch.

### [00003 — Worker logs via slog with per-request id.](../../../operation/worker/docs/solution-design/decisions/00003-slog-structured-logging.md)

**Read when:** new log line; request id; correlate failure; liveness probe; component logger.

### [00004 — File actions are manifest entries naming provider URL.](00004-file-actions-declared.md)

**Read when:** new action; operation on a file; provider URL; manifest entry.

### [00005 — appliesTo uses extensions and directory only, both sides.](00005-applicability-rule-both-sides.md)

**Read when:** context menu; right-click; appliesTo; extensions; directory rule; async menu.

### [00006 — Internal links stored root-relative, resolved against BASE_URL.](../../../exchange/dashboard/docs/solution-design/decisions/00006-bare-internal-links.md)

**Read when:** internal link; basename; context path; copied URL; /dashboard prefix; router navigation.

### [00007 — Each turn gets per-turn MCP token, revoked after.](00007-mcp-turn-token.md)

**Read when:** turn MCP; tool auth; 401 from a turn; strict config; bundle size; ./utils subpath.

### [00008 — Store configuration lives in kiao-user-config.](00008-store-config-folder.md)

**Read when:** store configuration; config/; value providers; file templates.

### [00009 — Static .src.md versions generate in browser tab.](../../../exchange/dashboard/docs/solution-design/decisions/00009-static-version-in-browser.md)

**Read when:** static version; .src.md; export SVG; blank labels; foreignObject; mermaid size.

### [00010 — Double-click magnifies element with zoom and placeholder.](../../../exchange/dashboard/docs/solution-design/decisions/00010-magnify-in-place.md)

**Read when:** magnifier; double-click; readable size; fixed positioning; transform ancestor; clipped element.

### [00011 — View state chosen by viewport width, documents separate.](00011-small-screen-view-state.md)

**Read when:** phone layout; small screen; 768px; columns closed on desktop; user-agent sniffing.

### [00012 — `loggedIn` means a turn could run.](00012-loggedin-means-runnable.md)

**Read when:** login banner; /login; session expired; auth status poll; blanked tokens.

### [00013 — Worker owns play loop and Manual Live countdown.](00013-worker-plays-board.md)

**Read when:** run ends on tab close; countdown parked; stop run; notice wording; suspend on interrupt.

### [00014 — Tasks add running, interrupted, draft; only ready plays.](00014-running-interrupted-draft.md)

**Read when:** card status; running card; stopped turn; draft; Play missing; stale running.

### [00015 — One person owns system everywhere KIAO runs.](00015-one-person-owns-system.md)

Client authorization exception superseded by [00068](00068-owner-access-from-every-application.md);
the other ownership rules remain applicable.

**Read when:** sandbox; isolation; bypass permissions; trusted folder; confirmation; reader role; scope not sandbox.

### [00016 — Machine outfitting is toolbox library with shipped catalogue.](00016-toolbox-library.md)

**Read when:** install JDK; install node; install python; new MCP server; tool byte cost; ledger; handshake probe; 202 install job.

### [00017 — Boards merge service and screen versions field by field.](../../../exchange/dashboard/docs/solution-design/decisions/00017-board-merge-on-run.md)

**Read when:** board overwritten; concurrent edit; conflict; two writers; stale write; pre-write check.

### [00018 — Tags are words on documents; store maps colours.](00018-tags-are-words.md)

**Read when:** new tag; tag colour; rename tag; grey tag; tag picker; paste across instances.

### [00019 — Dashboard builds shell and plugins as separate modules.](../../../exchange/dashboard/docs/solution-design/decisions/00019-dashboard-assembled.md)

**Read when:** shared module; import map; tree-shaking; capability; plugin imports plugin; @ant-design/icons; new plugin; register plugin; file resolution; toolbar tab; first match wins.

### [00020 — External plugin projects join build via VITE_PLUGIN_PATHS.](../../../exchange/dashboard/docs/solution-design/decisions/00020-external-plugin-projects.md)

**Read when:** external plugin; dropped project; fixture seeding; @/ alias.

### [00021 — Task body is description sent; answers file separately.](00021-task-body-and-log.md)

**Read when:** description; log; replay; follow-up question; title as prompt; empty card; retry sends.

### [00022 — Turns go through HarnessDriver port; Claude CLI is one implementation.](../../../operation/worker/docs/solution-design/decisions/00022-harness-driver-port.md)

**Read when:** new agent; second agent; turn lifecycle; spawn; stream; stub driver; no claude on PATH.

### [00023 — Wire, routes, UI say agent; old paths aliased.](00023-wire-says-agent.md)

Superseded by [00066](00066-harness-and-workflow-agent.md).

Superseded by [00066](00066-harness-and-workflow-agent.md).

**Read when:** claude path; agent name; capability registry; workflowSettings.agent; old env var; alias drift.

### [00024 — Search scope bounds read-only walks; named folder walked.](../../../operation/worker/docs/solution-design/decisions/00024-kiao-files-search-scope.md)

**Read when:** slow search; node_modules; target/; vendor/; declared folder; delete scope; 500 entries.

### [00025 — Worker plays several boards; runs named and persistent.](00025-named-runs.md)

**Read when:** second run; named run; restart; forget; resume; workflows panel; card played twice.

### [00026 — Archive writes card to dated markdown beside board.](../../../exchange/dashboard/docs/solution-design/decisions/00026-archive-task-to-markdown.md)

**Read when:** delete card; archive; tidy board; Done column; chat cleanup; name taken.

### [00027 — Any store path revealed in tree without opening.](../../../exchange/dashboard/docs/solution-design/decisions/00027-reveal-in-tree.md)

**Read when:** reveal; crosshair; locate file; show in tree; where it sits; mindmap label.

### [00028 — Stored links use leading slashes; rewrites respect token boundaries.](00028-leading-slash-links.md)

**Read when:** rename rewrote prose; bare path; contents[].path; V007; relative markdown link; template::; unit::; migration rewrite; substring replace; assets/; stack trace in note; shell snippet rewritten.

### [00029 — Document indexes are conversions; mtime protects handwritten ones.](00029-index-is-conversion.md)

**Read when:** pdf search; docx search; xlsx search; .msg; .eml; .doc; companion tab; stale index; hand-written index.

### [00030 — Uploads staged hidden for review before store entry.](00030-upload-staging.md)

**Read when:** upload folder; review upload; safe import; unsafe import; sweep; git-ignored upload; subsidiary.

### [00031 — Sensitivity rules store-owned JSON, matching in browser.](00031-import-gate-store-owned.md)

**Read when:** sensitive data; regex rule; false positive; new category; criticality; underline shape; deleted category returns.

### [00032 — Gate scans readable text, renders markdown, redacts staging.](../../../exchange/dashboard/docs/solution-design/decisions/00032-gate-read-render-redact.md)

**Read when:** render markdown review; mark element; redaction; obfuscate; import as text; .md import; rapport.pdf.md.

### [00033 — Segments save via ffmpeg as AV1/Opus files.](00033-ffmpeg-segments-toolbox.md)

**Read when:** segments; save segments; AV1; no encoder; install ffmpeg; key image; hidden name; libsvtav1.

### [00034 — Muse is third harness via serve host per turn.](../../../operation/worker/docs/solution-design/decisions/00034-muse-third-harness.md)

**Read when:** Muse; Spark; sandbox; approval; staged config; skills symlink; quota unavailable; untrusted workspace.

### [00035 — Kiao image embeds PostgreSQL and store; override refused.](00035-image-serves-own-boards.md)

**Read when:** image boards; remote override; named volume; trust auth; service token; bind mount modes.

### [00036 — Compaction per card; continue forks chat per card.](00036-compact-and-fork.md)

**Read when:** compact; continue; fork; shared conversation; chain cost; fork failed; branched from; play order; chain; next task; folder mismatch; column play; move right; Done column; chain across columns; chat field; delete conversation.

### [00037 — Worker installs bundled skills into edited store.](../../../operation/worker/docs/solution-design/decisions/00037-skills-move-to-store.md)

**Read when:** skill not loading; agent home skills; staged Muse skills; marker; untrusted workspace; strace; new skill; edit a skill; ~/.claude/skills; digest mismatch.

### [00038 — Tooltips explain unclear controls in at most 16 words.](../../../exchange/dashboard/docs/solution-design/decisions/00038-tooltips-only-when-needed.md)

**Read when:** tooltip; hover text; title attribute; word count; dynamic value; long tooltip.

### [00039 — Boards become HybridFlow: hybridflow-ui, hybridflow-store, hybridflow.](00039-hybridflow-rename.md)

**Read when:** tasks-board; workflows-service; taskboard skill; old env var; old API prefix; vault secret; V001-V012 history.

### [00040 — Cards add user-only blocked status off-board waiting.](00040-blocked-status.md)

**Read when:** blocked card; waiting on; pink card; not playable; waiting-refresh mirror; Blocked column.

### [00041 — Muse quota harvested from turns into shared payload.](00041-muse-quota-harvest.md)

**Read when:** Muse quota strip; unavailable quota; 503 quota; probe turn; newest observation; arrival stamp.

### [00042 — Board cards are flow nodes on every layer.](00042-flow-nodes-not-tasks.md)

**Read when:** task vs flow node; Shutdown; Scheduler; Human card; task-templates; clipboard kind; wire break.

### [00043 — Boards are one canvas; columns and backlog removed.](00043-board-is-one-canvas.md)

**Read when:** column; backlog; rank; move route; canvas; fractional rank; three faces; board format; column order; task identity; paste board; clipboard; nextColumnTitle.

### [00044 — Dashboard tooltips only from app Tooltip after still second.](../../../exchange/dashboard/docs/solution-design/decisions/00044-tooltip-system-still-second.md)

**Read when:** antd Tooltip; title attribute; CSS tooltip; flash tooltip; disabled element tooltip; truncated label; archdia popup.

### [00045 — Bookmarks are ordered JSON entries with title, link and note.](00045-bookmarks-json.md)

**Read when:** bookmark note render; edit bookmark; percent-encoded link; old bookmarks.md; rendered note; bookmark; kept at hand; panel list; bookmark identity; link out of store.

### [00046 — Pub holds base KIAO without outward references.](00046-split-monorepo.md)

**Read when:** personal code in pub; outward reference; hostname; standalone repo; subtree split; old monorepo path.

### [00047 — Deliverable called kiao: DCMS plus hybridflow extras.](00047-deliverable-called-kiao.md)

**Read when:** kiao-dcms; -dcms suffix; reinstall; old config; instance registry; commit scope; decisions-dcms.md.

### [00048 — DCMS and hybridflow are functional sets, not containers.](00048-functional-sets.md)

**Read when:** DCMS meaning; hybridflow meaning; container vs feature; commit scope; runner homeless; boards UI ownership.

### [00049 — OpenCode is fourth harness with two supported models.](../../../operation/worker/docs/solution-design/decisions/00049-opencode-fourth-harness.md)

**Read when:** OpenCode; DeepSeek; Mistral; reasoning; auto-reject; release tarball; musl; stdin prompt.

### [00050 — Boards are boards; executions are chain runs.](00050-chain-run-rename.md)

**Read when:** workflow word; chain run; board content; run logs; workflow-runs dir; old path alias; WorkflowRunner; workflow vs run; workflows panel; protocol 15; workflow face; boardSpots; WorkflowView.

### [00051 — Markdown PDF themes are store documents; defaults synchronized.](00051-store-pdf-themes.md)

**Read when:** PDF theme; print header; custom logo; theme synchronization; branded export.

### [00052 — Markdown exports native Word in browser, with store themes.](../../../exchange/dashboard/docs/solution-design/decisions/00052-word-export-themes.md)

**Read when:** Word theme; DOCX theme; branded Word export; Word theme menu; Word export; DOCX; SVG fallback; editable document.

### [00053 — Codex turns own descendants until subreaper confirms cleanup.](../../../operation/worker/docs/solution-design/decisions/00053-codex-process-ownership.md)

**Read when:** orphan Codex; Node launcher; turn cancellation; worker death; setsid; double fork; stop and resume.

### [00054 — Assemblies supply extra skill sources at runtime.](00054-runtime-skill-sources.md)

**Read when:** additional skills; skill source; assembly skill; source conflict; skill provenance.

### [00055 — Pi resolves worker-owned profiles; sessions stay conversation-owned.](00055-pi-execution-profiles.md)

**Read when:** Pi; execution profile; provider connection; profile fork; deferred message.

### [00056 — Assemblies configure named migration streams; baselines retire history.](00056-named-file-migration-streams.md)

**Read when:** migration stream; migration source; history purge; baseline; ledger reset; migration delivery.

### [00057 — Boards have toolbar panel separate from documents.](../../../exchange/dashboard/docs/solution-design/decisions/00057-board-panel.md)

**Read when:** board panel; board replaces document; panel route; expanded node editor.

### [00058 — Agents publish immutable versions captured by conversations.](00058-agent-publications.md)

**Read when:** agent publication; agent archive; task provenance; agent version; managed agent; standing instructions; briefing; agents panel; card names engine; no foreign key; deleted agent.

### [00059 — Quota resets are absolute instants, shown local time.](00059-quota-reset-instants.md)

**Read when:** quota reset; refresh datetime; ISO reset; monthly window; Retry-After; limit notice; session limit; resets; API Error; done vs error; last block; 529; usage limit; 429; waiting refresh; resume line; weekly window; eight-day bound.

### [00060 — Worker groups code into cohesive packages within families.](../../../operation/worker/docs/solution-design/decisions/00060-worker-package-cohesion.md)

**Read when:** new worker package; import cycle; driver boundary; code cohesion; where to put code; new package; internal/; second binary.

### [00061 — Architecture, solution designs and reference packages have distinct homes.](00061-direct-solution-design-and-reference-packages.md)

**Read when:** architecture terminology; solution design; documentation ownership; implementation review; container design; global design location; reference package path; standalone repository; portable links.

### [00062 — Approvals outlive Dashboard; failed stream ends turn.](00062-unattended-permissions.md)

**Read when:** Stream closed; no subscribers; closed Dashboard tab; unattended writes; Waiting for approval.

### [00063 — Claude input stays open until result plus idle.](../../../operation/worker/docs/solution-design/decisions/00063-claude-input-ends-at-idle.md)

**Read when:** Stream closed; intermediate result; first tool fails; session_state_changed; result burst; poisoned conversation; dead approval channel; session resume.

### [00064 — Panels are toolbar tabs; placement and selection are global per size.](../../../exchange/dashboard/docs/solution-design/decisions/00064-global-toolbar-view-state.md)

**Read when:** toolbar persistence; screen-size layout; tab selection; global preferences; new panel; panel placement; Show menu; column on/off; FileNavigationBarCmp; stacked bars.

### [00065 — Decision records use statement and owner, never title.](00065-decision-statement-owner.md)

Superseded by [00067](00067-madr-decision-records.md).

**Read when:** new decision; decision status; decision owner; decision statement.

### [00066 — Harness names execution tooling; agent names a managed workflow definition.](00066-harness-and-workflow-agent.md)

**Read when:** agent ambiguity; harness terminology; platform field; driver naming; conversation metadata upgrade; published agent configurations.

### [00067 — Decision records use MADR and its optional native metadata.](00067-madr-decision-records.md)

**Read when:** new decision; decision metadata; MADR; decision skill; decision format.

### [00068 — Every application uses the owner's full access.](00068-owner-access-from-every-application.md)

**Read when:** owner account; files_user; files_reader; listening client; default roles; public registration; reader roots; server authentication.
