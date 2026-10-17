import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Flex } from 'antd';
import {
    AimOutlined, CaretRightOutlined, FileSearchOutlined, PauseOutlined,
} from '@ant-design/icons';
import {
    FileDto,
    CmsPlugin,
    useFileBrowsingPersistenceContext,
    useAuthToken,
    useFileViewState,
    MainViewCmp,
    FileLabelCmp,
    extractName,
    LayoutContent,
    TopBanner,
    Tooltip,
} from '@cms-core';
import type { ModelStageHandle } from './ModelStage';
import type { CameraPose } from './scene';
import { useModelFile } from './useModelFile';

import './three-d-model-view.css';
import iconImg from './model-icon.svg';

/**
 * three.js and its glTF loader are some seven hundred kilobytes, and the CMS opens on a file
 * browser. Reached through `lazy`, they are a chunk fetched the first time a model is opened
 * rather than weight on every page load — which is the difference between the two on the phone
 * this plugin is half written for. The stylesheet stays in the entry chunk: it is a page long,
 * and it is what dresses the placeholder below while the chunk is on its way.
 *
 * The inspector's panel is split off for the same reason and on smaller terms: it is asked for
 * rather than opened with, so it is fetched when it is asked for. What reads the file — the
 * download and the report — stays here, because it must run whether or not either chunk arrives.
 */
const ModelStage = lazy(() => import('./ModelStage'));
const ReportPanel = lazy(() => import('./ReportPanel'));

// Supported extensions for this feature. `.gltf` is deliberately left out: it is a JSON manifest
// that points at its geometry and its textures as sibling files, and each of those is another
// authenticated request into the store — a different plugin, not a longer list here. A `.glb`
// holds all of it in the one file.
const supportedExtensions = ['.glb'];

/**
 * The remembered view, flattened to numbers because a view state scope is merged key by key.
 * A `distance` of zero is the document that has never been posed — open it framed.
 */
const UNPOSED = { theta: 0, phi: 0, distance: 0, targetX: 0, targetY: 0, targetZ: 0 };

/** Angles and distances are written on every gesture; a rounded one settles instead of drifting. */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const token = useAuthToken();
    const path = currentFile?.path ?? '';

    React.useEffect(() => {
        if (currentFile) document.title = extractName(currentFile.path) || '3D model';
    }, [currentFile]);

    // Where this model was left standing, and whether it was left open on its report.
    const [view, setView] = useFileViewState('model3d', {
        ...UNPOSED, playing: true, inspecting: false,
    });

    // The one fetch. The stage draws from these bytes and the inspector reports on them, so a file
    // that will not draw is still a file that has been read.
    const file = useModelFile(path, token);

    // Carries the path it was read for: navigating between two models does not remount this view,
    // and the outgoing model's animations must not put a play button on a still one.
    const [drawn, setDrawn] = useState({ path: '', ok: false });
    const onDrawn = useCallback((ok: boolean) => setDrawn({ path, ok }), [path]);
    const standing = drawn.path === path && drawn.ok;
    const clipCount = standing ? file.report?.inventory.animations.length ?? 0 : 0;

    // The unopenable model's way out. There is nothing to look at and something to read, so the
    // document opens on its report instead; closing it holds until the file is opened afresh.
    useEffect(() => {
        if (drawn.path === path && !drawn.ok && file.report) setView({ inspecting: true });
    }, [drawn, path, file.report, setView]);

    const onPoseChange = useCallback((pose: CameraPose) => setView({
        theta: round(pose.theta),
        phi: round(pose.phi),
        distance: round(pose.distance),
        targetX: round(pose.targetX),
        targetY: round(pose.targetY),
        targetZ: round(pose.targetZ),
    }), [setView]);

    const stage = useRef<ModelStageHandle>(null);
    const onFrame = useCallback(() => {
        stage.current?.frame();
        // Forgotten as well as re-framed: framing writes no pose of its own, and a stored one left
        // standing would take the model straight back where the reader had just left it.
        setView(UNPOSED);
    }, [setView]);

    const inspecting = view.inspecting && !!file.report;
    const closeReport = useCallback(() => setView({ inspecting: false }), [setView]);

    if (!currentFile) return null;

    return (
        <>
            <LayoutContent>
                <div className="model3d-view">
                    <Suspense fallback={<div className="model3d-stage" />}>
                        <ModelStage
                            // A different model is a different stage: its scale, its lighting and
                            // the camera that frames it are all its own.
                            key={path}
                            ref={stage}
                            file={file}
                            initialPose={view.distance > 0 ? view : null}
                            onPoseChange={onPoseChange}
                            onDrawn={onDrawn}
                            playing={view.playing}
                        />
                    </Suspense>
                    {inspecting && file.report && (
                        <Suspense fallback={<aside className="model3d-report" />}>
                            <ReportPanel report={file.report} onClose={closeReport} />
                        </Suspense>
                    )}
                </div>
            </LayoutContent>
            <TopBanner additionalPanels={
                <Flex align="center" gap="small" style={{ marginLeft: '10px' }}>
                    {clipCount > 0 && (
                        <Tooltip title={view.playing ? 'Pause animation' : 'Play animation'}>
                            <Button
                                size="small"
                                icon={view.playing ? <PauseOutlined /> : <CaretRightOutlined />}
                                onClick={() => setView({ playing: !view.playing })}
                                aria-label={view.playing ? 'Pause animation' : 'Play animation'}
                            />
                        </Tooltip>
                    )}
                    <Tooltip title="Frame the model">
                        <Button
                            size="small"
                            icon={<AimOutlined />}
                            onClick={onFrame}
                            aria-label="Frame the model"
                        />
                    </Tooltip>
                    {file.report && (
                        <Tooltip title={inspecting ? 'Close the inspector' : 'Inspect this file'}>
                            <Button
                                size="small"
                                type={inspecting ? 'primary' : 'default'}
                                icon={<FileSearchOutlined />}
                                onClick={() => setView({ inspecting: !view.inspecting })}
                                aria-label={inspecting ? 'Close the inspector' : 'Inspect this file'}
                            />
                        </Tooltip>
                    )}
                </Flex>
            } />
        </>
    );
};

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = extractName(file.path);
    return <><img src={iconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>;
}

const fileConfigFor = (file: FileDto) => {
    const lowerName = extractName(file.path).toLowerCase();
    const isSupported = supportedExtensions.some(ext => lowerName.endsWith(ext));

    if (!isSupported) return null;

    return {

        fileLabelCmp,
        mainView: MainView,
    };
};

export const plugin: CmsPlugin = {
    id: 'three-d-model-view',
    fileConfigFor,
    fileExtensions: supportedExtensions,
};
