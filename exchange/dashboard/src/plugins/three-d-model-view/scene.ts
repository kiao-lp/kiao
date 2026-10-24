/**
 * The three.js stage a `.glb` is shown on: one renderer, one camera, one key light, and the
 * orbit controls the reader turns the model with.
 *
 * It is a plain class rather than a component because none of it is React's business. WebGL state
 * is long-lived, mutable and disposed by hand; expressing a renderer, a scene graph and a sixty-a-
 * second draw loop as renders would fight both libraries at once. `ModelStage.tsx` owns one of
 * these for the life of a document and does nothing but hand it the file's bytes.
 *
 * Two decisions carry most of the comfort:
 *
 *   - **Nothing is a constant in world units.** Every distance comes from `framing.ts`, as a
 *     multiple of the loaded model's own radius, so a model authored in millimetres and one
 *     authored in kilometres both open framed, both dolly usefully and both cast a shadow.
 *   - **Frames are drawn on demand.** A model at rest is a still image; drawing it sixty times a
 *     second would empty a phone's battery to no effect. The loop draws when the camera has moved,
 *     when the stage has been resized, and while an animation is running — and otherwise idles.
 */

import {
    ACESFilmicToneMapping,
    AnimationMixer,
    CanvasTexture,
    Clock,
    DirectionalLight,
    Group,
    Material,
    Mesh,
    PerspectiveCamera,
    PlaneGeometry,
    PMREMGenerator,
    Scene,
    ShadowMaterial,
    SRGBColorSpace,
    Texture,
    PCFSoftShadowMap,
    WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
    boundsOf, frameModel, lightRig, orbitPosition,
    DEFAULT_AZIMUTH, DEFAULT_POLAR, FIELD_OF_VIEW,
    type ModelBounds,
} from './framing';
import { resolveTransparency } from './transparency';

/** Where the camera was left, in a shape that survives a round trip through the view state. */
export interface CameraPose {
    /** The orbit, in radians: `theta` around the model, `phi` down from straight above. */
    theta: number;
    phi: number;
    distance: number;
    /** What the camera is pointed at — the model's centre, until the reader pans away from it. */
    targetX: number;
    targetY: number;
    targetZ: number;
}

/**
 * Retina and better, capped.
 *
 * A phone at a device pixel ratio of 3 asks for nine times the fragments of one at 1, for a
 * difference no eye finds on a shaded surface; 2 is where the returns stop and the frame rate
 * starts being paid for them.
 */
const MAX_PIXEL_RATIO = 2;

/** How dark the shadow pools under the model. Enough to seat it, short of a hole in the floor. */
const SHADOW_OPACITY = 0.32;

/** The shadow map's resolution. 2048 is sharp at a reading distance and cheap enough for a phone. */
const SHADOW_MAP_SIZE = 2048;

/** The environment's contribution, left below 1 so the key light still models the surfaces. */
const ENVIRONMENT_INTENSITY = 0.85;

/**
 * The studio sweep the model stands against, and why it is drawn here rather than in CSS.
 *
 * It looked the same either way and it is not the same at all. A transmissive surface — glass —
 * is see-through in three by sampling the frame already drawn behind it, and behind a transparent
 * canvas there is no frame: the glass samples nothing, comes out with nothing to show and writes
 * itself out as a hole for the page to show through. A decanter arrived as a white silhouette on
 * the light themes and as a cut-out on the dark ones. Drawn into the scene, the sweep is a thing
 * the glass can actually refract, and glass becomes glass.
 *
 * One sweep on every theme, because it is a photographic backdrop and not a surface of the page:
 * what a model needs is something to be lit and shaded against, and a clear glass on a white
 * backdrop is a white shape whatever the CMS around it is doing. It is kept in step with the CSS
 * that shows before the first frame — see `--model3d-sweep-near` and `-far`.
 */
const SWEEP_NEAR = '#34353c';
const SWEEP_FAR = '#101116';

/** Where the sweep is brightest, as a fraction of its height. Above centre, as a sky is. */
const SWEEP_CENTRE = 0.38;

/** Enough for a gradient with no banding in it, and four hundred kilobytes smaller than a photo. */
const SWEEP_SIZE = 512;

const studioSweep = (): CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SWEEP_SIZE;

    const context = canvas.getContext('2d');
    if (context) {
        const centre = [SWEEP_SIZE / 2, SWEEP_SIZE * SWEEP_CENTRE] as const;
        const sweep = context.createRadialGradient(...centre, 0, ...centre, SWEEP_SIZE * 0.78);
        sweep.addColorStop(0, SWEEP_NEAR);
        sweep.addColorStop(1, SWEEP_FAR);
        context.fillStyle = sweep;
        context.fillRect(0, 0, SWEEP_SIZE, SWEEP_SIZE);
    }

    const texture = new CanvasTexture(canvas);
    // A backdrop is a picture, not data: without this it is taken for linear and washes out.
    texture.colorSpace = SRGBColorSpace;
    return texture;
};

