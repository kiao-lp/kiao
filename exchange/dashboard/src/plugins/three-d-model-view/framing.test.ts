import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, Object3D, Vector3 } from 'three';
import {
    boundsOf,
    fitDistance,
    frameModel,
    lightRig,
    orbitPosition,
    DEFAULT_AZIMUTH,
    DEFAULT_POLAR,
    FIELD_OF_VIEW,
    type ModelBounds,
} from './framing';

/** A unit-radius model standing on y = 0, the shape every scaled case is compared against. */
const unit: ModelBounds = { center: new Vector3(0, 1, 0), radius: 1, floorY: 0 };

/** Which side of the model something is on, with its height thrown away. */
const groundDirection = (from: Vector3, to: Vector3): Vector3 =>
    from.clone().sub(to).setY(0).normalize();

const scaled = (radius: number): ModelBounds => ({
    center: new Vector3(0, radius, 0),
    radius,
    floorY: 0,
});

describe('boundsOf', () => {
    it('encloses the geometry a model draws', () => {
        const cube = new Mesh(new BoxGeometry(2, 2, 2));
        cube.position.set(5, 1, 0);

        const bounds = boundsOf(cube);
        expect(bounds.center.toArray()).toEqual([5, 1, 0]);
        // The sphere around a 2×2×2 cube, not the box itself.
        expect(bounds.radius).toBeCloseTo(Math.sqrt(3), 5);
        expect(bounds.floorY).toBeCloseTo(0, 5);
    });

    it('follows the transform a model is placed under', () => {
        const group = new Group();
        group.scale.setScalar(10);
        const cube = new Mesh(new BoxGeometry(2, 2, 2));
        group.add(cube);

        expect(boundsOf(group).radius).toBeCloseTo(10 * Math.sqrt(3), 5);
    });

    it('gives a scene with nothing to draw a size anyway', () => {
        // Everything downstream divides by the radius; a file holding only empties and cameras
        // must leave a stage that stands rather than one full of NaN.
        const bounds = boundsOf(new Object3D());
        expect(bounds.radius).toBeGreaterThan(0);
        expect(Number.isFinite(bounds.floorY)).toBe(true);
    });
});

describe('fitDistance', () => {
    it('holds the model within the vertical field of view', () => {
        // A sphere of radius r fits a cone of half-angle a at r / sin(a), plus the framing margin.
        const tight = 1 / Math.sin((FIELD_OF_VIEW / 2) * (Math.PI / 180));
        expect(fitDistance(1, FIELD_OF_VIEW, 1)).toBeGreaterThan(tight);
        expect(fitDistance(1, FIELD_OF_VIEW, 1)).toBeLessThan(tight * 1.5);
    });

    it('stands further back for a viewport taller than it is wide', () => {
        // The phone held upright: framing on the vertical field of view alone would cut the
        // model off at the sides, which is the whole reason this takes an aspect ratio.
        const square = fitDistance(1, FIELD_OF_VIEW, 1);
        const portrait = fitDistance(1, FIELD_OF_VIEW, 0.5);
        expect(portrait).toBeGreaterThan(square);
    });

    it('is the vertical fit once the viewport is wider than it is tall', () => {
        const square = fitDistance(1, FIELD_OF_VIEW, 1);
        expect(fitDistance(1, FIELD_OF_VIEW, 2)).toBeCloseTo(square, 10);
        expect(fitDistance(1, FIELD_OF_VIEW, 16 / 9)).toBeCloseTo(square, 10);
    });

    it('scales with the model', () => {
        expect(fitDistance(1000, FIELD_OF_VIEW, 1)).toBeCloseTo(1000 * fitDistance(1, FIELD_OF_VIEW, 1), 6);
        expect(fitDistance(0.001, FIELD_OF_VIEW, 1)).toBeCloseTo(0.001 * fitDistance(1, FIELD_OF_VIEW, 1), 12);
    });

    it('survives a pane laid out but not yet shown', () => {
        expect(Number.isFinite(fitDistance(1, FIELD_OF_VIEW, 0))).toBe(true);
    });
});

