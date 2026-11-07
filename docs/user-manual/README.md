---
status: DRAFT
role: PRIMARY_SOURCE
---

# Kiao user manual

## What is Kiao?

Kiao is an application for managing a document collection, source code repository or knowledge
base, creating content and working with AI agents. It combines DCMS, its document management
features, with hybridflow, its boards and agent workflows. A document is an identifiable,
persisted information artifact; content is a structured information unit intended for publication
or distribution. You use Kiao through Dashboard in a web browser, with your
files kept in a folder you choose. Kiao is available as a Docker image or as the `kiao`
executable. The image includes a database for boards; the executable can connect to a
boards service or use a PostgreSQL database you provide. Each installation serves one
person's files and work.

## Guide structure

The **Quick guide** gives the essentials for general use: minimum prerequisites, short
explanations and practical steps. Start there to use Kiao, and follow links to the
corresponding **Deep Dive** pages when you need more detail.

The **Deep Dive** covers the same subjects in greater depth, with detailed explanations,
options and reference material.

When writing, make each quick-guide page sufficient for general use, including its
minimum prerequisites. Put detailed explanations and options in Deep Dive, linked from
the relevant quick-guide passage. Keep the two levels consistent.

## Table of contents

| Part | Page |
|---|---|
| Quick guide | [Components and installation](quick-guide/components-and-installation.md) |
| Quick guide | [Copy text files between instances](quick-guide/copy-text-files.md) |
| Deep Dive | [Docker image](deep-dive/kiao-docker.md) |
| Deep Dive | [Executable](deep-dive/kiao-executable.md) |

| Quick guide | [Pi (Agent)](quick-guide/pi-agent.md) |
