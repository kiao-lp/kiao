# Solution design decision records

One small index for agents to read fully, plus one detail file per decision.
Read this file top to bottom; open a detail file when its triggers match your task.

This is one chronological index across all owners. Cross-container and repository-wide records
live here. Records concerning one container live in its local `docs/solution-design/decisions/`
directory and are linked below. The [architecture preliminaries](../../architecture/README.md) define scope;
the [solution design index](../README.md) links to the detailed designs.

- IDs are chronological and zero-padded (`00001` first). Same-date entries put
  repo-wide decisions before product ones, then keep source file order.
- A detail file carries YAML frontmatter (`id`, `title`, `status`, `date`,
  `tags`, `components`, `paths`, `symbols`, `triggers`, `supersedes`,
  `superseded_by`) and the full decision body.
- `status: accepted` means recorded as decided. The source logs kept no status
  field; `superseded` is used only where a later entry explicitly replaces one.
- Components use container names (`dashboard`, `worker`, `hybridflow-store`),
  reference libraries (`kiao-worker`, `kiao-mcp`, `kiao-skills`), and `docs`,
  `repo`, `migrations`, `kiao-image`, `kiao-executable` where those fit.
- `TODO` in a detail file marks something ambiguous or missing. It is a
  question, not a guess.

## Reading lenses

Old entries name old words. Read them through these:

- `decisions-dcms.md` became `decisions-kiao.md` on 2026-10-05, then this index.
- Entries before 00064 saying "Dashboard + worker" or "boards UI + store" mean
  the DCMS / hybridflow functional sets.
- Entries before 00062 may name old monorepo paths and one person's deployment;
  that is history, not a reference to follow.
- 00077 supersedes 00049's documentation shelves and terminology, and the monorepo-prefixed
  link rule in 00062. Historical bodies retain the earlier decisions; all navigable links use
  current destinations within this repository. Frozen migration comments may still name the
  earlier documentation locations; use this index to find their current owners.
- 00078 supersedes worker's flat-package decision in 00001; the package hierarchy is recorded
  in the worker code map.
- 00079 places global solution designs directly in `docs/solution-design/` and the base NPM
  packages directly in `reference/`. Earlier bodies retain their original paths; navigable
  links and path metadata use the current locations.
- File-store V001–V018 references describe retired history; use the
  [2026-10-20 baseline and upgrade procedure](../../../migrations/cutover-2026-10-20.md) for current delivery.
- `claude` paths and env names became `agent` ones (00036), then managed-agent
  ids (00050). `tasks-board` / `workflows-service` / `taskboard` became
  `hybridflow-ui` / `hybridflow-store` / `hybridflow` (00054). Cards became flow
  nodes (00058), `workflow run` became `chain run` (00066), `-dcms` names became
  `kiao` names (00063).

## Adding a decision

1. Take the next ID (`00080`). Create `00080-short-slug.md` in this directory for a global
   decision, or in the owning container's `docs/solution-design/decisions/` for a local one.
   Use the frontmatter above and the decision body (`Decision` / `Why` / cost, as the others do).
2. Append one row below, in ID order. Keep the statement under 20 words if at
   all possible, 30 at most, without dropping critical scope.
3. If the new entry replaces part of an old one, link `supersedes` /
   `superseded_by` and say which part in a `Refactor notes` section. Never edit
   an old body to match; append-only history.

## Index

### [00001 — Worker stays one flat Go package main until file count doubles or a second binary appears.](../../../operation/worker/docs/solution-design/decisions/00001-worker-flat-package-main.md)

**Read when:** new package; internal/; second binary; import cycle; where to put code.

### [00002 — Handlers return errors; one classifier maps them to HTTP statuses, hiding 5xx detail.](../../../operation/worker/docs/solution-design/decisions/00002-http-error-taxonomy.md)

**Read when:** status code; handler error; 5xx; error response; sentinel error.

### [00003 — Each Dashboard plugin exports one CmsPlugin manifest; App derives resolution, creation, toolbar tabs.](../../../exchange/dashboard/docs/solution-design/decisions/00003-dashboard-plugin-manifest.md)

**Read when:** new plugin; register plugin; file resolution; toolbar tab; first match wins.

### [00004 — kiao-worker owns the TypeScript wire contract; dashboard and MCP servers consume it, never copy.](./00004-kiao-worker-wire-contract.md)

**Read when:** wire change; new DTO; field rename; contract drift; exhaustive switch.

### [00005 — Worker logs via slog with per-subsystem loggers and a per-request id; /healthz stays outside middleware.](../../../operation/worker/docs/solution-design/decisions/00005-slog-structured-logging.md)

