/**
 * A model file read as bytes: the container the glTF document is packed in, and the pixel size an
 * image writes into its own first bytes.
 *
 * Nothing here decodes anything, which is the point. A binary glTF is a twelve-byte header and a
 * run of chunks, the first of which is the JSON document describing everything the file holds and
 * the second the block of bytes that document indexes into. Splitting the two is a matter of
 * reading a few lengths — and it is what lets the inspector report on a file no loader on this
 * machine could draw: a Draco-compressed mesh is unreadable geometry inside a perfectly readable
 * document.
 *
 * The image headers are the same bargain at a smaller scale. glTF declares an image's mime type
 * and how many bytes it occupies, but never its dimensions — and dimensions are what a texture
 * actually costs, since a GPU pays for pixels rather than for the compression they arrived in. So
 * they are read out of the first bytes of the PNG, JPEG, WebP or KTX2 itself, each of which
 * writes them near its start for exactly this reason.
 */

/* ------------------------------------------------------------------ the glTF document ------- */

/**
 * The parts of the glTF schema this plugin reads.
 *
 * Everything is optional and nothing is trusted: this is a file from the store, and a report that
 * throws on a malformed document is a report that is missing where it is most wanted. Fields the
 * inspector does not speak about are left out rather than typed as `unknown`.
 */
export interface Gltf {
    asset?: { version?: string; minVersion?: string; generator?: string; copyright?: string };
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    scene?: number;
    scenes?: GltfScene[];
    nodes?: GltfNode[];
    meshes?: GltfMesh[];
    materials?: GltfNamed[];
    textures?: GltfTexture[];
    images?: GltfImage[];
    samplers?: unknown[];
    animations?: GltfAnimation[];
    skins?: GltfSkin[];
    cameras?: GltfCamera[];
    accessors?: GltfAccessor[];
    bufferViews?: GltfBufferView[];
    buffers?: { uri?: string; byteLength?: number }[];
}

export interface GltfNamed { name?: string }
export interface GltfScene extends GltfNamed { nodes?: number[] }

export interface GltfNode extends GltfNamed {
    children?: number[];
    mesh?: number;
    camera?: number;
    skin?: number;
    /** A node states its placement either as one matrix or as the three parts of one, never both. */
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    extensions?: { EXT_mesh_gpu_instancing?: { attributes?: Record<string, number> } };
}

export interface GltfMesh extends GltfNamed { primitives?: GltfPrimitive[] }

export interface GltfPrimitive {
    attributes?: Record<string, number>;
    indices?: number;
    material?: number;
    /** 4 — triangles — when the file says nothing. */
    mode?: number;
    /** Morph targets: another set of attribute accessors per target. */
    targets?: Record<string, number>[];
    /** Compressed geometry: the accessors keep their counts, the bytes move here. */
    extensions?: { KHR_draco_mesh_compression?: { bufferView?: number } };
}

export interface GltfTexture extends GltfNamed {
    source?: number;
    /** `KHR_texture_basisu`, `EXT_texture_webp` and friends point at their own image. */
    extensions?: Record<string, { source?: number }>;
}

export interface GltfImage extends GltfNamed {
    uri?: string;
    mimeType?: string;
    bufferView?: number;
}

export interface GltfAnimation extends GltfNamed {
    channels?: { sampler?: number; target?: { node?: number; path?: string } }[];
    samplers?: { input?: number; output?: number; interpolation?: string }[];
}

export interface GltfSkin extends GltfNamed { joints?: number[]; inverseBindMatrices?: number }
export interface GltfCamera extends GltfNamed { type?: string }

export interface GltfAccessor {
    bufferView?: number;
    count?: number;
    type?: string;
    componentType?: number;
    /** Declared for every POSITION accessor by the spec — which is what makes a bounding box readable. */
    min?: number[];
    max?: number[];
    sparse?: { indices?: { bufferView?: number }; values?: { bufferView?: number } };
}

