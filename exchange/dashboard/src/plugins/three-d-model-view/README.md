# `three-d-model-view` — binary glTF (`.glb`)

Opens a `.glb` as a model on a stage: turned with a drag, dollied with the wheel or a pinch,
nudged with a right-drag or two fingers, standing on its own shadow. Beside the stage it opens the
file's own account of itself — what wrote it, what it holds, what it costs — so that a model can be
judged and not only looked at. It claims nothing else, and sits beside the other media viewers
in the delivered lot.

| File | Holds |
| --- | --- |
| [`index.tsx`](./index.tsx) | The manifest, the main view, and its controls on the right of the document tab's strip. |
| [`useModelFile.ts`](./useModelFile.ts) | The one download, and the report read off it. Both the stage and the inspector are served from these bytes. |
| [`glb.ts`](./glb.ts) | The container the document is packed in, and the pixel size an image writes into its own header. Bytes in, declarations out — no decoder involved. |
| [`report.ts`](./report.ts) | What the file declares: what it is, what it holds, what it costs, and what looks wrong. Pure arithmetic over a parsed document, and the larger of the two modules the unit tests are about. |
| [`format.ts`](./format.ts) | The units those numbers are read out in — millimetres or kilometres, kB or MB. |
| [`ReportPanel.tsx`](./ReportPanel.tsx) | The report, drawn. Read-only, in the CMS's own type and surface. |
| [`framing.ts`](./framing.ts) | Where the camera, the key light and the floor go, given the model's bounding box. Pure arithmetic — no WebGL, and the other module the unit tests are about. |
| [`scene.ts`](./scene.ts) | `ModelScene`: the renderer, the scene graph, the orbit controls and the draw loop. Imperative, and deliberately outside React. |
| [`ModelStage.tsx`](./ModelStage.tsx) | The React shell around one `ModelScene`, plus the states that are not a model — still arriving, not a model at all, or a model that will not draw. |

## What the reader does

| | PC | Phone |
| --- | --- | --- |
| Rotate | drag | one finger |
| Zoom | wheel | pinch |
| Pan | right-drag, or middle-drag | two fingers |
| Frame the model | the **⌖** button in the document's tab strip | same |
| Play / pause | the animation button, shown only for a model that carries clips | same |
| Inspect the file | the magnifier button in the document's tab strip | same, over the stage rather than beside it |

The camera is remembered per file (view state scope `model3d`), so a model reopens on the view it
was left in — and so does the inspector, open or closed. **Frame the model** both re-frames it and
forgets that view, rather than putting the reader straight back where they had just left.

## Why the geometry is computed rather than fixed

A `.glb` carries no unit. The same chair is authored at 2, at 0.02 and at 4000 depending on who
exported it, and a viewer built around constants is comfortable for exactly one of the three: the
others open as a speck, or from inside their own geometry, with the depth buffer either wasted or
too coarse to keep two surfaces apart.

So [`framing.ts`](./framing.ts) states every distance as a multiple of the loaded model's bounding
radius — the camera's distance, its near and far planes, the dolly limits, the light's position
and the extent of its shadow camera. That is also what makes it worth testing on its own: the
awkward cases (a millimetre model, a kilometre model, a portrait phone, a scene with nothing in
it) are arithmetic, and none of them needs a GPU to check.

Two of those are worth calling out:

- **The aspect ratio is part of the framing.** A camera is built with a *vertical* field of view,
  but a phone held upright is taller than it is wide, and it is the horizontal one that clips.
  Fitting on the vertical alone puts a model's sides off-screen on the device it was already
  hardest to look at.
- **The floor is dropped a hair below the model.** Models whose base is a flat slab sit exactly on
  the lowest point of their own bounding box, and two coplanar surfaces flicker against each other
  as the camera turns.

## The inspector

The panel answers four questions, in the order a reader asks them.

- **What is this file** — the generator that wrote it, the copyright it claims, the glTF version
  it is written to, and every extension it uses or requires, each marked with what this viewer can
  do about it: draw it, ignore it, or decode nothing without a decoder it does not ship.
- **What does it hold** — scenes, nodes, meshes and primitives, materials, textures and images,
  cameras, skeletons and their joints, and each animation clip with its length and its channels.
- **What does it cost** — triangles and vertices as the drawn scene places them, every byte of the
  file attributed to what claimed it, every image with its resolution and its weight, and the
  extent of the model in metres.
- **Is anything about it worth knowing** — several scenes where only one is drawn, nodes belonging
  to no scene, a scene made of separate trees, names following a level-of-detail convention this
  viewer draws all at once, meshes and images carried and never drawn, resources kept outside the
  file, a required extension that will stop the model being drawn, and a model whose size says it
  was authored in some unit other than the metre.

Four decisions hold it up.

**The file is fetched once.** [`useModelFile.ts`](./useModelFile.ts) downloads it, and the same
`ArrayBuffer` is what the report is read from and what the stage is handed. A model is a few
megabytes over an authenticated request; there is no version of this view worth having in which
that happens twice.

**The report is read before any decoder is involved.** A glTF file is a description before it is a
picture: a twelve-byte header, a JSON document, and a block of bytes the document indexes into.
Everything in the report comes out of that document, which is why the report does not depend on the
render having succeeded — and why the file most worth reporting on, the one no loader here can
draw, is reported on in full.

**What is not declared is derived, never guessed.** Four figures are worth naming, because they
look measured and are not:

- the **bounding box** comes from the minimum and maximum that the specification requires of every
  `POSITION` accessor, put through the world matrix of each node placing that mesh — a rotated box
  re-enclosed, which can only overstate the model and never understate it;
