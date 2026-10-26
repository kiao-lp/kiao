/**
 * What a model declares about itself, read off the document rather than off the drawing.
 *
 * A glTF file is a description before it is a picture: every count, every byte range, every
 * accessor's bounds and every extension it leans on is written in the JSON chunk, in the open, in
 * front of any geometry being decoded. That is the whole basis of this module. It answers four
 * questions — what the file says it is, what it holds, what it costs, and what looks wrong — from
 * the declaration alone, so the answer is the same whether the stage next door drew the model or
 * gave up on it. A file this app cannot decode is precisely the file whose report is worth most.
 *
 * It is arithmetic over a parsed document: no WebGL, no loader, no three.js, nothing to mock. The
 * awkward cases — a mesh drawn by six nodes, a scene nothing points at, a texture the size of the
 * rest of the file — are all counting problems, and none of them needs a GPU to check.
 *
 * Two habits run through it. Nothing is trusted: the document comes from the store and every index
 * into it may be out of range, so a lookup that fails contributes nothing rather than throwing away
 * the rest of the report. And nothing is invented: a quantity the file does not declare is absent
 * from the report — never a zero standing in for an unknown.
 */

import {
    imageSize, type GlbFile, type Gltf, type GltfBufferView, type GltfMesh, type GltfNode,
} from './glb';

/* ------------------------------------------------------------------------- the report ------- */

/** Everything the inspector has to say about one file. */
export interface ModelReport {
    identity: Identity;
    extensions: ExtensionUse[];
    inventory: Inventory;
    weight: Weight;
    anomalies: Anomaly[];
}

/** What the file says about itself, before anything is counted. */
export interface Identity {
    /** The glTF version it is written to, and the lowest version able to read it. */
    version: string;
    minVersion: string;
    /** The tool that wrote it, and the rights it claims — both often left blank by the exporter. */
    generator: string;
    copyright: string;
    container: GlbFile['container'];
}

/**
 * What this viewer can do with an extension.
 *
 * `decoder-missing` is the interesting one: three.js implements it, but only through a decoder
 * handed to the loader, and this build ships none of them — see the README's "Known limits".
 */
export type ExtensionSupport = 'drawn' | 'decoder-missing' | 'ignored';

export interface ExtensionUse {
    name: string;
    /** Declared in `extensionsRequired`: a viewer that cannot honour it must not draw the file. */
    required: boolean;
    support: ExtensionSupport;
}

/** What the file holds. */
export interface Inventory {
    scenes: number;
    /** The scene that gets drawn: its index, and the name it goes by. */
    drawnScene: number;
    drawnSceneName: string;
    nodes: number;
    /** Nodes of the drawn scene with no parent — its separate trees. */
    roots: number;
    meshes: number;
    primitives: number;
    morphTargets: number;
    materials: number;
    textures: number;
    images: number;
    cameras: number;
    skins: number;
    /** Joints of the largest skeleton — what a skinned model costs the animation system. */
    joints: number;
    animations: Clip[];
}

/** One animation clip, timed from the last keyframe its samplers declare. */
export interface Clip {
    name: string;
    channels: number;
    /** Seconds. Zero for a clip whose inputs declare no bounds. */
    duration: number;
}

/** What the file costs. */
export interface Weight {
    /** The file, whole. */
    bytes: number;
    /** Where those bytes went. Sums to `bytes`. */
    budget: BudgetLine[];
    /** Triangles as the drawn scene places them, instances counted. */
    triangles: number;
    /** Triangles the meshes hold between them, each counted once. */
    uniqueTriangles: number;
    /** Vertices, as placed and as held. */
    vertices: number;
    uniqueVertices: number;
    /** Every image the file carries, heaviest first. */
    images: ImageWeight[];
    /** Pixels over all of them — a GPU pays for these, not for the bytes they were shipped in. */
    pixels: number;
    /** What the model measures, or `null` when nothing in it declares a position. */
    extent: Extent | null;
}

export type BudgetKind = 'structure' | 'geometry' | 'textures' | 'animation' | 'skinning' | 'other';

export interface BudgetLine { kind: BudgetKind; bytes: number }

