/** A model file read as bytes: the container the glTF document is packed in, and the pixel size. */


/** The parts of the glTF schema this plugin reads. */
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

    mode?: number;

    targets?: Record<string, number>[];

    extensions?: { KHR_draco_mesh_compression?: { bufferView?: number } };
}

export interface GltfTexture extends GltfNamed {
    source?: number;

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

    min?: number[];
    max?: number[];
    sparse?: { indices?: { bufferView?: number }; values?: { bufferView?: number } };
}

export interface GltfBufferView {
    buffer?: number;
    byteOffset?: number;
    byteLength?: number;

    extensions?: {
        EXT_meshopt_compression?: { buffer?: number; byteOffset?: number; byteLength?: number };
    };
}


/** A model file, split into the document it declares and the bytes that document indexes into. */
export interface GlbFile {
    json: Gltf;

    binary: Uint8Array;

    container: 'binary' | 'json';
    byteLength: number;

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

/** Read a `. glb`. */
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
        offset = start + length;
    }

    if (!json) throw new Error('This binary glTF carries no JSON chunk.');
    return { json, binary, container: 'binary', byteLength: data.byteLength, jsonLength, binaryLength };
};

/** As much of a leading `{` as is worth looking for before a file is declared not to be JSON. */
const JSON_SNIFF_BYTES = 16;

const readJsonDocument = (data: ArrayBuffer): GlbFile => {
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
 * Four formats, because those are the four a glTF may carry: PNG and JPEG from the core spec, WebP.
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

/** JPEG states its size in the frame header, which sits after a run of segments of no fixed length —. */
const jpegSize = (view: DataView): PixelSize | null => {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
        if (view.getUint8(offset) !== 0xff) return null;    // out of step with the chain
        const marker = view.getUint8(offset + 1);
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
            offset += 2;
            continue;
        }
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
            if (view.byteLength < 30) return null;
            return { width: uint24(view, 24) + 1, height: uint24(view, 27) + 1 };
        case VP8_LOSSY:
            if (view.byteLength < 30) return null;
            return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        case VP8_LOSSLESS: {
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