export class ModelScene {
    private readonly renderer: WebGLRenderer;
    private readonly scene: Scene;
    private readonly camera: PerspectiveCamera;
    private readonly controls: OrbitControls;
    private readonly key: DirectionalLight;
    private readonly floor: Mesh<PlaneGeometry, ShadowMaterial>;
    private readonly backdrop: CanvasTexture;
    private readonly clock = new Clock();

    private environment: Texture | null = null;
    private model: Group | null = null;
    private bounds: ModelBounds | null = null;
    private mixer: AnimationMixer | null = null;

    private frameHandle = 0;
    private resizeObserver: ResizeObserver | null = null;
    /** Whether the next tick has anything to draw — see the note on the class. */
    private dirty = true;
    private playing = true;
    private disposed = false;
    /** A gesture has ended and the camera is still coasting — see `reportPose`. */
    private settling = false;

    /** Called once the reader lets go of the model, with where they left the camera. */
    onPoseSettled: ((pose: CameraPose) => void) | null = null;

    constructor(private readonly container: HTMLElement) {
        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFSoftShadowMap;
        // glTF materials are authored against a physical response; without tone mapping every
        // highlight on a metal or a gloss clips to flat white.
        this.renderer.toneMapping = ACESFilmicToneMapping;
        this.container.appendChild(this.renderer.domElement);

        this.scene = new Scene();
        this.camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 1000);

        this.backdrop = studioSweep();
        this.scene.background = this.backdrop;

        // A neutral room, generated rather than downloaded: glTF's materials are lit by their
        // surroundings, and under lights alone a metal has nothing to reflect and reads as
        // black plastic. This costs one render at startup and no asset at all.
        const pmrem = new PMREMGenerator(this.renderer);
        this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environment = this.environment;
        this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
        pmrem.dispose();

        // The one shadow-casting light. Its frustum is fitted to the model in `place`.
        this.key = new DirectionalLight(0xffffff, 2.2);
        this.key.castShadow = true;
        this.key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
        this.scene.add(this.key, this.key.target);

        // Invisible except where the shadow lands on it, which is the whole point: the model gets
        // the ground contact that tells the eye where it is standing, without a floor to look at.
        this.floor = new Mesh(
            new PlaneGeometry(1, 1),
            new ShadowMaterial({ opacity: SHADOW_OPACITY, transparent: true }),
        );
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        // Rotate, dolly and pan all carry a little inertia, which is what makes a flick of the
        // thumb read as turning an object rather than as dragging a slider.
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        // Panning across the screen rather than along the ground plane: on a phone the model is
        // being nudged back into frame, and it should follow the finger.
        this.controls.screenSpacePanning = true;
        this.controls.addEventListener('change', this.invalidate);
        // Fired when the drag, the pinch or the wheel stops — the pose is written once per
        // gesture rather than once per frame of one.
        this.controls.addEventListener('end', this.reportPose);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        this.resize();