export interface GltfBufferView {
    buffer?: number;
    byteOffset?: number;
    byteLength?: number;
    /**
     * A meshopt-compressed range is not where its view says it is: the view describes the
     * *decompressed* bytes, in a fallback buffer that the file does not carry, and the extension
     * says where the compressed ones actually are. See `budgetOf`.
     */
    extensions?: {
        EXT_meshopt_compression?: { buffer?: number; byteOffset?: number; byteLength?: number };
    };
}

/* --------------------------------------------------------------------- the container --------- */

/** A model file, split into the document it declares and the bytes that document indexes into. */
export interface GlbFile {
    json: Gltf;
    /** The binary chunk. Empty for a document that keeps its data elsewhere. */
    binary: Uint8Array;
    /** How the document arrived — see the note on `readGlb` about the second case. */
    container: 'binary' | 'json';
    /** The whole file. */
    byteLength: number;
    /** The JSON chunk's payload, and the binary chunk's, as the header declares them. */
    jsonLength: number;
    binaryLength: number;
}

/** `glTF`, `JSON` and `BIN\0`, as the little-endian words the header writes them as. */
const MAGIC_GLTF = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

const EMPTY = new Uint8Array(0);

/**
 * Read a `.glb`.
 *
 * The second case is a file named `.glb` that is really a `.gltf` — a JSON document, exported or
 * renamed under the wrong extension. three.js's loader accepts one, so the stage would draw it and
 * a reader who never opened the inspector would never know; the report says which of the two it
 * got, and the anomalies say what such a file leaves outside itself.
 *
 * Throws where there is no document to be had at all: that message is the one the reader sees in
 * place of the model, so it says what the file turned out to be rather than where a parser gave up.
 */
export const readGlb = (data: ArrayBuffer): GlbFile => {
    if (data.byteLength >= HEADER_BYTES && new DataView(data).getUint32(0, true) === MAGIC_GLTF) {
        return readBinaryContainer(data);
    }
    return readJsonDocument(data);
};

const readBinaryContainer = (data: ArrayBuffer): GlbFile => {
    const view = new DataView(data);
    const version = view.getUint32(4, true);
    if (version !== 2) {
        throw new Error(`This is a binary glTF of version ${version}; only version 2 is defined.`);
    }

    let json: Gltf | null = null;
    let binary = EMPTY;
    let jsonLength = 0;
    let binaryLength = 0;

    // The header's total length is not read: a download cut short states the length it *meant* to
    // have, and every chunk is clamped to the bytes actually in hand instead — a truncated file
    // still reports on the part of itself that arrived.
    let offset = HEADER_BYTES;
    while (offset + CHUNK_HEADER_BYTES <= data.byteLength) {
        const length = view.getUint32(offset, true);
        const kind = view.getUint32(offset + 4, true);
        const start = offset + CHUNK_HEADER_BYTES;
        const end = Math.min(start + length, data.byteLength);

        if (kind === CHUNK_JSON && !json) {
            jsonLength = length;
            json = parseDocument(new Uint8Array(data, start, end - start));
        } else if (kind === CHUNK_BIN && binaryLength === 0) {
            binaryLength = length;
            binary = new Uint8Array(data, start, end - start);
        }
        // A chunk of any other type is the container's own extension point, and skipping it is
        // what the spec asks of a reader that does not know it.
        offset = start + length;
    }

    if (!json) throw new Error('This binary glTF carries no JSON chunk.');
    return { json, binary, container: 'binary', byteLength: data.byteLength, jsonLength, binaryLength };
};

/** As much of a leading `{` as is worth looking for before a file is declared not to be JSON. */
const JSON_SNIFF_BYTES = 16;

const readJsonDocument = (data: ArrayBuffer): GlbFile => {
    // Sniffed before it is decoded: a hundred megabytes of something else should not be turned
    // into a string on the way to finding out that it is not a document.
    const head = new Uint8Array(data, 0, Math.min(JSON_SNIFF_BYTES, data.byteLength));
    const first = [...head].find(byte => byte > 0x20);
    if (first !== 0x7b) {
        throw new Error('This file is not a glTF document: it begins neither with the binary glTF signature nor with JSON.');
    }

    const json = parseDocument(new Uint8Array(data));
    return {
        json,
        binary: EMPTY,
        container: 'json',
        byteLength: data.byteLength,
        // The whole file is its document. Nothing here is binary, so nothing is unaccounted for.
        jsonLength: data.byteLength,
        binaryLength: 0,
    };
};

