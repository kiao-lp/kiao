/* KHR_materials_transmission needs opaque rendering, even when exporters set BLEND.
 * Blended objects render after glass and are absent from its transmission buffer;
 * promote nearly opaque contents so they appear behind the glass. */

import { Group, Mesh, MeshPhysicalMaterial, type Material } from 'three';

// Correct near-opaque exporter BLEND values while preserving intentional transparency.
const OPAQUE_ENOUGH = 0.95;

/* Preserve base-colour alpha as decal coverage when disabling blending.
 * Patch after map_fragment, where factor and texture have combined but lighting has not.
 * Transmission does not use alpha. */
const BASE_COLOUR_AS_DECAL = `#include <map_fragment>
    diffuseColor.rgb = mix( vec3( 1.0 ), diffuseColor.rgb, diffuseColor.a );
    diffuseColor.a = 1.0;`;

export const materialsOf = (root: Group): Material[] => {
    const found = new Set<Material>();
    root.traverse(node => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        const used = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of used) if (material) found.add(material);
    });
    return [...found];
};

/** Call once before the first frame, before materials compile. */
export const resolveTransparency = (root: Group): void => {
    const materials = materialsOf(root);
    const transmissive = materials.filter(isTransmissive);
    if (transmissive.length === 0) return;

    const glass = new Set<Material>(transmissive);
    for (const material of transmissive) drawAsGlass(material);
    for (const material of materials) if (!glass.has(material)) drawBehindGlass(material);
};

const isTransmissive = (material: Material): material is MeshPhysicalMaterial =>
    (material as MeshPhysicalMaterial).isMeshPhysicalMaterial
    && (material as MeshPhysicalMaterial).transmission > 0;

// Preserve alphaMode MASK: its holes are intentional coverage.
const drawAsGlass = (material: MeshPhysicalMaterial): void => {
    if (!material.transparent) return;

    material.transparent = false;
    material.onBeforeCompile = shader => {
        shader.fragmentShader =
            shader.fragmentShader.replace('#include <map_fragment>', BASE_COLOUR_AS_DECAL);
    };
    // Separate patched and unpatched shaders in Three's program cache.
    material.customProgramCacheKey = () => 'transmission-base-colour-as-decal';
    material.needsUpdate = true;
};

// Opaque contents enter the transmission buffer; blended ones render over the glass.
const drawBehindGlass = (material: Material): void => {
    if (!material.transparent || material.opacity < OPAQUE_ENOUGH) return;
    // A varying alpha map is intentional coverage, regardless of uniform opacity.
    const mapped = material as MeshPhysicalMaterial;
    if (mapped.alphaMap) return;

    material.transparent = false;
    material.opacity = 1;
    material.needsUpdate = true;
};