**Read when:** new log line; request id; correlate failure; liveness probe; component logger.

### [00006 — File actions are manifest entries naming an id and provider URL; worker serves descriptors and proxies runs.](./00006-file-actions-declared.md)

**Read when:** new action; operation on a file; provider URL; manifest entry; tts.speech; unit.publish.

### [00007 — appliesTo says only extensions and directory; worker and client implement the same rule.](./00007-applicability-rule-both-sides.md)

**Read when:** context menu; right-click; appliesTo; extensions; directory rule; async menu.

### [00008 — Publish resolves the unit content chain server-side from the .mlunit.json path alone.](./00008-publish-resolved-server-side.md)

**Read when:** publish; unit export; .mlunit.json; payload assembly; Export button.

### [00009 — Internal links are stored as store-root-relative /paths and resolved against BASE_URL at display.](../../../exchange/dashboard/docs/solution-design/decisions/00009-bare-internal-links.md)

**Read when:** internal link; basename; context path; copied URL; /dashboard prefix; router navigation.

### [00010 — Link migrations match the old prefix only at token boundaries and exclude assets/.](./00010-link-migration-token-boundary.md)

**Read when:** migration rewrite; substring replace; assets/; stack trace in note; shell snippet rewritten.

### [00011 — DCMS skills ship embedded in the worker binary and install into agent homes at startup.](./00011-skills-ship-in-binary.md)

**Read when:** new skill; edit a skill; ~/.claude/skills; skill not loading; digest mismatch; marker.

### [00012 — Each turn gets MCP servers plus a per-turn token minted for the caller's identity, revoked after.](./00012-mcp-turn-token.md)

**Read when:** turn MCP; tool auth; 401 from a turn; strict config; bundle size; ./utils subpath.

### [00013 — Store config lives in kiao-user-config/, personal notes in docs/; V001 renames and rewrites links.](./00013-store-config-folder.md)

**Read when:** new root folder; config/; value providers; file templates; rename a folder; absoluteOnly.

### [00014 — Static versions of .src.md generate in the browser tab; worker only stores the files.](../../../exchange/dashboard/docs/solution-design/decisions/00014-static-version-in-browser.md)

**Read when:** static version; .src.md; export SVG; blank labels; foreignObject; mermaid size.

### [00015 — Magnification is app-wide: double-click floats the element at zoom with a placeholder holding layout.](../../../exchange/dashboard/docs/solution-design/decisions/00015-magnify-in-place.md)

**Read when:** magnifier; double-click; readable size; fixed positioning; transform ancestor; clipped element.

### [00016 — Every panel is a tab placed per document in left/central/right areas via the Show menu.](../../../exchange/dashboard/docs/solution-design/decisions/00016-panels-are-toolbar-tabs.md)

**Read when:** new panel; panel placement; Show menu; column on/off; FileNavigationBarCmp; stacked bars.

### [00017 — Bookmarks live in kiao-user-config/bookmarks.md as ### link sections with notes.](../../../exchange/dashboard/docs/solution-design/decisions/00017-bookmarks-markdown.md)

**Read when:** bookmark; kept at hand; panel list; bookmark identity; link out of store.

### [00018 — View-state config is chosen by viewport width: desktop and small-screen documents stay separate.](./00018-small-screen-view-state.md)

**Read when:** phone layout; small screen; 768px; columns closed on desktop; user-agent sniffing.

### [00019 — A board is one .workflow.json document with UUID-identified columns and tasks.](./00019-board-is-one-json.md)

**Read when:** board format; column order; task identity; paste board; clipboard; nextColumnTitle.

### [00020 — loggedIn means a turn could run: CLI status cross-checked against stored OAuth session expiry.](./00020-loggedin-means-runnable.md)

**Read when:** login banner; /login; session expired; auth status poll; blanked tokens.

### [00021 — A task may name its successor, played next in the same conversation with optional compaction.](./00021-onsuccess-next-task.md)

**Read when:** play order; chain; next task; shared conversation; compact; folder mismatch.

### [00022 — Play order comes only from onSuccess chains across columns; status replaces column moves.](./00022-chains-not-columns.md)

**Read when:** column play; move right; Done column; chain across columns; chat field; delete conversation.

### [00023 — Worker owns the play loop and Manual Live countdown; Dashboard starts, observes, stops.](./00023-worker-plays-board.md)

**Read when:** run ends on tab close; countdown parked; stop run; notice wording; suspend on interrupt.

### [00024 — Notices are read at the reply's foot too; limits mark error and file nothing.](../../../operation/worker/docs/solution-design/decisions/00024-done-vs-limit.md)

