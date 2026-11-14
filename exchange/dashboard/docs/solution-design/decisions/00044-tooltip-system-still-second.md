---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-19
tags: ["dashboard", "tooltip", "ui"]
triggers: ["antd Tooltip", "title attribute", "CSS tooltip", "flash tooltip", "disabled element tooltip", "truncated label", "archdia popup", "TOOLTIP_STILL_SECONDS", "mouseEnterDelay", "markdown", "Tooltip"]
supersedes: []
superseded_by: []
---

# 00044 — Dashboard tooltips only from app Tooltip after still second.

## Context and Problem Statement

Control tooltips need one timing contract that waits for a still pointer. Direct library,
native and custom tooltips do not share that behavior.

## Considered Options

* Use the app `Tooltip` with a one-second still-pointer delay.
* Use direct Ant Design, native `title` or custom CSS control tooltips.

## Decision Outcome

Chosen option: "Use the app `Tooltip` with a one-second still-pointer delay", because one
wrapper applies consistent timing across Dashboard controls.

Use `core/ui-foundation/feedback/Tooltip`, exported by `@kiao-dashboard-core`.
[ADR-00038](00038-tooltips-only-when-needed.md) governs usefulness and the 16-word limit.

The controlled wrapper receives Ant Design hover events and resets its countdown on each
document `mousemove`. `TOOLTIP_STILL_SECONDS` supplies the delay, overridable with
`mouseEnterDelay`. Explicit `open`, a non-hover trigger or `mouseEnterDelay={0}`
uses Ant Design behavior. `title` takes precedence over the optional `markdown` prop.

Disabled elements are wrapped in a `span` that receives hover events. The rule excludes
native `title` revealing truncated file/path/conversation values, Modal/Card/Alert heading
props, and in-SVG diagram descriptions in canvas coordinates.