export interface ImageWeight {
    name: string;
    /** As declared, or read from the bytes when the document does not say. */
    mime: string;
    bytes: number;
    /** Zero for an image whose header this reader does not know, or that is not in this file. */
    width: number;
    height: number;
}

/** The box the drawn scene occupies, in glTF's units — which the specification fixes as metres. */
export interface Extent {
    min: Vec3;
    max: Vec3;
    size: Vec3;
}

export type Vec3 = [number, number, number];

/** Something worth the reader's attention: not an error, but not what one would assume either. */
export interface Anomaly {
    /** A stable name for the finding, so a test can ask for one without matching prose. */
    kind: string;
    /** `warning` where the model will not draw as its author meant it to; `note` otherwise. */
    level: 'warning' | 'note';
    text: string;
}

/* --------------------------------------------------------------- what the viewer can draw ---- */

/**
 * Extensions three.js's loader implements outright — its own `EXTENSIONS` table
 * (`three/examples/jsm/loaders/GLTFLoader.js`), less the four below.
 */
const DRAWN_EXTENSIONS = new Set([
    'KHR_binary_glTF',
    'KHR_lights_punctual',
    'KHR_materials_clearcoat',
    'KHR_materials_dispersion',
    'KHR_materials_ior',
    'KHR_materials_sheen',
    'KHR_materials_specular',
    'KHR_materials_transmission',
    'KHR_materials_iridescence',
    'KHR_materials_anisotropy',
    'KHR_materials_unlit',
    'KHR_materials_volume',
    'KHR_materials_emissive_strength',
    'KHR_texture_transform',
    'KHR_mesh_quantization',
    'EXT_materials_bump',
    'EXT_texture_webp',
    'EXT_texture_avif',
    'EXT_mesh_gpu_instancing',
]);

/**
 * Implemented by the loader, but only once a decoder is handed to it — and this build hands it
 * none. Each is a WebAssembly blob of its own, which is build machinery rather than a line of
 * code here. A file *requiring* one of these is a file this plugin can report on and not draw,
 * which is the case the inspector exists for.
 */
const DECODER_EXTENSIONS = new Set([
    'KHR_draco_mesh_compression',
    'EXT_meshopt_compression',
    'KHR_meshopt_compression',
    'KHR_texture_basisu',
]);

const supportOf = (name: string): ExtensionSupport => {
    if (DRAWN_EXTENSIONS.has(name)) return 'drawn';
    if (DECODER_EXTENSIONS.has(name)) return 'decoder-missing';
    return 'ignored';
};

/* ------------------------------------------------------------------------ the reading -------- */

/** Triangles, per the glTF primitive modes: 4 is a list, 5 a strip, 6 a fan; 0 to 3 are not. */
const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

/** Below this the model is likelier authored in millimetres than actually that small, and above it,
 *  in centimetres or in nothing at all. Both are worth saying out loud, neither is worth refusing. */
const IMPLAUSIBLY_SMALL_METRES = 0.01;
const IMPLAUSIBLY_LARGE_METRES = 1000;

/** Nodes named `Body_LOD0`, `wheel lod 2` and the like — a convention, not a glTF feature. */
const LOD_NAME = /(^|[_\-. ])lod[_\-. ]?\d+$/i;

