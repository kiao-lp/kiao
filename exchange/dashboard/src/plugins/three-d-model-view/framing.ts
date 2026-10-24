/**
 * GLB models have no fixed unit: distances scale with the bounding radius so framing,
 * depth precision, shadows and dolly limits work across model sizes.
 */

import { Box3, MathUtils, Object3D, Sphere, Vector3 } from 'three';

export interface ModelBounds {
    center: Vector3;
    radius: number;
    /** Lowest world-space Y, where the shadow falls. */
    floorY: number;
}

export interface Framing {
    target: Vector3;
    distance: number;
    near: number;
    far: number;
    minDistance: number;
    maxDistance: number;
}

export interface LightRig {
    /** World-space key light position. */
    keyPosition: Vector3;
    /** Half-extent of the orthographic shadow camera. */
    shadowExtent: number;
    shadowNear: number;
    shadowFar: number;
    /** World-space normal offset to prevent self-shadowing. */
    shadowNormalBias: number;
    floorY: number;
    floorRadius: number;
}

/** Vertical field of view in degrees. */
export const FIELD_OF_VIEW = 45;

/** Opening spherical angles in radians: three-quarter view, slightly elevated. */
export const DEFAULT_AZIMUTH = Math.PI / 4;
export const DEFAULT_POLAR = Math.PI / 2 - 0.35;

/** Padding leaves room for the model and its shadow. */
const FRAMING_MARGIN = 1.15;

const FALLBACK_RADIUS = 1;

/**
 * A quarter-turn from the camera keeps the shadow visible beside the model.
 * The elevation keeps it in frame without making it disappear beneath the model.
 */
const KEY_LIGHT_DIRECTION = new Vector3(0.71, 1.11, -0.71).normalize();

/** Key light distance in bounding radii. */
const KEY_LIGHT_DISTANCE = 3;

/** Empty or zero-extent models get a unit radius to avoid degenerate framing. */
export const boundsOf = (object: Object3D): ModelBounds => {
    const box = new Box3().setFromObject(object);
    if (box.isEmpty()) {
        return { center: new Vector3(), radius: FALLBACK_RADIUS, floorY: 0 };
    }

    const sphere = box.getBoundingSphere(new Sphere());
    return {
        center: sphere.center.clone(),
        radius: sphere.radius > 0 ? sphere.radius : FALLBACK_RADIUS,
        floorY: box.min.y,
    };
};

/** Fit both fields of view; portrait viewports clip horizontally first. */
export const fitDistance = (radius: number, fovDegrees: number, aspect: number): number => {
    const fovY = MathUtils.degToRad(fovDegrees);
    // A hidden pane may have zero aspect; keep the calculation finite.
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * Math.max(aspect, Number.EPSILON));
    const tightest = Math.min(fovY, fovX);
    return (radius / Math.sin(tightest / 2)) * FRAMING_MARGIN;
};

/** Scale clipping planes with radius to avoid depth fighting or clipping across model sizes. */
export const frameModel = (bounds: ModelBounds, fovDegrees: number, aspect: number): Framing => {
    const { radius } = bounds;
    const distance = fitDistance(radius, fovDegrees, aspect);
    const minDistance = radius * 0.1;
    const maxDistance = radius * 20;
    return {
        target: bounds.center.clone(),
        distance,
        near: radius / 100,
        far: maxDistance + radius * 2,
        minDistance,
        maxDistance,
    };
};

/** Azimuth and polar angles are in radians. */
export const orbitPosition = (
    target: Vector3, distance: number, azimuth: number, polar: number,
): Vector3 => new Vector3()
    .setFromSphericalCoords(distance, polar, azimuth)
    .add(target);

/**
 * Offset the floor below the model to avoid coplanar flicker. Its material is visible only
 * where shadows land, so it can extend well beyond the model without showing an edge.
 */
export const lightRig = (bounds: ModelBounds): LightRig => {
    const { radius, center } = bounds;
    return {
        keyPosition: center.clone().addScaledVector(KEY_LIGHT_DIRECTION, radius * KEY_LIGHT_DISTANCE),
        shadowExtent: radius * 2,
        shadowNear: radius * 0.5,
        shadowFar: radius * 8,
        // Normal bias is in world units and must scale with the model.
        shadowNormalBias: radius * 0.01,
        floorY: bounds.floorY - radius * 0.001,
        floorRadius: radius * 10,
    };
};