**Read when:** limit notice; session limit; resets; API Error; done vs error; last block; 529.

### [00025 — Tasks add running, interrupted, and draft statuses; only ready plays.](./00025-running-interrupted-draft.md)

**Read when:** card status; running card; stopped turn; draft; Play missing; stale running.

### [00026 — Units are linked by store path from a root sommaire; the Postgres catalog is deleted.](./00026-unit-linked-by-path.md)

**Read when:** unit link; docId; publish; unpublish; members; remarks; catalog search; progress store.

### [00027 — KIAO assumes one person owns the machine; nothing defends the store against the prompter.](./00027-one-person-owns-system.md)

**Read when:** sandbox; isolation; bypass permissions; trusted folder; confirmation; reader role; scope not sandbox.

### [00028 — Machine outfitting is the toolbox library with a shipped per-platform catalogue and install panel.](./00028-toolbox-library.md)

**Read when:** install JDK; install node; install python; new MCP server; tool byte cost; ledger; handshake probe; 202 install job.

### [00029 — Boards open during a run merge file and screen versions field-wise instead of overwriting.](../../../exchange/dashboard/docs/solution-design/decisions/00029-board-merge-on-run.md)

**Read when:** board overwritten; concurrent edit; conflict; two writers; stale write; pre-write check.

### [00030 — Tags are words stored on documents; the store file only maps words to colours.](./00030-tags-are-words.md)

**Read when:** new tag; tag colour; rename tag; grey tag; tag picker; paste across instances.

### [00031 — Dashboard builds shell and plugins as separate ES modules, assembled per store at load.](../../../exchange/dashboard/docs/solution-design/decisions/00031-dashboard-assembled.md)

**Read when:** shared module; import map; tree-shaking; capability; plugin imports plugin; @ant-design/icons.

### [00032 — External plugin projects join the build via VITE_PLUGIN_PATHS; the assembly verifies them.](../../../exchange/dashboard/docs/solution-design/decisions/00032-external-plugin-projects.md)

**Read when:** personal plugin; cursus-view; cv-edit; lifesim-edit; dropped project; fixture seeding; @/ alias.

### [00033 — Task body is the description sent on play; answers file into a separate log field.](./00033-task-body-and-log.md)

**Read when:** description; log; replay; follow-up question; title as prompt; empty card; retry sends.

### [00034 — Usage limits park the run until reset plus a minute, marked waiting-refresh, then resume.](./00034-usage-limit-is-clock.md)

**Read when:** usage limit; resets; 429; waiting refresh; resume line; weekly window; eight-day bound.

### [00035 — Turns go through an AgentDriver port; the Claude CLI is one implementation.](../../../operation/worker/docs/solution-design/decisions/00035-agent-driver-port.md)

**Read when:** new agent; second agent; turn lifecycle; spawn; stream; stub driver; no claude on PATH.

### [00036 — Contract, routes, UI, and env vars say agent; old claude HTTP paths stay aliased.](./00036-wire-says-agent.md)

**Read when:** claude path; agent name; capability registry; workflowSettings.agent; old env var; alias drift.

### [00037 — The search scope bounds read-only walks; the named folder itself is always still walked.](../../../operation/worker/docs/solution-design/decisions/00037-kiao-files-search-scope.md)

**Read when:** slow search; node_modules; target/; vendor/; declared folder; delete scope; 500 entries.

### [00038 — Worker plays several boards at once; runs are named, listed, and outlive their play.](./00038-named-runs.md)

**Read when:** second run; named run; restart; forget; resume; workflows panel; card played twice.

### [00039 — Archive writes a card to a dated markdown file beside the board before removing it.](../../../exchange/dashboard/docs/solution-design/decisions/00039-archive-task-to-markdown.md)

**Read when:** delete card; archive; tidy board; Done column; chat cleanup; name taken.

### [00040 — Any store path can be revealed in the navigation tree without opening it.](../../../exchange/dashboard/docs/solution-design/decisions/00040-reveal-in-tree.md)

**Read when:** reveal; crosshair; locate file; show in tree; where it sits; mindmap label.

### [00041 — The leading slash makes a stored path a link; the fixer rewrites nothing else.](./00041-leading-slash-links.md)

**Read when:** rename rewrote prose; bare path; contents[].path; V007; relative markdown link; template::; unit::.

### [00042 — Document indexes are conversions (md/csv); mtime provenance protects hand-written ones from overwrite.](./00042-index-is-conversion.md)

**Read when:** pdf search; docx search; xlsx search; .msg; .eml; .doc; companion tab; stale index; hand-written index.

### [00043 — Uploads land in a hidden staging area for review before anything enters the store.](./00043-upload-staging.md)