/** Read a file's own account of itself. Total: it describes whatever it was given. */
export const reportOn = (file: GlbFile): ModelReport => {
    const { json } = file;
    const scenes = json.scenes ?? [];
    const nodes = json.nodes ?? [];
    const meshes = json.meshes ?? [];
    const images = json.images ?? [];

    // Which scene gets drawn: the one the file names, and scene 0 when it names none — the same
    // choice three.js's loader makes, so the report is about the model the reader is looking at.
    const declaredScene = typeof json.scene === 'number' ? json.scene : -1;
    const drawnScene = scenes.length === 0 ? -1
        : declaredScene >= 0 && declaredScene < scenes.length ? declaredScene : 0;

    const roots = drawnScene >= 0 ? (scenes[drawnScene].nodes ?? []) : [];
    const placed = placementsIn(json, roots);
    const reachable = new Set<number>();
    for (const scene of scenes) for (const index of walk(nodes, scene.nodes ?? [])) reachable.add(index);

    const drawn = drawnCost(json, placed);
    const held = heldCost(json, meshes);
    const weighed = weighImages(file, images);
    const extent = extentOf(json, placed);

    const anomalies: Anomaly[] = [];
    const note = (kind: string, text: string) => anomalies.push({ kind, level: 'note', text });
    const warn = (kind: string, text: string) => anomalies.push({ kind, level: 'warning', text });

    const extensions = extensionsOf(json);
    for (const extension of extensions) {
        if (!extension.required || extension.support === 'drawn') continue;
        warn('required-extension', extension.support === 'decoder-missing'
            ? `${extension.name} is required, and its decoder is not shipped with this viewer: the model cannot be drawn here.`
            : `${extension.name} is required, and this viewer does not implement it: the model may be drawn wrongly, or not at all.`);
    }

    if (file.container === 'json') {
        note('json-container', 'This file is named .glb but holds a JSON glTF document rather than a binary one.');
    }
    const external = externalCount(json);
    if (external > 0) {
        warn('external-resources', `${external} ${external > 1 ? 'buffers or images are' : 'buffer or image is'} kept outside this file; this viewer reads no sibling files, so that much of the model is missing.`);
    }
    if (scenes.length > 1) {
        note('many-scenes', `${scenes.length} scenes, of which one is drawn: ${sceneName(json, drawnScene)}.`);
    }
    if (scenes.length > 0 && declaredScene < 0) {
        note('no-default-scene', 'No scene is declared as the default one; the first is drawn.');
    }
    if (roots.length > 1) {
        note('many-roots', `The drawn scene is ${roots.length} separate trees rather than one.`);
    }
    const orphans = nodes.length - reachable.size;
    if (orphans > 0) {
        note('orphan-nodes', `${orphans} of the ${nodes.length} nodes ${orphans > 1 ? 'belong' : 'belongs'} to no scene, and ${orphans > 1 ? 'are' : 'is'} not drawn.`);
    }
    const lods = countLodNames(nodes, meshes);
    if (lods > 0) {
        note('lod-naming', `${lods} ${lods > 1 ? 'nodes or meshes are' : 'node or mesh is'} named as a level of detail; this viewer draws every level at once.`);
    }
    const unusedMeshes = meshes.length - new Set(placed.map(one => one.mesh)).size;
    const unusedImages = images.length - usedImages(json).size;
    if (unusedMeshes > 0 || unusedImages > 0) {
        const carried = [
            unusedMeshes && `${unusedMeshes} mesh${unusedMeshes > 1 ? 'es' : ''}`,
            unusedImages && `${unusedImages} image${unusedImages > 1 ? 's' : ''}`,
        ].filter(Boolean).join(' and ');
        const one = unusedMeshes + unusedImages === 1;
        note('carried-unused', `${carried} ${one ? 'is' : 'are'} carried but never drawn.`);
    }
    if (drawn.nonTriangle > 0) {
        const many = drawn.nonTriangle > 1;
        note('non-triangles', `${drawn.nonTriangle} ${many ? 'primitives draw' : 'primitive draws'} points or lines rather than triangles, and ${many ? 'are' : 'is'} not in the count above.`);
    }
    if (meshes.length === 0) {
        warn('no-geometry', 'The file holds no mesh: there is nothing to draw.');
    }
    if (extent && !extent.declaredWhole) {
        note('partial-extent', 'Some meshes declare no bounds of their own, so the measurements below cover only part of the model.');
    }
    const largest = extent ? Math.max(...extent.size) : 0;
    if (extent && largest > 0 && largest < IMPLAUSIBLY_SMALL_METRES) {
        note('unit-scale', 'The model measures under a centimetre. glTF units are metres, so this one was likely authored in another unit.');
    }
    if (extent && largest > IMPLAUSIBLY_LARGE_METRES) {
        note('unit-scale', 'The model measures over a kilometre. glTF units are metres, so this one was likely authored in another unit.');
    }

    return {
        identity: {
            version: json.asset?.version ?? '',
            minVersion: json.asset?.minVersion ?? '',
            generator: json.asset?.generator ?? '',
            copyright: json.asset?.copyright ?? '',
            container: file.container,
        },
        extensions,
        inventory: {
            scenes: scenes.length,
            drawnScene,
            drawnSceneName: sceneName(json, drawnScene),
            nodes: nodes.length,
            roots: roots.length,
            meshes: meshes.length,
            primitives: meshes.reduce((total, mesh) => total + (mesh.primitives?.length ?? 0), 0),
            morphTargets: meshes.reduce((total, mesh) => total + (mesh.primitives ?? [])
                .reduce((count, primitive) => count + (primitive.targets?.length ?? 0), 0), 0),
            materials: json.materials?.length ?? 0,
            textures: json.textures?.length ?? 0,
            images: images.length,
            cameras: json.cameras?.length ?? 0,
            skins: json.skins?.length ?? 0,
            joints: Math.max(0, ...(json.skins ?? []).map(skin => skin.joints?.length ?? 0)),
            animations: clipsOf(json),
        },
        weight: {
            bytes: file.byteLength,
            budget: budgetOf(file),
            triangles: drawn.triangles,
            uniqueTriangles: held.triangles,
            vertices: drawn.vertices,
            uniqueVertices: held.vertices,
            images: weighed.images,
            pixels: weighed.pixels,
            extent: extent && { min: extent.min, max: extent.max, size: extent.size },
        },
        anomalies,
    };
};

