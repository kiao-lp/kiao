import {
    forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { ModelScene, type CameraPose } from './scene';
import { messageOf, type ModelFile } from './useModelFile';
import { formatBytes } from './format';

export interface ModelStageHandle {

    frame: () => void;
}

interface ModelStageProps {

    file: ModelFile;

    initialPose: CameraPose | null;

    onPoseChange: (pose: CameraPose) => void;

    onDrawn: (drawn: boolean) => void;

    playing: boolean;
}

type Drawing =
    | { kind: 'pending' }
    | { kind: 'drawn' }
    | { kind: 'failed'; message: string };

/** The model on its stage: a canvas, and the states that are not a model — still arriving, not a model. */
export const ModelStage = forwardRef<ModelStageHandle, ModelStageProps>((
    { file, initialPose, onPoseChange, onDrawn, playing }, ref,
) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<ModelScene | null>(null);
    const [drawing, setDrawing] = useState<Drawing>({ kind: 'pending' });

    // Read through refs by the effect below, which must build the stage once and not again because a parent re-rendered with a new.
    const poseRef = useRef(initialPose);
    const onPoseChangeRef = useRef(onPoseChange);
    onPoseChangeRef.current = onPoseChange;
    const onDrawnRef = useRef(onDrawn);
    onDrawnRef.current = onDrawn;

    const { data } = file;

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !data) return;

        let scene: ModelScene;
        try {
            scene = new ModelScene(container);
        } catch (error: unknown) {
            setDrawing({ kind: 'failed', message: messageOf(error) });
            onDrawnRef.current(false);
            return;
        }
        sceneRef.current = scene;
        scene.onPoseSettled = pose => onPoseChangeRef.current(pose);

        scene.show(data).then(() => {
            // `show` resolves after a `dispose` that raced it; the stage it would report to is gone.
            if (sceneRef.current !== scene) return;
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
            { }
            <div className="model3d-canvas" ref={containerRef} />
            <Overlay file={file} drawing={drawing} />
        </div>
    );
});

ModelStage.displayName = 'ModelStage';

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
