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

/** three. js and its glTF loader are some seven hundred kilobytes, and the CMS opens on a file browser. */
const ModelStage = lazy(() => import('./ModelStage'));
const ReportPanel = lazy(() => import('./ReportPanel'));

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

    const [view, setView] = useFileViewState('model3d', {
        ...UNPOSED, playing: true, inspecting: false,
    });

    const file = useModelFile(path, token);

    // and the outgoing model's animations must not put a play button on a still one.
    const [drawn, setDrawn] = useState({ path: '', ok: false });
    const onDrawn = useCallback((ok: boolean) => setDrawn({ path, ok }), [path]);
    const standing = drawn.path === path && drawn.ok;
    const clipCount = standing ? file.report?.inventory.animations.length ?? 0 : 0;

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
        setView(UNPOSED);
    }, [setView]);

    const inspecting = view.inspecting && !!file.report;
    const closeReport = useCallback(() => setView({ inspecting: false }), [setView]);

    if (!currentFile) return null;

    return (
        <>
            <LayoutContent additionalPanels={
                <Flex align="center" gap="small">
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
            }>
                <div className="model3d-view">
                    <Suspense fallback={<div className="model3d-stage" />}>
                        <ModelStage
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
            <TopBanner />
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

export const plugin = {
    id: 'three-d-model-view',
    fileConfigFor,
    fileExtensions: supportedExtensions,
} satisfies CmsPlugin;
