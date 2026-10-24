# movie-edit

Plays a video or a recording, steps a video image by image and key image by key image, and cuts
either into named segments kept in a sidecar beside it.

It was `movie-view` until it could cut. A store whose configuration still names `movie-view` gets
this plugin: the old id is one entry of `PLUGIN_RENAMES` in
[`cms-core/config/DashboardConfig-ctx.tsx`](/exchange/dashboard/src/cms-core/config/DashboardConfig-ctx.tsx).

## The view

The file plays in the browser's own player — its seek bar, its volume, its full screen — and
nothing is drawn over it. What the plugin adds is in two places, which read one provider,
[`MovieEdit-ctx.tsx`](./MovieEdit-ctx.tsx), mounted by the main view around its layout:

- **The document tab's controls** ([`TransportControls.tsx`](./TransportControls.tsx)): a key image back, an image
  back, play/pause, an image forward, a key image forward; the time of the image on screen; **Start**
  and **End**, which save that time as an end of the current segment and wait for one to be
  current; and the current segment's name, which brings the Segments panel up. A recording has no
  images, and gets the play button, the time and the two ends.
- **The Segments panel** ([`SegmentsPanel.tsx`](./SegmentsPanel.tsx)), a tool bar tab: the segments
  in the order they come in the video. **Add segment** makes one at the image on screen and makes it
  current; a click makes another current; the name is edited in place; each of the two times goes
  there; the bin throws the segment away. **Save** writes every segment as a file of its own — see
  *Saving the segments* below.

The arrows step as they do through a folder's pictures: ← and → an image at a time, Shift+← and
Shift+→ a key image at a time.

## Where the images are

A browser plays a video and says nothing of the images it is made of: there is no next image, no
list of key images, and `currentTime` is wherever the last seek put it. So the file is read
instead — a few kilobytes of it, by HTTP range requests ([`containers/`](./containers)):

| File | What says where the images are |
| --- | --- |
| MP4, MOV | The video track's sample table in `moov`: every image and every key image, with the B-frames' composition offsets and the edit list's shift applied. A fragmented file's are read out of each `moof`, one request apiece. |
| MKV, WebM | The cues, which on a video track are its key images, and the track's `DefaultDuration` for the rest — the images themselves are listed only by reading every block. |

[`timeline.ts`](./timeline.ts) is the moves, and is pure: the image on screen, the next and the
previous one, the next and the previous key image. A step seeks to the **middle** of its image,
never to its edge: a seek shows the image whose span holds the time asked for, and an edge is one
rounding away from either neighbour.

**Where the reader stands** is the image on screen as `requestVideoFrameCallback` reports it, not
`currentTime`, which a pause leaves a little past it. A position is shown, and saved, as the start
of its image.

A file that says nothing of its images — a browser's own WebM recording has no cues and no
duration per image — is stepped at the spacing its images are seen to have while it plays, thirty
to the second until then, and its key-image buttons stay off.

## The segments

They are kept in the file's own `.config.json` — `clip.mp4.config.json` beside `clip.mp4` — the
sidecar an article and a podcast script keep their settings in, which worker deletes along
with the file:

```json
{
  "segments": [
    { "id": "0e5b…", "name": "Intro", "startMs": 700, "endMs": 1400 }
  ]
}
```

- `startMs` and `endMs` are the times of the segment's **first and last image**, both of them in it,
  in whole milliseconds — the unit a podcast's questions are written in beside it. A millisecond is
  less than half of any image, so a stored time names one image and one only: going there seeks the
  image starting within a millisecond of it (`TIME_TOLERANCE`).
- A segment never ends before it starts. A start set past the end pushes the end along with it, and
  an end set before the start pushes it back.
- The list is kept, and written, in the order it comes in the video. `id` is what the current
  segment is remembered by, in the file's view state.
- What else the file holds, at either level, is carried through untouched. A file that does not
  read as segments is shown as such, and never written over.
- It is opened with `useDocumentFileSync`, so a change made to it elsewhere — by hand, by an agent's
  turn — is read back in while the video is open. A video nobody has cut has no sidecar; the first
  segment is what writes it.

The sidecar is deliberately unclaimed, as a script's is: opened on its own it is JSON, and
`code-edit` shows it as such. **A rename leaves it behind** — worker moves a file's
subsidiaries with it but not its settings sidecar — so a renamed video has to have its
`.config.json` renamed with it.

## Saving the segments

**Save**, beside **Add segment**, writes every segment as a file of its own beside the video: AV1 and
Opus in Matroska, named after the segment — `Intro.mkv` beside `clip.mp4` — as the store names a file
after a title (`toStoreName`). It is worker that does it, by running ffmpeg
(`POST /media/saveSegments`, described in worker's `PROTOCOL.md`); the panel follows the save
while it runs, with a button to stop it, and the segments already saved stay when it is stopped.

- **What is cut** is the stretch a segment covers: from the start of its first image to the end of
  its last, where the file says they are — `imageSpan` in [`timeline.ts`](./timeline.ts), the same
  reading the steps use. A recording's is its two times.
- **Before anything is asked**, a segment whose name leaves nothing to name a file after, two that
  would be one file, and one that would be saved over the video itself are refused, naming the
  segment to rename ([`saving.ts`](./saving.ts)). Files the folder already has are named, and written
  over only on a yes.
- **Where the machine has no ffmpeg able to do it**, the service answers 424 and the panel offers to
  install the configuration panel's `ffmpeg`, then saves by itself once it is in place. A deployment
  that installs nothing says so instead ([`useSaveSegments.ts`](./useSaveSegments.ts)).

## Tests

`containers/containers.test.ts` reads real files, each a two-second clip ffmpeg wrote with its key
images forced at irregular times, and checks them against what `ffprobe` says of the same file; the
commands are in the test. `timeline.test.ts`, `segments.test.ts` and `saving.test.ts` are the pure
halves, and `MovieEdit-ctx.test.tsx` the wiring — the save included, down to the offer to install
FFmpeg. What ffmpeg makes of a segment is worker's test (`internal/files/http/media_test.go`),
which cuts a real clip where there is an ffmpeg to run. The browser end — the steps landing on the right images, the
segment written beside the video, and a sidecar written elsewhere read back — is
[`movie-edit.spec.ts`](/e2e/tests/dashboard/movie-edit.spec.ts).
