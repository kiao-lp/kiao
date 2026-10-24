import { describe, it, expect } from 'vitest';
import {
    BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Texture,
} from 'three';
import { materialsOf, resolveTransparency } from './transparency';

/** A `.glb` material as three's loader leaves it: what the file declared, and nothing more. */
const glass = (over: Partial<MeshPhysicalMaterial> = {}): MeshPhysicalMaterial =>
    Object.assign(new MeshPhysicalMaterial({ transmission: 1, transparent: true, opacity: 1 }), over);

const blended = (opacity: number): MeshStandardMaterial =>
    new MeshStandardMaterial({ transparent: true, opacity });

const modelOf = (...materials: (MeshPhysicalMaterial | MeshStandardMaterial)[]): Group => {
    const root = new Group();
    for (const material of materials) root.add(new Mesh(new BoxGeometry(), material));
    return root;
};

/** three's fragment shader, reduced to the one line the patch is written against. */
const shaderOf = (material: MeshPhysicalMaterial) => {
    const shader = { fragmentShader: 'void main() {\n#include <map_fragment>\n}' };
    material.onBeforeCompile(shader as never, null as never);
    return shader.fragmentShader;
};

describe('materialsOf', () => {
    it('finds each material once, however many meshes draw with it', () => {
        const shared = new MeshStandardMaterial();
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(), shared), new Mesh(new BoxGeometry(), shared));

        expect(materialsOf(root)).toEqual([shared]);
    });

    it('finds the materials of a mesh under a plain node', () => {
        const material = new MeshStandardMaterial();
        const root = new Group();
        const empty = new Object3D();
        empty.add(new Mesh(new BoxGeometry(), material));
        root.add(empty);

        expect(materialsOf(root)).toEqual([material]);
    });

    it('finds every material of a mesh that carries several', () => {
        const front = new MeshStandardMaterial();
        const back = new MeshStandardMaterial();
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(), [front, back]));

        expect(materialsOf(root)).toEqual([front, back]);
    });
});

describe('resolveTransparency', () => {
    it('draws a transmissive material as an opaque one', () => {
        const bottle = glass();
        resolveTransparency(modelOf(bottle));

        expect(bottle.transparent).toBe(false);
        // The transmission is what makes it see-through, and it is untouched.
        expect(bottle.transmission).toBe(1);
    });

    it('moves the base colour alpha from coverage to colour', () => {
        const bottle = glass();
        resolveTransparency(modelOf(bottle));

        const fragment = shaderOf(bottle);
        expect(fragment).toContain('#include <map_fragment>');
        expect(fragment).toContain('diffuseColor.rgb = mix( vec3( 1.0 ), diffuseColor.rgb, diffuseColor.a );');
        expect(fragment).toContain('diffuseColor.a = 1.0;');
    });

    it('keeps the patched material off the program a plain one compiled', () => {
        const bottle = glass();
        resolveTransparency(modelOf(bottle));

        expect(bottle.customProgramCacheKey()).not.toBe(new MeshPhysicalMaterial().customProgramCacheKey());
    });

    it('leaves a transmissive material that cuts holes in itself alone', () => {
        // `alphaMode: MASK`, as three's loader leaves it: coverage in earnest, not a blend.
        const screen = glass({ transparent: false, alphaTest: 0.5 });
        resolveTransparency(modelOf(screen));

        expect(screen.alphaTest).toBe(0.5);
        expect(screen.onBeforeCompile).toBe(new MeshPhysicalMaterial().onBeforeCompile);
    });

    it('draws what is nearly opaque as opaque, so that it lands behind the glass', () => {
        const liquid = blended(0.969);
        resolveTransparency(modelOf(glass(), liquid));

        expect(liquid.transparent).toBe(false);
        expect(liquid.opacity).toBe(1);
    });

    it('leaves a material that means to be seen through alone', () => {
        const shell = blended(0.04);
        resolveTransparency(modelOf(glass(), shell));

        expect(shell.transparent).toBe(true);
        expect(shell.opacity).toBe(0.04);
    });

    it('leaves a material alone whose alpha varies across its surface', () => {
        const leaves = blended(1);
        leaves.alphaMap = new Texture();
        resolveTransparency(modelOf(glass(), leaves));

        expect(leaves.transparent).toBe(true);
    });

    it('touches nothing in a model with no glass in it', () => {
        const smoke = blended(0.99);
        resolveTransparency(modelOf(smoke, new MeshStandardMaterial()));

        // No transmission pass exists to be on the wrong side of, so the blend is honoured.
        expect(smoke.transparent).toBe(true);
        expect(smoke.opacity).toBe(0.99);
    });
});