**Read when:** upload folder; review upload; safe import; unsafe import; sweep; git-ignored upload; subsidiary.

### [00044 — Sensitivity rules are store-owned JSON seeded once by worker; matching runs in the browser.](./00044-import-gate-store-owned.md)

**Read when:** sensitive data; regex rule; false positive; new category; criticality; underline shape; deleted category returns.

### [00045 — The gate scans every readable text, renders markdown, and redacts into the staging copy.](../../../exchange/dashboard/docs/solution-design/decisions/00045-gate-read-render-redact.md)

**Read when:** render markdown review; mark element; redaction; obfuscate; import as text; .md import; rapport.pdf.md.

### [00046 — Segments save via ffmpeg as AV1/Opus files; ffmpeg installs from the toolbox catalogue.](./00046-ffmpeg-segments-toolbox.md)

**Read when:** segments; save segments; AV1; no encoder; install ffmpeg; key image; hidden name; libsvtav1.

### [00047 — Muse is the third agent, driven over one muse serve host per turn via MSP.](../../../operation/worker/docs/solution-design/decisions/00047-muse-third-agent.md)

**Read when:** Muse; Spark; sandbox; approval; staged config; skills symlink; quota unavailable; untrusted workspace.

### [00048 — The kiao image embeds PostgreSQL plus the store service; remote store override is refused.](./00048-image-serves-own-boards.md)

**Read when:** image boards; VPS boards; remote override; named volume; trust auth; service token; bind mount modes.

### [00049 — Architecture lives in docs/architecture: per-container folders, views/, and cross-container root.](./00049-architecture-docs-shelves.md)

**Read when:** where to write architecture; new container doc; shelf; container folder; store-root-absolute link; file repeats folder.

**Superseded by 00077:** use the current architecture and solution design ownership rules.

### [00050 — Tasks name a managed agent by id; platform, model, and instructions resolve at play.](./00050-managed-agent-per-task.md)

**Read when:** managed agent; standing instructions; briefing; agents panel; card names engine; no foreign key; deleted agent.

### [00051 — Compaction is per-card; continue forks the chat so each card keeps its own conversation.](./00051-compact-and-fork.md)

**Read when:** compact; continue; fork; shared conversation; chain cost; fork failed; branched from.

### [00052 — Worker installs bundled skills into the edited store, not into agent homes.](../../../operation/worker/docs/solution-design/decisions/00052-skills-move-to-store.md)

**Read when:** skill not loading; agent home skills; staged Muse skills; marker; untrusted workspace; strace.

### [00053 — Every user-facing tooltip is clear, concise, and under 30 authored words.](../../../exchange/dashboard/docs/solution-design/decisions/00053-tooltip-under-30-words.md)

**Read when:** tooltip; hover text; title attribute; word count; dynamic value; long tooltip.

### [00054 — Boards become HybridFlow: hybridflow-ui, hybridflow-store, hybridflow; live state migrates with deploy.](./00054-hybridflow-rename.md)

**Read when:** tasks-board; workflows-service; taskboard skill; old env var; old API prefix; vault secret; V001-V012 history.

### [00055 — An execution of a board's workflow is called a workflow run, on wire and UI.](./00055-workflow-run-rename.md)

**Read when:** workflow vs run; workflows panel; protocol 15; workflow face; boardSpots; WorkflowView.

### [00056 — Cards add a user-only blocked status for work waiting on something off-board.](./00056-blocked-status.md)

**Read when:** blocked card; waiting on; pink card; not playable; waiting-refresh mirror; Blocked column.

### [00057 — Muse quota is harvested from turn observations into the shared windows payload.](./00057-muse-quota-harvest.md)

**Read when:** Muse quota strip; unavailable quota; 503 quota; probe turn; newest observation; arrival stamp.

### [00058 — Board cards are flow nodes on every layer; task names only AI and Human work.](./00058-flow-nodes-not-tasks.md)

**Read when:** task vs flow node; Shutdown; Scheduler; Human card; task-templates; clipboard kind; wire break.

### [00059 — Boards drop columns and backlog: one canvas, position by spot, chains show order.](./00059-board-is-one-canvas.md)

**Read when:** column; backlog; rank; move route; canvas; fractional rank; three faces.

### [00060 — Dashboard tooltips come only from the app Tooltip, opening after one still second.](../../../exchange/dashboard/docs/solution-design/decisions/00060-tooltip-system-still-second.md)

**Read when:** antd Tooltip; title attribute; CSS tooltip; flash tooltip; disabled element tooltip; truncated label; archdia popup.

### [00061 — Bookmarks move to kiao-user-config/bookmarks.json as title/link/note entries; V015 migrates.](./00061-bookmarks-json.md)

