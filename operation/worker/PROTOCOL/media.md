---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Media

← [worker wire protocol](/operation/worker/PROTOCOL.md).

A video's segments saved as files of their own. TypeScript types:
`reference/kiao-worker/src/media-types.ts`.

| Method | Path | Body | Answer |
| --- | --- | --- | --- |
| `POST` | `/media/saveSegments` | `{ path, segments: MediaSegment[] }` | `202 MediaJob` |
| `GET` | `/media/jobs/{id}` | — | `MediaJob` |
| `DELETE` | `/media/jobs/{id}` | — | `MediaJob` — the save stopped where it stands |

```ts
interface MediaSegment { name: string; fromMs: number; toMs: number; }
interface MediaJob {
    id: string;
    path: string;                  // the video or the recording cut
    state: 'running' | 'done' | 'failed' | 'stopped';
    files: string[];               // where the segments are saved, in the order they are written
    done: number;                  // how many of them are
    current?: string;              // the one being written
    progress: number;              // 0 to 1 through the whole save, by the length of what is encoded
    error?: string;
    startedAt: string;
    endedAt?: string;
}
```

Each segment becomes `<the source's folder>/<name>.mkv`: AV1 and Opus in Matroska, encoded by
ffmpeg. **`name` is the file's name, not the segment's** — Dashboard sends the segment's name as the
store names a file after a title (`toStoreName`) — and it is refused with `400` if it is empty, a
path, hidden, or has a space at either end; so are two segments landing on one file and a segment
landing on the source itself, compared without case, as a Drive or a Windows disk compares names.

**`fromMs` and `toMs` are where the images are**, not the segment's stored ends: the start of its
first image and the end of its last, fractional where the file's own times are. ffmpeg is asked for
that window drawn in by half a millisecond at both ends, which keeps the first image and leaves out
the next one whichever way a container rounded their times; the input is seeked and re-encoded, so
a segment starts on its own image and not on the key image before it.

A file already at that name is **replaced whole**: each segment is written under a hidden name
beside its destination and renamed over it once ffmpeg has finished, so a save that fails or is
stopped leaves that file as it was — and keeps the segments it had saved before it. Everything that
can be refused is refused before the first segment starts.

**`424` is a machine with no ffmpeg able to do it**: none at all, one without an AV1 encoder
(libsvtav1, then libaom-av1, then librav1e) for a source with a picture, or one without an Opus
encoder for a source with a sound. The body is the sentence to show. ffmpeg is the toolbox's
`ffmpeg` runtime — looked for in the toolbox's prefix first and on the PATH after, at every save — so
installing it through the [toolbox](./toolbox.md) (`POST /toolbox/install {"ids":["ffmpeg"]}`)
is what answers a 424, and it is what Dashboard offers. A file ffmpeg cannot read at all is `400`.

One save at a time, as there is one install at a time: a second while one runs is `400`. Only the
last save is kept, and an older id is `400`.