/* ------------------------------------------------------------------------ the scene tree ----- */

/** A mesh, where a node puts it, and how many copies of it that node draws there. */
export interface Placement {
    mesh: number;
    matrix: Mat4;
    copies: number;
}

/**
 * Every mesh the given roots place, with the world matrix it is placed by.
 *
 * A node is visited once and once only. Two parents claiming one child is not a legal scene graph,
 * and a cycle is not one either — but both turn up in files written by hand or by a converter, and
 * a walk that trusted the document would count a subtree twice or never return at all.
 */
export const placementsIn = (json: Gltf, roots: number[]): Placement[] => {
    const placements: Placement[] = [];
    walk(json.nodes ?? [], roots, (node, matrix) => {
        if (typeof node.mesh !== 'number') return;
        placements.push({ mesh: node.mesh, matrix, copies: gpuInstancesOf(json, node) });
    });
    return placements;
};

/**
 * How many copies of its mesh a node draws. One — unless `EXT_mesh_gpu_instancing` gives it a list
 * of placements, in which case the count of that list is the number of times the geometry is paid
 * for, and the number a reader weighing the model needs to see.
 */
const gpuInstancesOf = (json: Gltf, node: GltfNode): number => {
    const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    const first = Object.values(attributes ?? {})[0];
    return json.accessors?.[first ?? -1]?.count ?? 1;
};

const walk = (
    nodes: GltfNode[],
    roots: number[],
    visit?: (node: GltfNode, matrix: Mat4) => void,
): Set<number> => {
    const seen = new Set<number>();
    const stack: { index: number; parent: Mat4 }[] = roots.map(index => ({ index, parent: IDENTITY }));

    while (stack.length > 0) {
        const { index, parent } = stack.pop()!;
        const node = nodes[index];
        if (!node || seen.has(index)) continue;
        seen.add(index);

        const matrix = multiply(parent, localMatrix(node));
        visit?.(node, matrix);
        for (const child of node.children ?? []) stack.push({ index: child, parent: matrix });
    }
    return seen;
};

/* ---------------------------------------------------------------------------- what it costs -- */

interface Cost { triangles: number; vertices: number; nonTriangle: number }

