---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-11
tags: ["video", "ffmpeg", "toolbox", "movie-edit", "worker", "dashboard"]
triggers: ["segments", "save segments", "AV1", "no encoder", "install ffmpeg", "key image", "hidden name", "libsvtav1", "POST /media/saveSegments", "toolbox.RuntimeBinary", "UseFFmpeg", "424"]
supersedes: []
superseded_by: []
---

# 00033 — Segments save via ffmpeg as AV1/Opus files.

## Context and Problem Statement

Saving segments needs image-accurate boundaries and an AV1 encoder. Encoding can take
minutes behind nginx, and a failed or stopped save must preserve an existing destination.

## Considered Options

* Run toolbox-resolved ffmpeg jobs that re-encode segments as AV1/Opus files.
* Encode segments inside worker.
* Copy the existing stream from key-frame boundaries.
* Install the distribution ffmpeg through elevated permissions.

## Decision Outcome

Chosen option: "Run toolbox-resolved ffmpeg jobs that re-encode segments as AV1/Opus files",
because ffmpeg supplies the encoder and re-encoding supports the selected image boundaries.

The `movie-edit` Segments panel's **Save** calls `POST /media/saveSegments` to write
each named segment beside the video as AV1/Opus in Matroska.

The program supplies `UseFFmpeg` to the document store without library-to-library imports.
Each save asks `toolbox.RuntimeBinary("ffmpeg")`, preferring the toolbox installation
over an existing binary. Missing ffmpeg or an AV1 encoder returns `424`; Dashboard offers
installation and retries without a restart.

Non-root Linux uses BtbN/FFmpeg-Builds static builds carrying libsvtav1 and libopus, with
published checksums and only glibc and `xz` prerequisites. They are pinned to a release
branch because tagged builds are unavailable. Root Alpine uses the image's package.

The plugin sends the start of the first image and end of the last. ffmpeg seeks and
re-encodes from the first image inside the window; stream copy could start only at a
key image. Both bounds move inward by half a millisecond to account for container rounding,
including Matroska's millisecond precision.

A save returns `202` for a polled job, with one job allowed at a time. Each segment is
written under a hidden name and renamed over its destination only when complete.
The panel names destinations that will be overwritten before starting.
