---
status: DRAFT
role: PRIMARY_SOURCE
---

# `three-d-model-view` — binary glTF (`.glb`)

Displays `.glb` models on an interactive stage with a read-only inspector. The same downloaded
bytes supply both views, so a rendering failure can still produce a useful report.

| File | Responsibility |
| --- | --- |
| [index.tsx](index.tsx) | Manifest, main view and document toolbar |
| [useModelFile.ts](useModelFile.ts) | Single authenticated download and report |
| [glb.ts](glb.ts) | Container parsing and image-header dimensions, without decoding geometry |
| [report.ts](report.ts) | Declared contents, geometry counts, byte budget and warnings |
| [format.ts](format.ts) | Size and distance formatting |
| [ReportPanel.tsx](ReportPanel.tsx) | Inspector UI |
| [framing.ts](framing.ts) | Camera, light and floor calculations |
| [scene.ts](scene.ts) | Imperative `ModelScene`, orbit controls and draw loop |
| [transparency.ts](transparency.ts) | Loaded-material adjustments before rendering |
| [ModelStage.tsx](ModelStage.tsx) | React lifecycle, loading and error states |

## What the reader does

| Action | Desktop | Touch |
| --- | --- | --- |
| Rotate | Drag | One finger |
| Zoom | Wheel | Pinch |
| Pan | Right- or middle-drag | Two fingers |
| Frame | Toolbar crosshair | Same |
| Play/pause animation | Animation control when clips exist | Same |
| Inspect | Toolbar magnifier; panel beside the stage | Panel over the stage |

The `model3d` view-state scope remembers camera and inspector visibility per file. Frame
recalculates the view and clears the remembered camera so it does not immediately restore it.

## Geometry

Authoring scales vary widely. Camera distance, clipping planes, dolly limits, key light and shadow-camera extent scale with the model's bounding radius. Framing considers vertical and horizontal field of view; portrait screens do not clip the sides. The floor sits below the lowest bound, clear of coplanar flicker.

These calculations live in `framing.ts` and can be tested without WebGL, including very small,
very large, empty and portrait cases.

## The inspector

| Section | Reports |
| --- | --- |
| Identity | Generator, copyright, version and used/required extensions with support status |
| Contents | Scenes, nodes, meshes, primitives, materials, images, cameras, skins/joints and animation channels |
| Cost | Placed-scene triangles/vertices, byte attribution, image resolution and model extent in metres |
| Warnings | Multiple scenes, disconnected or unused objects, LOD naming, external resources, unsupported required extensions and unusual scale |

The report reads declarations before any decoder or renderer. A file that cannot draw still
shows its metadata. Derived figures use:

- **Bounds:** `POSITION` accessor minima/maxima transformed by each placing node's world matrix.
  Re-enclosing rotated bounds can overestimate the shape.
- **Clip duration:** greatest declared maximum of sampler input accessors.
- **Image resolution:** PNG, JPEG, WebP or KTX2 headers; unsupported formats retain byte counts.
- **Byte budget:** binary ranges attributed to images, geometry, animation and skin data, including
  Draco and meshopt extension ranges. Unclaimed ranges, padding and remaining file bytes count
  as `other`, so totals match file size.

The inspector describes the selected/default scene; it does not switch scenes, edit materials,
select objects or export changes. The file's named scene, or its first scene, is rendered.

## Drawing, and not drawing

Frames render on camera changes, resize and animation. `OrbitControls.update()` detects motion;
a resting model does not redraw continuously. WebGL starts only after bytes arrive. If loading
or drawing fails, an explanatory state opens the report.

A generated `RoomEnvironment` lights reflective materials, with one directional key casting
onto an invisible `ShadowMaterial` plane. A studio sweep is rendered **inside the scene**,
allowing transmissive materials to sample a real background. A CSS gradient behind a transparent
canvas would not supply those pixels. The sweep stays consistent across Dashboard themes.

## Glass

`resolveTransparency` runs once before materials compile. With transmissive materials present:

- Transmissive BLEND materials render opaque for the transmission pass. A shader patch moves base
  color alpha into decal coverage, retaining painted regions while clearing the rest of the glass.
  Intentional MASK coverage remains unchanged.
- Other blended materials with opacity **≥0.95** and no separate alpha map become opaque, so they
  enter the transmission buffer behind glass rather than drawing over it afterward.
- Other transparency remains unchanged. No volume thickness is invented, and models without
  transmission receive no adjustments.

## Known limits

- Draco, meshopt and Basis decoders are not shipped. Unsupported compressed models still expose
  counts, clips, textures and bytes from declarations even when the stage cannot draw them.
- Counts describe the file's declarations, not decoded buffer contents; malformed accessors may
  therefore misrepresent actual geometry.
- AVIF dimensions are not read; the report gives its byte size without resolution.
- `.gltf` is not claimed because its external geometry and textures require separate store
  requests. JSON stored under a `.glb` filename is still read; the report identifies it and any
  external resources, and the stage draws what it can.