/** What one mesh draws, wherever it is placed. */
export const meshCost = (json: Gltf, mesh: GltfMesh | undefined): Cost => {
    let triangles = 0;
    let vertices = 0;
    let nonTriangle = 0;

    for (const primitive of mesh?.primitives ?? []) {
        const positions = json.accessors?.[primitive.attributes?.POSITION ?? -1]?.count ?? 0;
        const indices = json.accessors?.[primitive.indices ?? -1]?.count;
        // Indexed geometry draws its index count; the rest draws its vertices in the order given.
        const drawn = indices ?? positions;
        vertices += positions;

        switch (primitive.mode ?? MODE_TRIANGLES) {
            case MODE_TRIANGLES: triangles += Math.floor(drawn / 3); break;
            case MODE_TRIANGLE_STRIP:
            case MODE_TRIANGLE_FAN: triangles += Math.max(0, drawn - 2); break;
            default: nonTriangle += 1;
        }
    }
    return { triangles, vertices, nonTriangle };
};

/** What the drawn scene costs: every placement of every mesh, counted where it stands. */
const drawnCost = (json: Gltf, placed: Placement[]): Cost => {
    const costs = new Map<number, Cost>();
    let triangles = 0;
    let vertices = 0;
    let nonTriangle = 0;

    for (const placement of placed) {
        let cost = costs.get(placement.mesh);
        if (!cost) {
            cost = meshCost(json, json.meshes?.[placement.mesh]);
            costs.set(placement.mesh, cost);
            // Counted per mesh rather than per placement: six copies of a line-drawn primitive
            // are one thing worth reporting, not six.
            nonTriangle += cost.nonTriangle;
        }
        triangles += cost.triangles * placement.copies;
        vertices += cost.vertices * placement.copies;
    }
    return { triangles, vertices, nonTriangle };
};

/** What the file holds between its meshes, each counted once wherever it ends up. */
const heldCost = (json: Gltf, meshes: GltfMesh[]): Cost => meshes.reduce((total, mesh) => {
    const cost = meshCost(json, mesh);
    return {
        triangles: total.triangles + cost.triangles,
        vertices: total.vertices + cost.vertices,
        nonTriangle: total.nonTriangle + cost.nonTriangle,
    };
}, { triangles: 0, vertices: 0, nonTriangle: 0 });

/* -------------------------------------------------------------------------- the byte budget -- */

/**
 * Where the file's bytes went.
 *
 * The binary chunk is a flat block that the buffer views cut into ranges, and what a range is
 * *for* is only knowable from what points at it: an image, a mesh's attributes, an animation's
 * keyframes, a skin's bind matrices. Each view is attributed to the first of those that claims
 * it — a range shared between two purposes is rare, and counting it twice would be worse than
 * naming it after one of them.
 *
 * What is left over — padding between ranges, and views nothing points at — falls to `other`,
 * which is why the lines sum to the file rather than to a little less than it.
 */
export const budgetOf = (file: GlbFile): BudgetLine[] => {
    const { json } = file;
    const kinds = new Map<number, BudgetKind>();
    const claim = (view: number | undefined, kind: BudgetKind) => {
        if (typeof view === 'number' && !kinds.has(view)) kinds.set(view, kind);
    };
    const claimAccessor = (index: number | undefined, kind: BudgetKind) => {
        const accessor = json.accessors?.[index ?? -1];
        if (!accessor) return;
        claim(accessor.bufferView, kind);
        claim(accessor.sparse?.indices?.bufferView, kind);
        claim(accessor.sparse?.values?.bufferView, kind);
    };

    for (const image of json.images ?? []) claim(image.bufferView, 'textures');
    for (const mesh of json.meshes ?? []) {
        for (const primitive of mesh.primitives ?? []) {
            // Draco keeps the geometry in a range of its own and leaves the accessors describing
            // it: the counts still read, and this is where the bytes went.
            claim(primitive.extensions?.KHR_draco_mesh_compression?.bufferView, 'geometry');
            claimAccessor(primitive.indices, 'geometry');
            for (const accessor of Object.values(primitive.attributes ?? {})) claimAccessor(accessor, 'geometry');
            for (const target of primitive.targets ?? []) {
                for (const accessor of Object.values(target)) claimAccessor(accessor, 'geometry');
            }
        }
    }
    for (const animation of json.animations ?? []) {
        for (const sampler of animation.samplers ?? []) {
            claimAccessor(sampler.input, 'animation');
            claimAccessor(sampler.output, 'animation');
        }
    }
    for (const skin of json.skins ?? []) claimAccessor(skin.inverseBindMatrices, 'skinning');
    for (const node of json.nodes ?? []) {
        const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes ?? {};
        for (const accessor of Object.values(attributes)) claimAccessor(accessor, 'geometry');
    }

    const bytes = new Map<BudgetKind, number>();
    const add = (kind: BudgetKind, count: number) => bytes.set(kind, (bytes.get(kind) ?? 0) + count);

    let attributed = 0;
    (json.bufferViews ?? []).forEach((view, index) => {
        const stored = storageOf(view);
        // A view into a buffer kept beside the file is not part of this file's weight.
        if (json.buffers?.[stored.buffer]?.uri) return;
        add(kinds.get(index) ?? 'other', stored.byteLength);
        attributed += stored.byteLength;
    });
    add('other', Math.max(0, file.binaryLength - attributed));
    // Everything that is not the binary chunk's payload: the container's headers, and the JSON
    // document itself — which for a file whose images are base64 in a URI is most of it.
    add('structure', Math.max(0, file.byteLength - file.binaryLength));

    const order: BudgetKind[] = ['geometry', 'textures', 'animation', 'skinning', 'structure', 'other'];
    return order
        .map(kind => ({ kind, bytes: bytes.get(kind) ?? 0 }))
        .filter(line => line.bytes > 0);
};

