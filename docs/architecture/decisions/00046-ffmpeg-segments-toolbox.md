---
id: "00046"
title: "a video's segments are saved by ffmpeg, and ffmpeg comes from the toolbox"
status: accepted
date: 2026-09-11
tags: ["video", "ffmpeg", "toolbox", "movie-edit"]
components: ["worker", "dashboard"]
paths: []
symbols: ["POST /media/saveSegments", "toolbox.RuntimeBinary", "UseFFmpeg", "424"]
triggers: ["segments", "save segments", "AV1", "no encoder", "install ffmpeg", "key image", "hidden name", "libsvtav1"]
supersedes: []
superseded_by: []
---

# 00046 — a video's segments are saved by ffmpeg, and ffmpeg comes from the toolbox

**Decision:** the Segments panel of `movie-edit` has a **Save** button that writes every segment as
a file of its own beside the video — AV1 and Opus in Matroska, named after the segment — and
worker does it by running ffmpeg (`POST /media/saveSegments`), not by encoding anything
itself. ffmpeg is a runtime of the configuration panel's catalogue, and a save on a machine without
one answers `424`, which Dashboard turns into an offer to install it before trying again.

**ffmpeg is found through the toolbox.** `toolbox.RuntimeBinary("ffmpeg")`, handed to the document
store by the program as `UseFFmpeg` and asked at every save: the libraries still never import each
other, and installing ffmpeg from the offer lets the save it was for start by itself rather than
after a restart. A machine that already has an ffmpeg uses it; one whose ffmpeg has no AV1 encoder
gets the same `424`, and installing the toolbox's puts a complete one ahead of it on the lookup.

**The build is BtbN/FFmpeg-Builds', not the distribution's.** Nothing asks for root, and
`apt install ffmpeg` is exactly the gesture the toolbox is built not to make. The static builds
FFmpeg's own download page sends Linux to carry libsvtav1 and libopus, publish a checksum list
beside the archives, and need nothing of the machine but glibc and `xz`. They are pinned to a release
branch, because there is no build of a tag to pin. Alpine, where the process is root, takes the
image's own package.

**Cut to the image, and re-encoded.** A segment's ends are images, so what is sent is the start of
its first image and the end of its last, as the plugin reads them out of the file; ffmpeg seeks the
input and keeps from the first image inside the window, where a copy of the stream could only have
started on a key image. The window is drawn in by half a millisecond at both ends, because containers
round their times, and Matroska rounds them to the millisecond.

**A job, one at a time, that replaces nothing half-way.** Encoding AV1 takes minutes and nginx sits
in front of the service, so a save answers 202 and is polled, as an install is; a second while one
runs is refused, an encoder already using every core. Each segment is written under a hidden name
and renamed over its destination once whole, so a save that fails or is stopped leaves the file it
was replacing as it was — and the panel names the files a save would write over before it does.
