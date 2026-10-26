import { describe, it, expect } from 'vitest';
import type { GlbFile, Gltf } from './glb';
import { reportOn, type Anomaly, type BudgetKind, type ModelReport } from './report';

/* ---------------------------------------------------------------------------- the fixtures --- */

/**
 * A file as the container reader hands one over — which is the report's whole input. No `.glb` is
 * built here on purpose: the document is what is being reasoned about, and writing it out plainly
 * is what makes each case below readable as the model it stands for.
 */
const fileOf = (json: Gltf, options: {
    binary?: Uint8Array;
    byteLength?: number;
    container?: GlbFile['container'];
} = {}): GlbFile => {
    const binary = options.binary ?? new Uint8Array(0);
    const jsonLength = JSON.stringify(json).length;
    return {
        json,
        binary,
        container: options.container ?? 'binary',
        byteLength: options.byteLength ?? 20 + jsonLength + binary.byteLength,
        jsonLength,
        binaryLength: binary.byteLength,
    };
};

/** One cube, indexed: 24 vertices, 36 indices, and the two ranges holding them. */
const cube = (): Gltf => ({
    asset: { version: '2.0', generator: 'Test exporter 1.0' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ name: 'Cube', mesh: 0 }],
    meshes: [{ name: 'Cube', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
        { count: 24, type: 'VEC3', bufferView: 0, min: [-1, 0, -1], max: [1, 2, 1] },
        { count: 36, type: 'SCALAR', bufferView: 1 },
    ],
    bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 288 },
        { buffer: 0, byteOffset: 288, byteLength: 72 },
    ],
    buffers: [{ byteLength: 360 }],
});

const report = (json: Gltf, options?: Parameters<typeof fileOf>[1]): ModelReport =>
    reportOn(fileOf(json, options));

const finding = (found: ModelReport, kind: string): Anomaly | undefined =>
    found.anomalies.find(anomaly => anomaly.kind === kind);

const kinds = (found: ModelReport): Record<string, number> =>
    Object.fromEntries(found.weight.budget.map(line => [line.kind, line.bytes]));

const png = (width: number, height: number): Uint8Array => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
};

/* ----------------------------------------------------------------------------- what it is ---- */

describe('identity', () => {
    it('reads what the file says about itself', () => {
        const found = report({
            asset: {
                version: '2.0', minVersion: '2.0', generator: 'Blender glTF 4.1', copyright: '© Acme',
            },
        });

        expect(found.identity).toMatchObject({
            version: '2.0', minVersion: '2.0', generator: 'Blender glTF 4.1', copyright: '© Acme',
            container: 'binary',
        });
    });

    it('leaves blank what the file left blank, rather than inventing it', () => {
        expect(report({ asset: { version: '2.0' } }).identity).toMatchObject({
            generator: '', copyright: '', minVersion: '',
        });
    });

    it('points out a JSON document wearing a .glb name', () => {
        const found = report({ asset: { version: '2.0' } }, { container: 'json' });

        expect(found.identity.container).toBe('json');
        expect(finding(found, 'json-container')).toBeDefined();
    });
});

describe('extensions', () => {
    const used = {
        asset: { version: '2.0' },
        extensionsUsed: ['KHR_materials_ior', 'KHR_draco_mesh_compression', 'ACME_secret_sauce'],
        extensionsRequired: ['KHR_draco_mesh_compression'],
    };

    it('says of each what this viewer can do with it', () => {
        expect(report(used).extensions).toEqual([
            { name: 'ACME_secret_sauce', required: false, support: 'ignored' },
            { name: 'KHR_draco_mesh_compression', required: true, support: 'decoder-missing' },
            { name: 'KHR_materials_ior', required: false, support: 'drawn' },
        ]);
    });

    it('explains, in the findings, why a file requiring a decoder will not be drawn', () => {
        const warning = finding(report(used), 'required-extension');

        expect(warning?.level).toBe('warning');
        expect(warning?.text).toMatch(/KHR_draco_mesh_compression.*cannot be drawn/);
    });

    it('is untroubled by an extension merely used and not implemented', () => {
        const found = report({ asset: { version: '2.0' }, extensionsUsed: ['ACME_secret_sauce'] });

        expect(found.extensions[0].support).toBe('ignored');
        expect(finding(found, 'required-extension')).toBeUndefined();
    });
});

/* --------------------------------------------------------------------------- what it holds --- */

