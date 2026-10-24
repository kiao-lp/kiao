import {
    forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { ModelScene, type CameraPose } from './scene';
import { messageOf, type ModelFile } from './useModelFile';
import { formatBytes } from './format';

export interface ModelStageHandle {
    /** Put the camera back on the opening view. */
    frame: () => void;
}

interface ModelStageProps {
    /** The file, downloaded once by the view — see `useModelFile`. */
    file: ModelFile;
    /** The view this document was closed in, or `null` to open on the framing view. */
    initialPose: CameraPose | null;
    /** Where the reader left the camera, reported once it has come to rest after a gesture. */
    onPoseChange: (pose: CameraPose) => void;
    /** Whether the model made it onto the stage — false the moment it turns out it will not. */
    onDrawn: (drawn: boolean) => void;
    /** Whether the model's animations are running. Ignored by a model that has none. */
    playing: boolean;
}

type Drawing =
    | { kind: 'pending' }
    | { kind: 'drawn' }
    | { kind: 'failed'; message: string };

/**
 * The model on its stage: a canvas, and the states that are not a model — still arriving, not a
 * model at all, or a model that will not draw.
 *
 * Everything that draws lives in `ModelScene`, which this mounts once the file's bytes are in hand
 * and which it hands nothing else. Two rules are worth stating. A document is a stage: the parent
 * gives this component a `key` of the file path, so opening another model builds a new renderer
 * rather than swapping the contents of the old one, and the pose of the model just left cannot be
 * applied to the one arriving. And the last state is no longer a dead end: a file that will not
 * draw has still been read, and the message says so and points at the report standing beside it.
 */
export const ModelStage = forwardRef<ModelStageHandle, ModelStageProps>((
    { file, initialPose, onPoseChange, onDrawn, playing }, ref,
) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<ModelScene | null>(null);
    const [drawing, setDrawing] = useState<Drawing>({ kind: 'pending' });

    // Read through refs by the effect below, which must build the stage once and not again
    // because a parent re-rendered with a new closure.
    const poseRef = useRef(initialPose);
    const onPoseChangeRef = useRef(onPoseChange);
    onPoseChangeRef.current = onPoseChange;
    const onDrawnRef = useRef(onDrawn);
    onDrawnRef.current = onDrawn;

    const { data } = file;

    useEffect(() => {
        const container = containerRef.current;
        // No bytes yet, or none coming. Until then there is nothing to spend a WebGL context on.
        if (!container || !data) return;

        let scene: ModelScene;
        try {
            scene = new ModelScene(container);
        } catch (error: unknown) {
            // No WebGL context to be had: an old browser, one that has switched it off, or a
            // machine that has run out of them. The stage says so rather than taking the
            // document down with it — and the report is unaffected, having needed none of it.
            setDrawing({ kind: 'failed', message: messageOf(error) });
            onDrawnRef.current(false);
            return;
        }
        sceneRef.current = scene;
        scene.onPoseSettled = pose => onPoseChangeRef.current(pose);

        scene.show(data).then(() => {
            // `show` resolves after a `dispose` that raced it; the stage it would report to is gone.
            if (sceneRef.current !== scene) return;
            // The opening view is framed by `show`; a remembered one replaces it, so a model
            // whose file has changed size still opens framed rather than off-screen.
            if (poseRef.current) scene.applyPose(poseRef.current);
            setDrawing({ kind: 'drawn' });
            onDrawnRef.current(true);
        }).catch((error: unknown) => {
            if (sceneRef.current !== scene) return;
            setDrawing({ kind: 'failed', message: messageOf(error) });
            onDrawnRef.current(false);
        });

        return () => {
            sceneRef.current = null;
            scene.dispose();
        };
    }, [data]);

    useEffect(() => {
        sceneRef.current?.setPlaying(playing);
    }, [playing]);

    useImperativeHandle(ref, () => ({
        frame: () => sceneRef.current?.frame(),
    }), []);

    return (
        <div className="model3d-stage">
            {/* The renderer's canvas is appended here, and sized from it by a ResizeObserver. */}
            <div className="model3d-canvas" ref={containerRef} />
            <Overlay file={file} drawing={drawing} />
        </div>
    );
});

ModelStage.displayName = 'ModelStage';

// Default too, so `index.tsx` can reach it through `lazy()` — see the note there.
export default ModelStage;

/** Whatever is to be said in front of the stage, and nothing at all once the model is standing. */
const Overlay = ({ file, drawing }: { file: ModelFile; drawing: Drawing }) => {
    if (file.progress) {
        return (
            <div className="model3d-overlay" role="status">
                <div className="model3d-message-title"><Arriving {...file.progress} /></div>
            </div>
        );
    }
    if (file.error) return <Failure title="This file could not be read." detail={file.error} />;
    if (drawing.kind === 'pending') {
        // The bytes are in and the loader has them. On a large model this is the second or two the
        // geometry takes to be built, and an empty stage would read as a model that failed.
        return (
            <div className="model3d-overlay" role="status">
                <div className="model3d-message-title">Preparing the model…</div>
            </div>
        );
    }
    if (drawing.kind === 'failed') {
        return (
            <Failure
                title="This model could not be drawn."
                detail={drawing.message}
                // The dead end this used to be: the file was fetched and read, and everything it
                // declares about itself is standing in the inspector beside this message.
                aside={file.report ? 'What it declares about itself is in the inspector.' : ''}
            />
        );
    }
    return null;
};

const Failure = ({ title, detail, aside = '' }: { title: string; detail: string; aside?: string }) => (
    <div className="model3d-overlay" role="status">
        <div className="model3d-message-title">{title}</div>
        <div className="model3d-message-detail">{detail}</div>
        {aside && <div className="model3d-message-detail">{aside}</div>}
    </div>
);

/** A percentage where the server sent a length, and the bytes so far where it did not. */
const Arriving = ({ loaded, total }: { loaded: number; total: number }) => (
    <>
        {total > 0
            ? `Loading model… ${Math.floor((loaded / total) * 100)}%`
            : loaded > 0 ? `Loading model… ${formatBytes(loaded)}` : 'Loading model…'}
    </>
);