**Read when:** bookmark note render; edit bookmark; percent-encoded link; old bookmarks.md; rendered note.

### [00062 — pub/ holds base KIAO with no outward references; perso/ holds personal products building on it.](./00062-split-monorepo.md)

**Read when:** personal code in pub; outward reference; hostname; standalone repo; subtree split; old monorepo path.

### [00063 — The deliverable drops -dcms: kiao names DCMS plus hybridflow plus the shared extras.](./00063-deliverable-called-kiao.md)

**Read when:** kiao-dcms; -dcms suffix; reinstall; old config; instance registry; commit scope; decisions-dcms.md.

### [00064 — DCMS and hybridflow are functional sets spanning containers, not container pairs.](./00064-functional-sets.md)

**Read when:** DCMS meaning; hybridflow meaning; container vs feature; commit scope; runner homeless; boards UI ownership.

### [00065 — OpenCode is the fourth agent via opencode run, with DeepSeek Pro and Mistral Large 4.](../../../operation/worker/docs/solution-design/decisions/00065-opencode-fourth-agent.md)

**Read when:** OpenCode; DeepSeek; Mistral; reasoning; auto-reject; release tarball; musl; stdin prompt.

### [00066 — Workflow wording is freed: boards are boards, executions are chain runs.](./00066-chain-run-rename.md)

**Read when:** workflow word; chain run; board content; run logs; workflow-runs dir; old path alias; WorkflowRunner.

### [00067 — Markdown PDF themes are store documents, with defaults synchronized by worker.](./00067-store-pdf-themes.md)

**Read when:** PDF theme; print header; custom logo; theme synchronization; branded export.

### [00068 — Markdown exports native Word content and embedded SVG diagrams entirely in the browser.](../../../exchange/dashboard/docs/solution-design/decisions/00068-markdown-word-export.md)

**Read when:** Word export; DOCX; SVG fallback; editable document; unsaved Markdown export.

### [00069 — Word export offers the store themes; only the palette maps to native styles.](../../../exchange/dashboard/docs/solution-design/decisions/00069-word-export-themes.md)

**Read when:** Word theme; DOCX branding; Word theme menu; palette mapping.

### [00070 — Codex turns own local descendants until a subreaper confirms cleanup; interrupted conversations remain reserved.](../../../operation/worker/docs/solution-design/decisions/00070-codex-process-ownership.md)

**Read when:** orphan Codex; Node launcher; turn cancellation; worker death; setsid; double fork; stop and resume.

### [00071 — Assemblies supply additional skill sources to the common worker at runtime.](./00071-runtime-skill-sources.md)

**Read when:** additional skills; skill source; assembly skill; source conflict; skill provenance.

### [00072 — Pi resolves worker-owned execution profiles shared by agents and conversations; native sessions stay conversation-owned.](./00072-pi-execution-profiles.md)

**Read when:** Pi; execution profiles; provider connections; profile forks; deferred messages.

### [00073 — Assemblies configure independent named file migration streams; checked baselines retire applied history.](./00073-named-file-migration-streams.md)

**Read when:** migration stream; migration source; history purge; baseline; ledger reset; migration delivery.

### [00074 — Boards have a toolbar panel separate from documents, central by default.](../../../exchange/dashboard/docs/solution-design/decisions/00074-board-panel.md)

**Read when:** board panel; board replaces document; panel route; expanded node editor.

### [00075 — Managed agents publish immutable versions captured by task conversations.](./00075-agent-publications.md)

**Read when:** agent publication; agent archive; task provenance; pinned agent configuration.

### [00076 — Quota resets are absolute instants, displayed consistently in the reader's local datetime.](./00076-quota-reset-instants.md)

**Read when:** quota reset; refresh datetime; ISO reset; monthly window; Retry-After.

### [00077 — Architecture is solution-agnostic; global solution designs are centralized and container designs live beside their code.](./00077-architecture-and-solution-design.md)

**Read when:** documentation ownership; architecture terminology; implementation review; solution design; portable links; standalone repository.

**Global directory superseded by 00079:** global solution designs now live directly under `docs/`.

### [00078 — Worker organizes code into cohesive packages within its existing service families.](../../../operation/worker/docs/solution-design/decisions/00078-worker-package-cohesion.md)

**Read when:** worker package; import cycle; cohesive grouping; driver boundary; execution port; code ownership.

### [00079 — Global solution designs live directly under docs; base NPM packages live directly under reference.](./00079-direct-solution-design-and-reference-packages.md)

**Read when:** global design location; reference package path; repository layout; NPM file dependency; build paths.