describe('inventory', () => {
    it('counts what the file carries', () => {
        const found = report({
            ...cube(),
            materials: [{ name: 'Paint' }, { name: 'Glass' }],
            textures: [{ source: 0 }],
            images: [{ name: 'colour.png' }],
            cameras: [{ type: 'perspective' }],
            skins: [{ joints: [0, 1, 2] }, { joints: [0] }],
        });

        expect(found.inventory).toMatchObject({
            scenes: 1, nodes: 1, meshes: 1, primitives: 1, materials: 2, textures: 1, images: 1,
            cameras: 1, skins: 2, joints: 3, roots: 1,
        });
    });

    it('reports on the scene that is drawn, not on the first one written', () => {
        const found = report({
            ...cube(),
            scene: 1,
            scenes: [{ name: 'Lightbox', nodes: [] }, { name: 'Product', nodes: [0] }],
        });

        expect(found.inventory.drawnScene).toBe(1);
        expect(found.inventory.drawnSceneName).toBe('Product');
        expect(found.weight.triangles).toBe(12);
    });

    it('draws the first scene when the file names none, and says so', () => {
        const { scene, ...noDefault } = cube();
        const found = report(noDefault);

        expect(found.inventory.drawnScene).toBe(0);
        expect(finding(found, 'no-default-scene')).toBeDefined();
    });

    it('falls back to the first scene when the one named does not exist', () => {
        const found = report({ ...cube(), scene: 7 });

        expect(found.inventory.drawnScene).toBe(0);
        expect(found.weight.triangles).toBe(12);
    });

    it('times each clip from the last keyframe its samplers declare', () => {
        const found = report({
            asset: { version: '2.0' },
            animations: [
                {
                    name: 'Walk',
                    channels: [{ sampler: 0 }, { sampler: 1 }],
                    samplers: [{ input: 0, output: 2 }, { input: 1, output: 2 }],
                },
                { channels: [], samplers: [] },
            ],
            accessors: [
                { count: 30, type: 'SCALAR', min: [0], max: [1.25] },
                { count: 12, type: 'SCALAR', min: [0], max: [2.5] },
                { count: 30, type: 'VEC3' },
            ],
        });

        expect(found.inventory.animations).toEqual([
            { name: 'Walk', channels: 2, duration: 2.5 },
            { name: 'clip 1', channels: 0, duration: 0 },
        ]);
    });
});

/* --------------------------------------------------------------------------- what it costs --- */

describe('triangles', () => {
    it('counts an indexed mesh by its indices', () => {
        expect(report(cube()).weight.triangles).toBe(12);
    });

    it('counts a mesh without indices by its vertices', () => {
        const json = cube();
        delete json.meshes![0].primitives![0].indices;

        expect(report(json).weight.triangles).toBe(8);
        expect(report(json).weight.vertices).toBe(24);
    });

    it('counts a strip and a fan as the specification draws them', () => {
        const json = cube();
        json.meshes![0].primitives = [
            { attributes: { POSITION: 0 }, indices: 1, mode: 5 },
            { attributes: { POSITION: 0 }, indices: 1, mode: 6 },
        ];

        expect(report(json).weight.triangles).toBe(34 + 34);
    });

    it('keeps points and lines out of the triangle count, and says they are there', () => {
        const json = cube();
        json.meshes![0].primitives!.push({ attributes: { POSITION: 0 }, mode: 1 });
        const found = report(json);

        expect(found.weight.triangles).toBe(12);
        expect(finding(found, 'non-triangles')?.text).toMatch(/^1 primitive draws points or lines/);
    });

    it('counts a mesh once for every node that draws it', () => {
        const json = cube();
        json.nodes = [
            { mesh: 0, translation: [0, 0, 0] },
            { mesh: 0, translation: [3, 0, 0] },
            { mesh: 0, translation: [6, 0, 0] },
        ];
        json.scenes = [{ nodes: [0, 1, 2] }];
        const found = report(json);

        expect(found.weight.triangles).toBe(36);
        // What the file holds is unchanged by how often it is placed.
        expect(found.weight.uniqueTriangles).toBe(12);
    });

    it('counts the copies a GPU-instanced node draws', () => {
        const json = cube();
        json.nodes = [{
            mesh: 0,
            extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 2 } } },
        }];
        json.accessors!.push({ count: 500, type: 'VEC3' });

        expect(report(json).weight.triangles).toBe(12 * 500);
    });

    it('counts nothing for a mesh no scene places', () => {
        const json = cube();
        json.scenes = [{ nodes: [] }];
        const found = report(json);

        expect(found.weight.triangles).toBe(0);
        expect(found.weight.uniqueTriangles).toBe(12);
    });
});