const parseDocument = (bytes: Uint8Array): Gltf => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error('The glTF document in this file is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The glTF document in this file is not an object.');
    }
    return parsed as Gltf;
};

/* ------------------------------------------------------------------- image dimensions -------- */

/** What an image measures, in pixels. */
export interface PixelSize { width: number; height: number }

/**
 * The dimensions an image declares in its own header, or `null` for bytes no reader here knows.
 *
 * Four formats, because those are the four a glTF may carry: PNG and JPEG from the core spec,
 * WebP and KTX2 from the two texture extensions in common use. An unknown one — AVIF, whose size
 * is buried several boxes deep — reports its weight and its type without its dimensions, which is
 * a gap in one line of the report rather than a reason not to draw the rest of it.
 */
export const imageSize = (bytes: Uint8Array): PixelSize | null => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return pngSize(view) ?? jpegSize(view) ?? webpSize(view) ?? ktx2Size(view);
};

const startsWith = (view: DataView, signature: number[]): boolean => {
    if (view.byteLength < signature.length) return false;
    return signature.every((byte, index) => view.getUint8(index) === byte);
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG puts its `IHDR` first, by mandate: two big-endian words at a fixed offset. */
const pngSize = (view: DataView): PixelSize | null => {
    if (!startsWith(view, PNG_SIGNATURE) || view.byteLength < 24) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
};

/**
 * JPEG states its size in the frame header, which sits after a run of segments of no fixed length
 * — so the marker chain is walked until one of the `SOF` markers turns up.
 */
const jpegSize = (view: DataView): PixelSize | null => {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
        if (view.getUint8(offset) !== 0xff) return null;    // out of step with the chain
        const marker = view.getUint8(offset + 1);
        // A run of `ff` fill bytes may precede a marker; the marker is the byte after the last.
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        // Restarts, and the ends of the image, carry no length of their own.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
            offset += 2;
            continue;
        }
        // C0 to CF are the frame headers, less the three that are tables rather than frames.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            if (offset + 9 > view.byteLength) return null;
            return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        const length = view.getUint16(offset + 2);
        if (length < 2) return null;
        offset += 2 + length;
    }
    return null;
};

const RIFF = 0x52494646;
const WEBP = 0x57454250;
const VP8_LOSSY = 0x56503820;
const VP8_LOSSLESS = 0x5650384c;
const VP8_EXTENDED = 0x56503858;

/** WebP is three formats under one signature, and each writes its size somewhere else. */
const webpSize = (view: DataView): PixelSize | null => {
    if (view.byteLength < 21 || view.getUint32(0) !== RIFF || view.getUint32(8) !== WEBP) return null;

    switch (view.getUint32(12)) {
        case VP8_EXTENDED:
            // The canvas size, less one, as two twenty-four-bit little-endian counts.
            if (view.byteLength < 30) return null;
            return { width: uint24(view, 24) + 1, height: uint24(view, 27) + 1 };
        case VP8_LOSSY:
            // Past the frame tag and the three-byte start code: fourteen bits each.
            if (view.byteLength < 30) return null;
            return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        case VP8_LOSSLESS: {
            // One signature byte, then twenty-eight bits holding both sizes, each less one.
            const bits = view.getUint32(21, true);
            return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        }
        default:
            return null;
    }
};

const uint24 = (view: DataView, offset: number): number =>
    view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);

const KTX2_SIGNATURE = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** KTX2 — the container a Basis-compressed texture arrives in — declares its size in its header. */
const ktx2Size = (view: DataView): PixelSize | null => {
    if (!startsWith(view, KTX2_SIGNATURE) || view.byteLength < 28) return null;
    return { width: view.getUint32(20, true), height: view.getUint32(24, true) };
};
