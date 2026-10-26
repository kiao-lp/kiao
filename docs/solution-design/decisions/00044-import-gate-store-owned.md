---
id: "00044"
title: "the import gate is store content, and the store owns it"
status: accepted
date: 2026-09-08
tags: ["import-gate", "security", "store"]
components: ["worker", "dashboard"]
paths: ["kiao-user-config/import-gate"]
symbols: ["criticality", "navigator"]
triggers: ["sensitive data", "regex rule", "false positive", "new category", "criticality", "underline shape", "deleted category returns"]
supersedes: []
superseded_by: []
---

# 00044 — the import gate is store content, and the store owns it

**Decision:** what counts as sensitive in a document being imported is declared in
`kiao-user-config/import-gate/` — one JSON file per category, each a list of named regular
expressions with a criticality — and worker seeds that folder once, on a store that has
none, then never writes to it again. Dashboard reads it over the ordinary file API and runs the
matchers in the browser over the text of the document being reviewed, painting each finding at its
level and offering a navigator to step through them.

**Why not in the code.** A gate compiled into the build is a gate nobody can tune, and the tuning is
the whole job: which rules are noise depends on what a particular store actually holds. A folder of
JSON is editable in the CMS that reads it, committed with the store, travels when the store is
copied, and takes a category the store invented — `DOSSIER-\d{4}` — with no build and no release.
It also puts the catalogue where somebody can *read* it, which matters for a feature whose output
is a claim about their documents.

**Why the service seeds it.** Because a gate that is empty until somebody writes JSON is a gate that
never fires. The bundled catalogue — credentials and keys, classification markings, article-9 data,
personal identifiers, bank and payment data, HR records, network topology, contracts and IP — is
what makes the feature work on the day it ships, and it is embedded in the binary for the same
reason the skills are: kiao starts four ways and none of them should need a copy step.

**Seeded whole and once.** The alternative, restoring each bundled file that is missing, would make
a category somebody deleted on purpose come back at the next restart — and fighting the program over
your own configuration is the one thing a person editing this folder must not have to do. The price
is that a later build's new category has to be copied in by hand, or the folder deleted to be seeded
afresh, and that is the cheaper side of the trade.

**Criticality is about consequence, and never travels as colour alone.** The four levels decide the
fill a finding is painted in — and also its underline shape, and the word the navigator says. A
reviewer who cannot separate the red from the orange still has to be able to separate a leaked key
from a postcode. The same order resolves the overlaps two rules always produce over the same
characters: `password: ghp_…` is claimed by both a password rule and a GitHub-token rule, one
highlight can only be one colour, and the one that survives is the one that says the worse thing.

**The matchers are tuned to find rather than to be right.** A false positive costs a reviewer two
seconds; a secret nobody was shown costs a rotation. What that buys has to be paid for in precision,
so the calibration is done against real documents — the rules that fired on this repository's own
technical prose were narrowed until what is left is shapes rather than words, and the catalogue is
pinned by a suite that runs it in the browser's own regular expression engine, which is the only one
that can compile it.

**Nothing about it is fatal.** A store with no folder has an empty gate and a reader exactly as it
was before. A category whose JSON is broken loses that category; a rule whose pattern is broken
loses that rule. These files are hand-edited in a store that is in use, and a typo in the ninth
matcher must not take the other eight — still less the seven sibling categories — out of the gate.