- a **clip's length** is the largest time its samplers' input accessors reach, and an input
  accessor, being scalar, declares its maximum;
- an **image's resolution** is read from the first bytes of the PNG, JPEG, WebP or KTX2 itself,
  since glTF declares an image's weight and its type but never its size — and a GPU pays for
  pixels, not for the compression they arrived in;
- the **byte budget** attributes each range of the binary chunk to whatever points at it: an image,
  a mesh's attributes, an animation's keyframes, a skin's bind matrices. What is left — padding,
  and ranges nothing points at — is `other`, which is why the lines sum to the file exactly rather
  than to a little less than it. Compressed geometry is followed to where it actually lives: Draco
  keeps it in a range of its own, and meshopt keeps it where its extension says rather than where
  its buffer view does.

**It describes, and touches nothing.** No scene is switched, no material or animation is edited,
nothing is selected or exported. Which scene is drawn is the file's choice — the one it names, or
the first — and the panel reports that choice rather than offering to change it.

## Drawing, and not drawing

Frames are drawn on demand: when the camera has moved, when the stage has been resized, and while
an animation is running. A model at rest is a still image, and redrawing it sixty times a second
is a phone's battery spent on nothing. `OrbitControls.update()` reports whether the camera moved,
which is what makes the idle case detectable rather than guessed at.

The lighting is a generated `RoomEnvironment` — glTF materials are lit by their surroundings, and
under lights alone a metal has nothing to reflect and reads as black plastic — plus one
shadow-casting directional key. The shadow lands on an invisible `ShadowMaterial` plane, so the
model gets its ground contact without a floor being drawn to look at.

The backdrop is a studio sweep drawn *into the scene*, not a CSS gradient behind a transparent
canvas. It looked the same either way and it is not the same at all: a transmissive surface is
see-through in three by sampling the frame already drawn behind it, and behind a transparent canvas
there is no frame to sample — glass came out as a hole for the page to show through rather than as
glass. It is one sweep on every CMS theme, because it is a photographic backdrop rather than a
surface of the page: a clear glass on a white sweep is a white shape whatever the page is doing.

No WebGL context is asked for until the bytes are in hand, and a model that will not draw no longer
ends the reader's visit: the message says so, and the report opens beside it.

## Glass

`transparency.ts` settles, once and before the first frame, how a loaded model's see-through
materials are drawn. It is the one place where a material is edited rather than obeyed, and it
exists because for glass what a glTF declares is routinely not what it means.

`KHR_materials_transmission` is what makes a surface glass: seen through and still lit, reflecting
its surroundings, taking a highlight, tinting what is behind it. Alpha blending does none of that —
it only fades a surface out — and the extension says as much, asking that a transmissive material
be drawn as an opaque one. Exporters stamp `alphaMode: BLEND` on it regardless, and three, quite
correctly, obeys the file: the glass is faded out by its base colour's alpha and the transmission
that would have made it glass never shows. Read the declaration the way the extension asks and the
glass comes back — along with a base colour the surface was never meant to wear, because in such a
file that colour is a decal masked away over the rest of the surface by exactly the alpha that has
just stopped being coverage. So the alpha is moved from coverage to colour rather than dropped:
three lines of GLSL after the base colour is sampled, leaving the decal where it was painted and
clear glass everywhere else.

The other half is ordering. three draws transmissive surfaces in a pass of their own — everything
opaque into a buffer first, which the glass then reads to find out what is behind it. An
alpha-blended object is in neither half of that: not in the buffer, so the glass cannot see it, and
drawn after the glass, so it lands in front of it. A decanter's whisky, blended at three percent by
an exporter's habit, is drawn as a solid cube over the bottle holding it. A material that opaque
loses nothing by being drawn opaque and gains its place behind the glass, so it is — and one that
means to be seen through, or whose alpha varies across its surface, is left exactly where it is.

None of this invents a number the file does not carry: no thickness is supplied where no
`KHR_materials_volume` declares one, and a model with no glass in it is left as it loaded. What the
glass ends up showing is the stage's own backdrop — which is why that backdrop is drawn into the
scene rather than left to CSS.

## Known limits

- **Compressed geometry is not decoded.** A `.glb` compressed with Draco or meshopt needs its
  decoder shipped alongside the app, which is build machinery rather than a line of code here — and
  the same goes for the Basis textures of `KHR_texture_basisu`. What such a file no longer is, is a
  dead end: it opens on its report, which names the extension that stopped it and still counts its
  triangles, its clips, its textures and its bytes, because the accessors keep their counts even
  when the bytes behind them are compressed. Only the picture is missing.
- **The report is the file's own account of itself.** Every count is what the document declares,
  not what a decoder found in the buffers: a file whose accessors disagree with its geometry is
  reported as it declares itself. That is the price of a report that works on a file no decoder
  here can open, and it is the right way round — the declaration is also what every other tool in
  the pipeline will read.
- **An image's size is read for four formats.** PNG and JPEG from the core specification, WebP and
  KTX2 from the two texture extensions in common use. An AVIF texture states its size several boxes
  deep inside an ISOBMFF container, and is reported with its weight but without its resolution.
- **`.gltf` is not claimed.** It is a JSON manifest pointing at its geometry and textures as
  sibling files, each of which is another authenticated request into the store. A `.glb` holds
  all of it in the one file, which is why it is the format this plugin is for. A JSON document
  saved *under* a `.glb` name is read anyway — the stage draws what it can, and the report says
  both that it found one and what the file leaves outside itself.