/**
 * Where a range's bytes actually are.
 *
 * Ordinarily that is what the buffer view says. Under `EXT_meshopt_compression` it is not: the
 * view describes the range once decompressed, in a fallback buffer the file does not carry, and
 * the extension holds the offset and the length of what is really there. Read the view and a
 * gltfpack-optimised model claims to weigh several times what it does.
 */
const storageOf = (view: GltfBufferView): { buffer: number; byteLength: number } => {
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (compressed) {
        return { buffer: compressed.buffer ?? 0, byteLength: compressed.byteLength ?? 0 };
    }
    return { buffer: view.buffer ?? 0, byteLength: view.byteLength ?? 0 };
};

/* ------------------------------------------------------------------------------ the images --- */

/** Which images a texture actually reaches — through an extension, where one replaces the source. */
const usedImages = (json: Gltf): Set<number> => {
    const used = new Set<number>();
    for (const texture of json.textures ?? []) {
        if (typeof texture.source === 'number') used.add(texture.source);
        for (const extension of Object.values(texture.extensions ?? {})) {
            if (typeof extension?.source === 'number') used.add(extension.source);
        }
    }
    return used;
};

const weighImages = (file: GlbFile, images: Gltf['images'] = []) => {
    const weighed: ImageWeight[] = images.map((image, index) => {
        const view = file.json.bufferViews?.[image.bufferView ?? -1];
        const offset = view?.byteOffset ?? 0;
        const length = view?.byteLength ?? 0;
        // An image kept outside the file, or pointed at past the end of a truncated one, has no
        // bytes here to read a size from.
        const readable = view !== undefined && !image.uri && offset + length <= file.binary.byteLength;
        const size = readable ? imageSize(file.binary.subarray(offset, offset + length)) : null;
        return {
            name: image.name || image.uri || `image ${index}`,
            mime: image.mimeType ?? '',
            bytes: image.uri ? 0 : length,
            width: size?.width ?? 0,
            height: size?.height ?? 0,
        };
    });

    return {
        images: [...weighed].sort((a, b) => b.bytes - a.bytes),
        pixels: weighed.reduce((total, image) => total + image.width * image.height, 0),
    };
};

/* -------------------------------------------------------------------------------- the rest --- */

const extensionsOf = (json: Gltf): ExtensionUse[] => {
    const required = new Set(json.extensionsRequired ?? []);
    const names = [...new Set([...(json.extensionsUsed ?? []), ...required])].sort();
    return names.map(name => ({ name, required: required.has(name), support: supportOf(name) }));
};

/**
 * Each clip, timed from the last keyframe of its longest channel.
 *
 * The duration is not stated anywhere in a glTF; it is the largest time any sampler's input
 * accessor reaches — and an input accessor, being a scalar, declares its maximum. So a clip's
 * length is readable without one keyframe being decoded.
 */
