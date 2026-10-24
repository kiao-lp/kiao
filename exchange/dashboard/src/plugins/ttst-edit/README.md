# ttst-edit

Editor for `.ttst.md` — a **monolingual TTS script**: the text read aloud to synthesize audio.

```
<name>.ttst.md              the spoken script (plain markdown text)
<name>.ttst.md.config.json  { lang, title, ttsVoice, ttsOverrides, hash, questions }
```

Inside a unit folder a podcast is named for its chain item — `units/<docId>/introduction.ttst.md` —
since the folder already identifies the unit and the unit identifies the language. Every podcast of
a unit is named that way, the first as much as the third: none of them is "the" podcast. A
standalone script can be named anything.

Keeping the script in its own file means it is diffable, searchable and editable with ordinary
markdown tooling; everything about *how* it is spoken lives in the sidecar rather than inline.

| File | Role |
| --- | --- |
| `index.tsx` | Manifest. Claims `.ttst.md`. |
| `TtstEditor.tsx` | Script textarea (debounce-saved) + voice picker (written through to the sidecar). |

The *format* itself — the `TtstConfig` shape, the extension, the sidecar path and its read/write
helpers — lives in [`@cms-kit/tts`](../../kit/tts/ttst.ts), because other editors produce
these files too and plugins do not import from each other.

## What the script may carry

The script is prose, with two SSML tags in it. Neither is ever sent to a provider — Google's
Chirp3-HD voices reject SSML outright — so the server parses them out, synthesizes the pieces
between them separately and puts the audio together itself. Using SSML's own notation keeps a
transcript portable and free of a house convention.

```
Écoutez bien.<break time="2s"/>            a silence of the length you ask for
<mark>Quelle est la capitale ?</mark>       a question
<mark name="capitale">…</mark>             the same, named
```

`<break>` takes `time="10000ms"`, `time="2.5s"`, a bare `time="400"` (milliseconds), or SSML's
`strength="weak|medium|strong|x-strong"`; a bare `<break/>` is 750 ms, and a single pause is
capped at a minute.

**A question is a pair of tags around the text**, because it is a *span* where SSML's `<mark/>` is
a point: the player comes back to where it starts, and stops where it ends. The tag is SSML's, the
pairing is ours — as the bare `time="400"` is. A `<mark/>` that closes itself delimits nothing and
is simply dropped, and a `<mark>` nobody closes runs to the end of the script.

**Do not leave a long `<break>` after a question.** The silence for the listener to answer in is no
longer written into the audio: the player stops on its own once the question has been read out,
for as long as the listener needs, and its previous/next buttons put playback back at the start of
any question. What the marks are worth is written into the sidecar's `questions` when the MP3 is
made, so it goes stale with the audio and nothing else has to keep it fresh. A script that marks
nothing plays exactly as it always did — no resynthesis, and nothing to migrate.

**A short `<break>` after one is not needed either.** The server closes every question with about
a second of silence of its own and stops the player in the *middle* of it, so that a stop landing
slightly early or slightly late still lands where nothing is being said — a mark on the last word
of the question is what cuts the last word off, since a device is playing audio the position it
reports has already gone past. A `<break>` you write there is heard on top of that silence, not
instead of it.

**Ordering.** The plugin must sit **before `markdown-edit`** in the `PLUGINS` array of
[`src/App.tsx`](../../App.tsx): `findFilePlugin` is first-match, so `.md` would otherwise swallow
`.ttst.md`. `plugin-smoke.spec.ts` covers this.

The `.config.json` sidecar is deliberately unclaimed — `code-edit` shows it as raw JSON. See
/exchange/dashboard/docs/solution-design/README.md, "A sidecar is deliberately unclaimed".

## Producers

The main producer is a unit editor: a podcast is one item of a unit's ordered content chain, and
the export step fetches every script it references, recomputes each `hash` from voice + script, and
writes it back into its sidecar. `hash` is a cache key for the audio file, not something to edit by
hand — changing the voice here clears it so the next export regenerates the audio. Because the
audio path is keyed by hash, the several podcasts of one unit and language sit side by side without
colliding.

`title` is the reader-facing name of the script: the episode name in the player. It overrides the
chain item's editorial label, which is what a unit with several podcasts needs to name them for a
reader.

`ttsOverrides` is the pronunciation dictionary applied to this script's voice — term → how it
should be spoken. It sits here rather than on the unit because a dictionary is written in one
language and only ever corrects the script it accompanies.
