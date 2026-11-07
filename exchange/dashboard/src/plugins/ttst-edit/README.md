---
status: DRAFT
role: PRIMARY_SOURCE
---

# ttst-edit

Edits monolingual text-to-speech scripts in `.ttst.md`, with speech settings in a sidecar:

```text
name.ttst.md              spoken Markdown text
name.ttst.md.config.json  language, voice, title, overrides and generated audio metadata
```

`TtstEditor.tsx` uses `useTextFileSync` for autosave and external script changes; voice changes
write the sidecar immediately and clear `hash` and `audioHash`. The shared
[TTS kit](../../kit/tts/ttst.ts) owns extensions, paths, `TtstConfig` and read/write helpers,
so producers never need to import this plugin.

The manifest declares `.ttst.md`; [suffix resolution](../../../docs/solution-design/plugins-runtime.md#file-resolution)
selects it ahead of generic Markdown independently of catalogue order. The settings sidecar is
unclaimed and opens as JSON in `code-edit`.

## What the script may carry

Audio producers consume pause and paired question tags before sending text to a speech provider:

```text
Listen carefully.<break time="2s"/>
<mark>What is the capital?</mark>
<mark name="capital">What is the capital?</mark>
```

| Tag | Meaning |
| --- | --- |
| `<break time="2.5s"/>` | Seconds; `10000ms` or bare `400` also work, the latter in milliseconds |
| `<break strength="weak"/>` | Strength-based pause: weak, medium, strong or x-strong |
| `<break/>` | 750 ms; individual pauses cap at one minute |
| Paired `<mark>` | Question span; optional name travels into generated question metadata |

Paired marks and bare millisecond values are format conventions. A self-closing mark is dropped;
an unclosed mark extends to script end. The player repeats a question from its start and stops
at its end. Do not add answer-time pauses: synthesis already adds about a second of trailing
silence and places the stop midway to tolerate timing drift. Extra breaks add to that silence.

## Producers and generated metadata

Standalone scripts can use any name. Assemblies with units name scripts for their content-chain
item, for example `introduction.ttst.md`; the unit supplies language. Filename-derived language
is a fallback for standalone names such as `introduction.EN.ttst.md`.

| Sidecar field | Owner and meaning |
| --- | --- |
| `lang`, `ttsVoice` | Script language and provider-prefixed voice |
| `title` | Listener-facing episode name; can override a chain item's editorial label |
| `ttsOverrides` | Script/voice-specific pronunciation dictionary |
| `hash`, `audioHash` | Server-owned digests for current inputs and generated audio; do not edit by hand |
| `questions` | Start/end offsets generated with audio and valid for its `audioHash` |

The shared audio path is `name.mp3` beside `name.ttst.md`. Producers recompute digests and
question offsets when generating audio; unchanged audio is reusable when its digest matches.