        this.frameHandle = requestAnimationFrame(this.tick);
    }

    /**
     * Show a model, from bytes already in hand.
     *
     * The stage is given the file rather than sent to fetch it: the view downloads it once and
     * reads its report off the same bytes, so that a file this loader chokes on — compressed
     * geometry, most often — is still a file the reader is told about. See `useModelFile`.
     */
    async show(data: ArrayBuffer): Promise<void> {
        const gltf = await new GLTFLoader().parseAsync(data, '');
        // The document may have been navigated away from while it was being decoded.
        if (this.disposed) {
            disposeTree(gltf.scene);
            return;
        }

        this.clearModel();
        this.model = gltf.scene;
        this.model.traverse(node => {
            if ((node as Mesh).isMesh) {
                node.castShadow = true;
                // Onto itself as much as onto the floor: an unshadowed underside is what makes a
                // model read as a sticker rather than as a solid.
                node.receiveShadow = true;
            }
        });
        // Before the first frame, so that no material is edited after it has been compiled.
        resolveTransparency(this.model);
        this.scene.add(this.model);

        this.bounds = boundsOf(this.model);
        this.place();
        this.frame();

        if (gltf.animations.length) {
            this.mixer = new AnimationMixer(this.model);
            for (const clip of gltf.animations) this.mixer.clipAction(clip).play();
            this.clock.getDelta();
        }

        this.invalidate();
    }

    /** Put the camera back where it opens: the whole model, seen from the front three-quarters. */
    frame(): void {
        if (!this.bounds) return;

        const framing = frameModel(this.bounds, FIELD_OF_VIEW, this.aspect());
        this.camera.near = framing.near;
        this.camera.far = framing.far;
        this.camera.position.copy(
            orbitPosition(framing.target, framing.distance, DEFAULT_AZIMUTH, DEFAULT_POLAR),
        );
        this.camera.updateProjectionMatrix();

        this.controls.target.copy(framing.target);
        this.controls.minDistance = framing.minDistance;
        this.controls.maxDistance = framing.maxDistance;
        this.controls.update();
        this.invalidate();
    }

    /** Where the camera is now — what is worth remembering about this document. */
    pose(): CameraPose {
        return {
            theta: this.controls.getAzimuthalAngle(),
            phi: this.controls.getPolarAngle(),
            distance: this.controls.getDistance(),
            targetX: this.controls.target.x,
            targetY: this.controls.target.y,
            targetZ: this.controls.target.z,
        };
    }

    /** Reopen on the view this document was closed in. */
    applyPose(pose: CameraPose): void {
        if (!this.bounds) return;

        const framing = frameModel(this.bounds, FIELD_OF_VIEW, this.aspect());
        this.camera.near = framing.near;
        this.camera.far = framing.far;
        this.camera.updateProjectionMatrix();

        this.controls.minDistance = framing.minDistance;
        this.controls.maxDistance = framing.maxDistance;
        this.controls.target.set(pose.targetX, pose.targetY, pose.targetZ);
        this.camera.position.copy(
            orbitPosition(this.controls.target, pose.distance, pose.theta, pose.phi),
        );
        this.controls.update();
        this.invalidate();
    }

    /** Run or hold the model's animations, when it has any. */
    setPlaying(playing: boolean): void {
        this.playing = playing;
        // Whatever elapsed while it was held is not animation time; drop it rather than jumping
        // the model forward by it on the next frame.
        this.clock.getDelta();
        this.invalidate();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        cancelAnimationFrame(this.frameHandle);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;

        this.controls.removeEventListener('change', this.invalidate);
        this.controls.removeEventListener('end', this.reportPose);
        this.controls.dispose();

        this.mixer?.stopAllAction();
        this.mixer = null;
        this.clearModel();

        this.floor.geometry.dispose();
        this.floor.material.dispose();
        this.backdrop.dispose();
        this.environment?.dispose();
        this.environment = null;

        this.renderer.dispose();
        // A browser keeps only a handful of WebGL contexts alive and drops the oldest without
        // asking. Browsing a folder of models would otherwise blank the ones still open.
        this.renderer.forceContextLoss();
        this.renderer.domElement.remove();
    }

    private aspect(): number {
        const { clientWidth, clientHeight } = this.container;
        return clientHeight > 0 ? clientWidth / clientHeight : 1;
    }

    /** The key light and the floor, fitted to the model now on the stage. */
    private place(): void {
        if (!this.bounds) return;

        const rig = lightRig(this.bounds);
        this.key.position.copy(rig.keyPosition);
        this.key.target.position.copy(this.bounds.center);
        this.key.target.updateMatrixWorld();

        const shadow = this.key.shadow.camera;
        shadow.left = -rig.shadowExtent;
        shadow.right = rig.shadowExtent;
        shadow.top = rig.shadowExtent;
        shadow.bottom = -rig.shadowExtent;
        shadow.near = rig.shadowNear;
        shadow.far = rig.shadowFar;
        shadow.updateProjectionMatrix();
        this.key.shadow.normalBias = rig.shadowNormalBias;

        this.floor.position.set(this.bounds.center.x, rig.floorY, this.bounds.center.z);
        this.floor.scale.set(rig.floorRadius * 2, rig.floorRadius * 2, 1);
    }

    private clearModel(): void {
        if (!this.model) return;
        this.scene.remove(this.model);
        disposeTree(this.model);
        this.model = null;
    }

    private resize(): void {
        const { clientWidth, clientHeight } = this.container;
        if (clientWidth === 0 || clientHeight === 0) return;

        this.renderer.setSize(clientWidth, clientHeight, false);
        this.camera.aspect = this.aspect();
        this.camera.updateProjectionMatrix();
        this.invalidate();
    }

    private invalidate = (): void => {
        this.dirty = true;
    };

    /**
     * The gesture is over, but the camera is not: damping carries it for a moment after the hand
     * has let go, and it is where it comes to rest that is worth remembering — not where it was
     * released, which for a flick is a good way short of it.
     */
    private reportPose = (): void => {
        this.settling = true;
    };

    private tick = (): void => {
        this.frameHandle = requestAnimationFrame(this.tick);

        const delta = this.clock.getDelta();
        if (this.mixer && this.playing) {
            this.mixer.update(delta);
            this.dirty = true;
        }
        // Returns whether the camera moved, which under damping it keeps doing for a moment
        // after the hand has let go.
        const moved = this.controls.update(delta);
        if (moved) this.dirty = true;
        if (this.settling && !moved) {
            this.settling = false;
            this.onPoseSettled?.(this.pose());
        }
        if (!this.dirty) return;

        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
    };
}

/**
 * Give back everything a subtree holds on the GPU.
 *
 * Dropping the last reference to a mesh does not free its buffers: three hands them to WebGL, and
 * only an explicit `dispose` takes them back. A store of models browsed one after another would
 * otherwise grow by the size of every model visited.
 */
const disposeTree = (root: Group): void => {
    root.traverse(node => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) disposeMaterial(material);
    });
};

const disposeMaterial = (material: Material | undefined): void => {
    if (!material) return;
    // Textures are the expensive half and are reached only through the material that uses them.
    for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose();
    }
    material.dispose();
};