const clipsOf = (json: Gltf): Clip[] => (json.animations ?? []).map((animation, index) => {
    const ends = (animation.samplers ?? [])
        .map(sampler => json.accessors?.[sampler.input ?? -1]?.max?.[0])
        .filter((end): end is number => typeof end === 'number');
    return {
        name: animation.name || `clip ${index}`,
        channels: animation.channels?.length ?? 0,
        duration: ends.length > 0 ? Math.max(...ends) : 0,
    };
});

const sceneName = (json: Gltf, index: number): string => {
    if (index < 0) return '';
    return json.scenes?.[index]?.name || `scene ${index}`;
};

const externalCount = (json: Gltf): number =>
    (json.buffers ?? []).filter(buffer => buffer.uri).length
    + (json.images ?? []).filter(image => image.uri).length;

const countLodNames = (nodes: GltfNode[], meshes: GltfMesh[]): number =>
    [...nodes, ...meshes].filter(item => LOD_NAME.test(item.name ?? '')).length;

/* ------------------------------------------------------------------------------ the extent --- */

interface MeasuredExtent extends Extent {
    /** Whether every placed mesh declared bounds, or only some of them did. */
    declaredWhole: boolean;
}

/**
 * The box the drawn scene occupies — without a single vertex being read.
 *
 * The specification requires every POSITION accessor to declare its own minimum and maximum, so a
 * primitive's bounds are in the document; the eight corners of that box, put through the world
 * matrix of the node placing it, give the bounds of the mesh where it actually stands. Rotating a
 * box and re-enclosing it can only overstate the result, never understate it, which is the right
 * way round for a measurement a reader is going to trust.
 */
export const extentOf = (json: Gltf, placed: Placement[]): MeasuredExtent | null => {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    let measured = 0;
    let missing = 0;

    for (const placement of placed) {
        for (const primitive of json.meshes?.[placement.mesh]?.primitives ?? []) {
            const positions = json.accessors?.[primitive.attributes?.POSITION ?? -1];
            const low = positions?.min;
            const high = positions?.max;
            if (!low || !high || low.length < 3 || high.length < 3) {
                missing += 1;
                continue;
            }
            for (const corner of corners(low as Vec3, high as Vec3)) {
                const point = transform(placement.matrix, corner);
                for (let axis = 0; axis < 3; axis += 1) {
                    min[axis] = Math.min(min[axis], point[axis]);
                    max[axis] = Math.max(max[axis], point[axis]);
                }
            }
            measured += 1;
        }
    }

    if (measured === 0) return null;
    return {
        min,
        max,
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        declaredWhole: missing === 0,
    };
};

const corners = (min: Vec3, max: Vec3): Vec3[] => {
    const found: Vec3[] = [];
    for (const x of [min[0], max[0]]) {
        for (const y of [min[1], max[1]]) {
            for (const z of [min[2], max[2]]) found.push([x, y, z]);
        }
    }
    return found;
};

/* ------------------------------------------------------------------------------ the matrix --- */

/**
 * Four-by-four, column-major, as glTF writes one — and as three.js does, for the same reason:
 * it is what OpenGL took, and every format since has followed.
 *
 * Written out here rather than borrowed from three.js, so that a report can be built by anything
 * that has the file's bytes, without a renderer's worth of library behind it.
 */
export type Mat4 = readonly number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const multiply = (a: Mat4, b: Mat4): Mat4 => {
    const out = new Array<number>(16);
    for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
            let sum = 0;
            for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
            out[column * 4 + row] = sum;
        }
    }
    return out;
};

const transform = (m: Mat4, p: Vec3): Vec3 => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/** A node states its placement either as a matrix outright or as translation, rotation and scale. */
const localMatrix = (node: GltfNode): Mat4 => {
    if (node.matrix?.length === 16) return node.matrix;

    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale ?? [1, 1, 1];

    // The rotation matrix of a unit quaternion, its columns scaled in place.
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    return [
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        tx, ty, tz, 1,
    ];
};