describe('frameModel', () => {
    it('looks at the model', () => {
        expect(frameModel(unit, FIELD_OF_VIEW, 1).target.toArray()).toEqual([0, 1, 0]);
    });

    it('resolves depth across the whole range the reader can dolly through', () => {
        const framing = frameModel(unit, FIELD_OF_VIEW, 1);
        expect(framing.near).toBeGreaterThan(0);
        expect(framing.near).toBeLessThan(framing.minDistance);
        expect(framing.far).toBeGreaterThan(framing.maxDistance + unit.radius);
        expect(framing.minDistance).toBeLessThan(framing.distance);
        expect(framing.maxDistance).toBeGreaterThan(framing.distance);
    });

    it('keeps the same depth precision for a model of any size', () => {
        // The reason nothing here is a constant: 0.1 and 1000 would swallow the millimetre model
        // and clip the kilometre one. The ratio is what the depth buffer actually sees.
        const ratio = (bounds: ModelBounds) => {
            const framing = frameModel(bounds, FIELD_OF_VIEW, 1);
            return framing.far / framing.near;
        };
        expect(ratio(scaled(0.01))).toBeCloseTo(ratio(scaled(4000)), 6);
    });
});

describe('orbitPosition', () => {
    const target = new Vector3(2, 3, 4);

    it('faces the model along +Z at the equator', () => {
        const eye = orbitPosition(target, 10, 0, Math.PI / 2);
        expect(eye.x).toBeCloseTo(2, 6);
        expect(eye.y).toBeCloseTo(3, 6);
        expect(eye.z).toBeCloseTo(14, 6);
    });

    it('looks straight down from the pole', () => {
        const eye = orbitPosition(target, 10, 0, 0);
        expect(eye.x).toBeCloseTo(2, 6);
        expect(eye.y).toBeCloseTo(13, 6);
        expect(eye.z).toBeCloseTo(4, 6);
    });

    it('stays the given distance away, wherever it is put', () => {
        for (const [azimuth, polar] of [[0.3, 0.4], [2.1, 1.9], [-1.2, 3.0]]) {
            expect(orbitPosition(target, 7, azimuth, polar).distanceTo(target)).toBeCloseTo(7, 6);
        }
    });
});

describe('lightRig', () => {
    it('drops the floor just under the model, not through it', () => {
        const rig = lightRig(unit);
        expect(rig.floorY).toBeLessThan(unit.floorY);
        // Far enough not to flicker against a flat base, close enough not to be seen as a gap.
        expect(unit.floorY - rig.floorY).toBeLessThan(unit.radius * 0.01);
    });

    it('holds the whole model inside the shadow camera', () => {
        for (const radius of [0.01, 1, 4000]) {
            const bounds = scaled(radius);
            const rig = lightRig(bounds);
            const lightToCenter = rig.keyPosition.distanceTo(bounds.center);
            // The model spans `radius` either side of its centre along the light's direction.
            expect(rig.shadowNear).toBeLessThan(lightToCenter - radius);
            expect(rig.shadowFar).toBeGreaterThan(lightToCenter + radius);
            expect(rig.shadowExtent).toBeGreaterThanOrEqual(radius);
        }
    });

    it('lights from high enough to keep the shadow on the stage, and low enough to leave one', () => {
        const toLight = lightRig(unit).keyPosition.clone().sub(unit.center).normalize();
        const elevation = Math.asin(toLight.y) * (180 / Math.PI);
        // Below this the shadow streaks off the stage; above it, there is nothing left to see.
        expect(elevation).toBeGreaterThan(35);
        expect(elevation).toBeLessThan(60);
    });

    it('lights from across the opening view, so the model does not stand on its own shadow', () => {
        // The failure this exists for: a light over the camera's shoulder throws the shadow
        // directly behind the model, which then hides all of it, and the stage reads as a thing
        // floating in front of a gradient.
        const toLight = groundDirection(lightRig(unit).keyPosition, unit.center);
        const toEye = groundDirection(
            orbitPosition(unit.center, 10, DEFAULT_AZIMUTH, DEFAULT_POLAR), unit.center,
        );
        expect(toLight.dot(toEye)).toBeLessThanOrEqual(0);
    });

    it('reaches the floor past anything that can be shadowed onto it', () => {
        expect(lightRig(unit).floorRadius).toBeGreaterThan(lightRig(unit).shadowExtent);
    });
});