describe('the byte budget', () => {
    it('accounts for every byte of the file', () => {
        const json = cube();
        json.images = [{ bufferView: 2, mimeType: 'image/png' }];
        json.bufferViews!.push({ buffer: 0, byteOffset: 360, byteLength: 120 });
        const found = report(json, { binary: new Uint8Array(500), byteLength: 900 });

        const total = found.weight.budget.reduce((sum, line) => sum + line.bytes, 0);
        expect(total).toBe(900);
        expect(kinds(found)).toEqual({
            geometry: 288 + 72,
            textures: 120,
            // The twenty bytes of the binary chunk nothing points at, padding included.
            other: 20,
            // Everything that is not the binary chunk: the container's headers and the document.
            structure: 400,
        });
    });

    it('names each range after whatever points at it', () => {
        const found = report({
            asset: { version: '2.0' },
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            animations: [{ channels: [], samplers: [{ input: 1, output: 2 }] }],
            skins: [{ joints: [0], inverseBindMatrices: 3 }],
            images: [{ bufferView: 4 }],
            accessors: [
                { count: 3, bufferView: 0 }, { count: 3, bufferView: 1 },
                { count: 3, bufferView: 2 }, { count: 1, bufferView: 3 },
            ],
            bufferViews: [
                { byteLength: 100 }, { byteLength: 10 }, { byteLength: 30 },
                { byteLength: 64 }, { byteLength: 700 },
            ],
            buffers: [{ byteLength: 904 }],
        }, { binary: new Uint8Array(904), byteLength: 1000 });

        expect(kinds(found)).toMatchObject({
            geometry: 100, animation: 40, skinning: 64, textures: 700,
        });
    });

    it('finds a Draco-compressed range and calls it what it is', () => {
        // The case the inspector matters most for: nothing here can be drawn, and every byte of
        // it can still be accounted for.
        const found = report({
            asset: { version: '2.0' },
            extensionsUsed: ['KHR_draco_mesh_compression'],
            extensionsRequired: ['KHR_draco_mesh_compression'],
            meshes: [{
                primitives: [{
                    attributes: { POSITION: 0 },
                    indices: 1,
                    extensions: { KHR_draco_mesh_compression: { bufferView: 0 } },
                }],
            }],
            // Draco leaves the accessors describing the geometry, without a range of their own.
            accessors: [{ count: 5000, min: [0, 0, 0], max: [1, 1, 1] }, { count: 12000 }],
            bufferViews: [{ byteLength: 400 }],
            buffers: [{ byteLength: 400 }],
        }, { binary: new Uint8Array(400), byteLength: 700 });

        expect(kinds(found)).toEqual({ geometry: 400, structure: 300 });
        expect(found.weight.uniqueTriangles).toBe(4000);
    });

    it('reads a meshopt range where the extension keeps it, not where the view says', () => {
        // The view describes 4 kB of decompressed vertices in a buffer the file does not carry;
        // the 900 bytes actually in the binary chunk are the extension's.
        const found = report({
            asset: { version: '2.0' },
            extensionsUsed: ['EXT_meshopt_compression'],
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            accessors: [{ count: 300, bufferView: 0 }],
            bufferViews: [{
                buffer: 1,
                byteLength: 4096,
                extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 900 } },
            }],
            buffers: [{ byteLength: 900 }, { byteLength: 4096 }],
        }, { binary: new Uint8Array(900), byteLength: 1200 });

        expect(kinds(found)).toEqual({ geometry: 900, structure: 300 });
    });

    it('leaves a buffer kept beside the file out of what this file weighs', () => {
        const json = cube();
        json.buffers = [{ uri: 'geometry.bin', byteLength: 360 }];
        const found = report(json, { binary: new Uint8Array(0), byteLength: 500 });

        expect(kinds(found)).toEqual({ structure: 500 });
        expect(finding(found, 'external-resources')?.level).toBe('warning');
    });
});

