---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# movie-edit

Plays video or audio, steps video frames/keyframes, and records named segments in a sidecar. [PLUGIN_RENAMES](/exchange/dashboard/src/core/config/DashboardConfig-ctx.tsx) normalizes the `movie-view` ID.

## The view

The browser player keeps its native seek, volume and fullscreen controls. Additional controls
share [MovieEdit-ctx](MovieEdit-ctx.tsx):

| Surface | Controls |
| --- | --- |
| [TransportControls](TransportControls.tsx) in the document strip | Previous/next frame and keyframe, play/pause, displayed time, segment Start/End and current segment name |
| [SegmentsPanel](SegmentsPanel.tsx) tab | Add/select/rename/delete segments, edit endpoints and export files |

Audio omits frame controls. Start and End require a selected segment. Clicking the segment
name reveals the panel. Keyboard arrows step frames; Shift+arrows step keyframes. Adding a
segment creates and selects one at the displayed position. Segment metadata autosaves;
the panel's **Save** action creates media files as described below.

## Where the images are

Container metadata supplies frame timing through small HTTP range requests
([containers](containers/)):

| Container | Timing source |
| --- | --- |
| MP4/MOV | `moov` video sample tables, including composition offsets and edit-list shift; fragmented samples come from `moof` ranges |
| MKV/WebM | Video cues for keyframes and `DefaultDuration` for frame spacing; exact frames otherwise require reading every block |

[timeline.ts](timeline.ts) computes previous/next frames and keyframes. Seeks target a frame's
**middle**, avoiding rounding across boundaries. Displayed position comes from
`requestVideoFrameCallback`, because paused `currentTime` can be slightly ahead; stored positions
use the frame start. When metadata is absent, observed playback spacing is used, initially
30 fps, and keyframe buttons stay disabled.

## The segments

`clip.mp4.config.json` accompanies `clip.mp4`:

```json
{
  "segments": [
    { "id": "segment-1", "name": "Intro", "startMs": 700, "endMs": 1400 }
  ]
}
```

- Endpoints are whole milliseconds naming the **first and last included frames**. `TIME_TOLERANCE`
  identifies frame starts within a millisecond. Audio uses its two times directly.
- A start beyond the end moves the end; an end before the start moves the start.
- Serialization orders segments by media time. View state remembers the current segment by ID.
- Unknown fields at either level are preserved. Invalid segment data is shown as invalid and
  never overwritten.
- `useDocumentFileSync` follows outside edits. A missing sidecar stays absent until the first edit.

The sidecar opens as JSON via `code-edit`. Worker deletes it with its media file. **Rename does not carry it**: rename the `.config.json` separately to keep segments.

## Saving the segments

Save exports each segment beside the source, named through `toStoreName`, such as `Intro.mkv`.
Worker's `POST /media/saveSegments` uses AV1/Opus in Matroska. The UI follows progress and can
stop; already exported files remain.

`imageSpan` in `timeline.ts` cuts from the first frame's start through the last frame's end.
[saving.ts](saving.ts) rejects empty filenames, duplicate output names and names that overwrite
the source. Existing destination files are named in an overwrite confirmation.

If FFmpeg is unavailable, worker returns 424. [useSaveSegments](useSaveSegments.ts) offers the
configuration panel's install flow and retries after installation. Deployments that cannot
install report that limitation.

## Tests

Container tests use real two-second FFmpeg clips with irregular keyframes, checked against
ffprobe; fixture commands are in `containers/containers.test.ts`. Pure tests cover timeline,
segments and naming, with `MovieEdit-ctx.test.tsx` covering wiring and FFmpeg installation.
Worker's `internal/files/http/media_test.go` checks real cuts when FFmpeg is available.
[movie-edit.spec.ts](/e2e/tests/dashboard/movie-edit.spec.ts) verifies frame stepping, exported
media and external sidecar changes. Use the scoped runners in the repository guide.
