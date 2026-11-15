---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Runners

Read when pinning AI work to a machine or checking which machine can execute it. For AI
configuration, read [cards](../cards.md#settings); for why a chain stops, read [chains](../chains.md).

A runner is the machine that plays cards. Without `settings.runner`, a task runs wherever Play
is pressed. With a runner id, only that machine may play it. Reaching a task pinned to another
runner ends the local chain; it does not dispatch the task remotely.

Read `runner_list` before choosing an id. It returns runner ids, names and `lastSeen` timestamps.
Unknown runner ids are refused when writing task settings. `lastSeen` is read-only and absent
for a runner that has never reported itself alive. A registered name alone does not prove the
machine is currently available or has the required folders, harnesses and profiles.

`runner_get` reads one registration. `runner_create`, `runner_patch` and `runner_delete` manage
registrations; they do not provision machines, send heartbeats or start work. Preserve the full
settings object when changing a task's runner pin, including extension settings. HTTP request
shapes and endpoints are in [api-curl](../api-curl.md).