describe('the images', () => {
    const binary = new Uint8Array(200);

    it('weighs each image and reads its size out of its own header', () => {
        binary.set(png(2048, 2048), 0);
        binary.set(png(64, 64), 100);

        const found = report({
            asset: { version: '2.0' },
            textures: [{ source: 0 }, { source: 1 }],
            images: [
                { name: 'small.png', mimeType: 'image/png', bufferView: 1 },
                { name: 'colour.png', mimeType: 'image/png', bufferView: 0 },
            ],
            bufferViews: [{ byteOffset: 0, byteLength: 100 }, { byteOffset: 100, byteLength: 24 }],
            buffers: [{ byteLength: 200 }],
        }, { binary, byteLength: 400 });

        // Heaviest first: the answer to "why is this file so large" is usually the first line.
        expect(found.weight.images).toEqual([
            { name: 'colour.png', mime: 'image/png', bytes: 100, width: 2048, height: 2048 },
            { name: 'small.png', mime: 'image/png', bytes: 24, width: 64, height: 64 },
        ]);
        expect(found.weight.pixels).toBe(2048 * 2048 + 64 * 64);
    });

    it('reports an image kept outside the file without pretending to know its size', () => {
        const found = report({
            asset: { version: '2.0' },
            textures: [{ source: 0 }],
            images: [{ uri: 'colour.png', mimeType: 'image/png' }],
        });

        expect(found.weight.images).toEqual([
            { name: 'colour.png', mime: 'image/png', bytes: 0, width: 0, height: 0 },
        ]);
        expect(finding(found, 'external-resources')).toBeDefined();
    });

    it('reads a texture reached through an extension as used', () => {
        const found = report({
            asset: { version: '2.0' },
            textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
            images: [{ name: 'colour.ktx2', bufferView: 0 }],
            bufferViews: [{ byteLength: 10 }],
        });

        expect(finding(found, 'carried-unused')).toBeUndefined();
    });
});

describe('the extent', () => {
    it('measures the box the drawn scene occupies', () => {
        const found = report(cube());

        expect(found.weight.extent?.min).toEqual([-1, 0, -1]);
        expect(found.weight.extent?.size).toEqual([2, 2, 2]);
    });

    it('follows the placement of the node drawing the mesh', () => {
        const json = cube();
        json.nodes = [{ mesh: 0, translation: [10, 0, 0], scale: [2, 2, 2] }];

        expect(report(json).weight.extent).toMatchObject({
            min: [8, 0, -2], max: [12, 4, 2], size: [4, 4, 4],
        });
    });

    it('follows a placement written as one matrix', () => {
        const json = cube();
        // Column-major, as glTF writes one: a scale of two, then a step along x.
        json.nodes = [{ mesh: 0, matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 0, 0, 1] }];

        expect(report(json).weight.extent).toMatchObject({ min: [8, 0, -2], size: [4, 4, 4] });
    });

    it('encloses a rotated model rather than understating it', () => {
        const json = cube();
        json.accessors![0] = { count: 24, min: [-1, -1, -1], max: [1, 1, 1] };
        // A quarter of a right angle about y: the box's corners swing out to the diagonal.
        json.nodes = [{ mesh: 0, rotation: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)] }];

        const size = report(json).weight.extent!.size;
        expect(size[0]).toBeCloseTo(2 * Math.SQRT2, 6);
        expect(size[1]).toBeCloseTo(2, 6);
    });

    it('inherits the transform of every node above it', () => {
        const json = cube();
        json.nodes = [
            { name: 'Rig', scale: [3, 3, 3], children: [1] },
            { name: 'Cube', mesh: 0, translation: [1, 0, 0] },
        ];
        json.scenes = [{ nodes: [0] }];

        expect(report(json).weight.extent).toMatchObject({ min: [0, 0, -3], size: [6, 6, 6] });
    });

    it('says nothing where nothing declares a position', () => {
        const json = cube();
        delete json.accessors![0].min;
        delete json.accessors![0].max;
        const found = report(json);

        expect(found.weight.extent).toBeNull();
        expect(finding(found, 'partial-extent')).toBeUndefined();
    });

    it('warns that a measurement covers only the meshes that declared bounds', () => {
        const json = cube();
        json.meshes!.push({ name: 'Unbounded', primitives: [{ attributes: { POSITION: 2 } }] });
        json.accessors!.push({ count: 3 });
        json.nodes = [{ mesh: 0 }, { mesh: 1 }];
        json.scenes = [{ nodes: [0, 1] }];

        expect(finding(report(json), 'partial-extent')).toBeDefined();
    });

    it('notices a model authored in some other unit than the metre', () => {
        const millimetres = cube();
        millimetres.accessors![0] = { count: 24, min: [0, 0, 0], max: [0.002, 0.004, 0.002] };
        expect(finding(report(millimetres), 'unit-scale')?.text).toMatch(/under a centimetre/);

        const kilometres = cube();
        kilometres.accessors![0] = { count: 24, min: [0, 0, 0], max: [4000, 1200, 4000] };
        expect(finding(report(kilometres), 'unit-scale')?.text).toMatch(/over a kilometre/);
    });
});

