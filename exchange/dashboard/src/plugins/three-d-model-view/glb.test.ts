import { describe, it, expect } from 'vitest';
import { imageSize, readGlb } from './glb';

/* ------------------------------------------------------------------------ building files ---- */

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** Chunks are four-byte aligned, padded with spaces in the JSON chunk and zeroes in the binary. */
const padded = (bytes: Uint8Array, filler: number): Uint8Array => {
    const size = Math.ceil(bytes.length / 4) * 4;
    const out = new Uint8Array(size).fill(filler);
    out.set(bytes);
    return out;
};

interface Chunk { kind: number; bytes: Uint8Array; declaredLength?: number }

/** A binary glTF, built the way the specification says one is. */
const glb = (chunks: Chunk[], version = 2): ArrayBuffer => {
    const total = 12 + chunks.reduce((size, chunk) => size + 8 + chunk.bytes.length, 0);
    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    view.setUint32(0, 0x46546c67, true);    // 'glTF'
    view.setUint32(4, version, true);
    view.setUint32(8, total, true);

    let at = 12;
    for (const chunk of chunks) {
        view.setUint32(at, chunk.declaredLength ?? chunk.bytes.length, true);
        view.setUint32(at + 4, chunk.kind, true);
        bytes.set(chunk.bytes, at + 8);
        at += 8 + chunk.bytes.length;
    }
    return buffer;
};

const jsonChunk = (document: object): Chunk => ({
    kind: JSON_CHUNK,
    bytes: padded(new TextEncoder().encode(JSON.stringify(document)), 0x20),
});

const binChunk = (bytes: Uint8Array): Chunk => ({ kind: BIN_CHUNK, bytes: padded(bytes, 0) });

const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const MINIMAL = { asset: { version: '2.0' } };

/* ---------------------------------------------------------------------------- the container -- */

describe('readGlb', () => {
    it('splits a binary glTF into the document and the bytes it indexes into', () => {
        const file = readGlb(glb([jsonChunk(MINIMAL), binChunk(new Uint8Array([1, 2, 3, 4]))]));

        expect(file.container).toBe('binary');
        expect(file.json.asset?.version).toBe('2.0');
        expect([...file.binary]).toEqual([1, 2, 3, 4]);
        expect(file.binaryLength).toBe(4);
        expect(file.byteLength).toBe(12 + 8 + 28 + 8 + 4);
        // The document, padded to alignment, is what the JSON chunk's length covers.
        expect(file.jsonLength).toBe(28);
    });

    it('reads a file with no binary chunk at all', () => {
        const file = readGlb(glb([jsonChunk(MINIMAL)]));

        expect(file.binary.byteLength).toBe(0);
        expect(file.binaryLength).toBe(0);
    });

    it('steps over a chunk of a type it does not know', () => {
        // The container's own extension point: an unknown chunk is skipped, not stumbled over.
        const unknown: Chunk = { kind: 0x12345678, bytes: new Uint8Array([9, 9, 9, 9]) };
        const file = readGlb(glb([jsonChunk(MINIMAL), unknown, binChunk(new Uint8Array([7]))]));

        expect(file.json.asset?.version).toBe('2.0');
        expect(file.binary[0]).toBe(7);
    });

    it('reads as much of a truncated download as arrived', () => {
        // The header promises a hundred bytes of geometry; forty arrived.
        const chunks = [jsonChunk(MINIMAL), { kind: BIN_CHUNK, bytes: new Uint8Array(40), declaredLength: 100 }];
        const file = readGlb(glb(chunks));

        expect(file.binaryLength).toBe(100);
        expect(file.binary.byteLength).toBe(40);
    });

    it('reads a JSON glTF document saved under a .glb name', () => {
        const text = new TextEncoder().encode(`\n  ${JSON.stringify({ asset: { version: '2.0' }, meshes: [] })}`);
        const file = readGlb(bufferOf(text));

        expect(file.container).toBe('json');
        expect(file.json.meshes).toEqual([]);
        // Nothing in it is binary, so the whole file is its own document.
        expect(file.binaryLength).toBe(0);
        expect(file.jsonLength).toBe(file.byteLength);
    });

    it('refuses a binary glTF of a version it does not know', () => {
        expect(() => readGlb(glb([jsonChunk(MINIMAL)], 1))).toThrow(/version 1/);
    });

    it('refuses a binary glTF with no document in it', () => {
        expect(() => readGlb(glb([binChunk(new Uint8Array([1, 2, 3, 4]))]))).toThrow(/no JSON chunk/);
    });

    it('refuses a file that is not a glTF document at all', () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0, 0, 0, 0]);
        expect(() => readGlb(bufferOf(png))).toThrow(/not a glTF document/);
    });

    it('refuses a document that is JSON but not an object', () => {
        // Guarded on its own, because everything downstream reads properties off it.
        const text = new TextEncoder().encode('{"asset"');
        expect(() => readGlb(bufferOf(text))).toThrow(/not valid JSON/);
    });

    it('refuses a file too short to hold a header', () => {
        expect(() => readGlb(new ArrayBuffer(4))).toThrow(/not a glTF document/);
    });
});

