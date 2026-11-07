/** The three. js stage a `. */

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

    theta: number;
    phi: number;
    distance: number;

    targetX: number;
    targetY: number;
    targetZ: number;
}

/** Retina and better, capped. */
const MAX_PIXEL_RATIO = 2;

/** How dark the shadow pools under the model. */
const SHADOW_OPACITY = 0.32;

/** The shadow map's resolution. 2048 is sharp at a reading distance and cheap enough for a phone. */
const SHADOW_MAP_SIZE = 2048;

/** The environment's contribution, left below 1 so the key light still models the surfaces. */
const ENVIRONMENT_INTENSITY = 0.85;

/** The studio sweep the model stands against, and why it is drawn here rather than in CSS. */
const SWEEP_NEAR = '#34353c';
const SWEEP_FAR = '#101116';

/** Where the sweep is brightest, as a fraction of its height. */
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

    private dirty = true;
    private playing = true;
    private disposed = false;

    private settling = false;


    onPoseSettled: ((pose: CameraPose) => void) | null = null;

    constructor(private readonly container: HTMLElement) {
        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFSoftShadowMap;
        // glTF materials are authored against a physical response; without tone mapping every
        this.renderer.toneMapping = ACESFilmicToneMapping;
        this.container.appendChild(this.renderer.domElement);

        this.scene = new Scene();
        this.camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 1000);

        this.backdrop = studioSweep();
        this.scene.background = this.backdrop;

        const pmrem = new PMREMGenerator(this.renderer);
        this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environment = this.environment;
        this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
        pmrem.dispose();

        this.key = new DirectionalLight(0xffffff, 2.2);
        this.key.castShadow = true;
        this.key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
        this.scene.add(this.key, this.key.target);

        // the ground contact that tells the eye where it is standing, without a floor to look at.
        this.floor = new Mesh(
            new PlaneGeometry(1, 1),
            new ShadowMaterial({ opacity: SHADOW_OPACITY, transparent: true }),
        );
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.screenSpacePanning = true;
        this.controls.addEventListener('change', this.invalidate);
        this.controls.addEventListener('end', this.reportPose);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        this.resize();

        this.frameHandle = requestAnimationFrame(this.tick);
    }


    async show(data: ArrayBuffer): Promise<void> {
        const gltf = await new GLTFLoader().parseAsync(data, '');
        if (this.disposed) {
            disposeTree(gltf.scene);
            return;
        }

        this.clearModel();
        this.model = gltf.scene;
        this.model.traverse(node => {
            if ((node as Mesh).isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
            }
        });
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


    setPlaying(playing: boolean): void {
        this.playing = playing;
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
        // A browser keeps only a handful of WebGL contexts alive and drops the oldest without asking.
        this.renderer.forceContextLoss();
        this.renderer.domElement.remove();
    }

    private aspect(): number {
        const { clientWidth, clientHeight } = this.container;
        return clientHeight > 0 ? clientWidth / clientHeight : 1;
    }


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
 * Dropping the last reference to a mesh does not free its buffers: three hands them to WebGL,.
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