/* ------------------------------------------------------------------- what looks worth saying -- */

describe('findings', () => {
    it('says which of several scenes is the one being looked at', () => {
        const json = cube();
        json.scenes = [{ name: 'Product', nodes: [0] }, { name: 'Turntable', nodes: [] }];

        expect(finding(report(json), 'many-scenes')?.text).toMatch(/2 scenes.*Product/);
    });

    it('counts the nodes belonging to no scene at all', () => {
        const json = cube();
        json.nodes = [{ mesh: 0 }, { name: 'Orphan' }, { name: 'Also orphan' }];

        expect(finding(report(json), 'orphan-nodes')?.text).toMatch(/2 of the 3 nodes/);
    });

    it('counts the separate trees a scene is made of', () => {
        const json = cube();
        json.nodes = [{ mesh: 0 }, { name: 'Light' }];
        json.scenes = [{ nodes: [0, 1] }];

        expect(finding(report(json), 'many-roots')?.text).toMatch(/2 separate trees/);
    });

    it('recognises the naming convention of levels of detail', () => {
        const json = cube();
        json.nodes = [{ name: 'Body_LOD0', mesh: 0 }, { name: 'Body_LOD1' }, { name: 'body lod 2' }];
        json.scenes = [{ nodes: [0, 1, 2] }];

        expect(finding(report(json), 'lod-naming')?.text).toMatch(/3 nodes or meshes are named/);
    });

    it('leaves an ordinary name out of it', () => {
        const json = cube();
        json.nodes = [{ name: 'Reload3', mesh: 0 }];

        expect(finding(report(json), 'lod-naming')).toBeUndefined();
    });

    it('points at weight that is carried and never drawn', () => {
        const json = cube();
        json.meshes!.push({ name: 'Spare', primitives: [] });
        json.images = [{ name: 'unused.png', bufferView: 0 }];

        expect(finding(report(json), 'carried-unused')?.text).toBe('1 mesh and 1 image are carried but never drawn.');
    });

    it('says outright when there is nothing to draw', () => {
        const found = report({ asset: { version: '2.0' }, scenes: [{ nodes: [] }] });

        expect(finding(found, 'no-geometry')?.level).toBe('warning');
    });

    it('has nothing to say about a plain, whole, single-scene model', () => {
        expect(report(cube()).anomalies).toEqual([]);
    });
});

describe('a document that cannot be trusted', () => {
    it('reports on a file whose every index points nowhere', () => {
        const found = report({
            asset: { version: '2.0' },
            scene: 0,
            scenes: [{ nodes: [3] }],
            nodes: [{ mesh: 9 }],
            meshes: [{ primitives: [{ attributes: { POSITION: 12 }, indices: 40 }] }],
            images: [{ bufferView: 8 }],
            animations: [{ channels: [{ sampler: 2 }], samplers: [{ input: 6, output: 7 }] }],
        });

        expect(found.weight.triangles).toBe(0);
        expect(found.weight.extent).toBeNull();
        expect(found.inventory.animations[0].duration).toBe(0);
    });

    it('walks a node graph that loops back on itself, once', () => {
        const json = cube();
        json.nodes = [{ mesh: 0, children: [1] }, { mesh: 0, children: [0] }];
        json.scenes = [{ nodes: [0] }];

        // Both nodes are visited, neither twice — a cycle is a broken file, not a hung tab.
        expect(report(json).weight.triangles).toBe(24);
    });

    it('reports on a document holding nothing at all', () => {
        const found = report({});

        expect(found.identity.version).toBe('');
        expect(found.inventory.scenes).toBe(0);
        expect(found.weight.triangles).toBe(0);
        expect(finding(found, 'no-geometry')).toBeDefined();
    });
});