/* --------------------------------------------------------------------------- image headers --- */

const png = (width: number, height: number): Uint8Array => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);    // 'IHDR'
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
};

/** A JPEG with one segment in front of its frame header, so the marker walk has work to do. */
const jpeg = (width: number, height: number): Uint8Array => {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0xffd8);      // start of image
    view.setUint16(2, 0xffe0);      // an APP0 segment of sixteen bytes, contents unread
    view.setUint16(4, 16);
    view.setUint16(20, 0xffc0);     // the baseline frame header
    view.setUint16(22, 11);
    view.setUint8(24, 8);           // sample precision
    view.setUint16(25, height);
    view.setUint16(27, width);
    return bytes;
};

const webp = (fourcc: string, payload: Uint8Array): Uint8Array => {
    const bytes = new Uint8Array(20 + payload.length);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('RIFF'), 0);
    view.setUint32(4, 12 + payload.length, true);
    bytes.set(new TextEncoder().encode('WEBP'), 8);
    bytes.set(new TextEncoder().encode(fourcc), 12);
    view.setUint32(16, payload.length, true);
    bytes.set(payload, 20);
    return bytes;
};

const ktx2 = (width: number, height: number): Uint8Array => {
    const bytes = new Uint8Array(32);
    bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(20, width, true);
    view.setUint32(24, height, true);
    return bytes;
};

describe('imageSize', () => {
    it('reads a PNG header', () => {
        expect(imageSize(png(2048, 1024))).toEqual({ width: 2048, height: 1024 });
    });

    it('walks a JPEG to its frame header', () => {
        expect(imageSize(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    });

    it('reads the three shapes a WebP comes in', () => {
        const lossy = new Uint8Array(10);
        lossy.set([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a]);
        new DataView(lossy.buffer).setUint16(6, 512, true);
        new DataView(lossy.buffer).setUint16(8, 256, true);
        expect(imageSize(webp('VP8 ', lossy))).toEqual({ width: 512, height: 256 });

        const lossless = new Uint8Array(6);
        lossless[0] = 0x2f;
        // Fourteen bits each, both stated one less than they are.
        new DataView(lossless.buffer).setUint32(1, (511) | (255 << 14), true);
        expect(imageSize(webp('VP8L', lossless))).toEqual({ width: 512, height: 256 });

        const extended = new Uint8Array(10);
        const view = new DataView(extended.buffer);
        view.setUint8(4, 511 & 0xff);
        view.setUint8(5, 511 >> 8);
        view.setUint8(7, 255);
        expect(imageSize(webp('VP8X', extended))).toEqual({ width: 512, height: 256 });
    });

    it('reads a KTX2 header — the one a texture this viewer cannot decode arrives in', () => {
        expect(imageSize(ktx2(4096, 4096))).toEqual({ width: 4096, height: 4096 });
    });

    it('says nothing about bytes it does not recognise', () => {
        expect(imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
        expect(imageSize(new Uint8Array(0))).toBeNull();
    });

    it('says nothing about a header cut short', () => {
        expect(imageSize(png(64, 64).subarray(0, 18))).toBeNull();
    });
});
