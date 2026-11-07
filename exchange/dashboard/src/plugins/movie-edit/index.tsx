import React from 'react';
import { ScissorOutlined } from '@ant-design/icons';
import {
    CmsPlugin,
    lazyComponent,
    extractName,
    FileDto,
    FileLabelCmp,
    LayoutContent,
    MainViewCmp,
    TopBanner,
    useFileBrowsingPersistenceContext,
} from '@cms-core';
import { SEGMENTS_TAB_ID } from './constants';
import { isAudioPath, isMediaPath, supportedExtensions } from './media';
import { MovieEditProvider } from './MovieEdit-ctx';
import { useMovieHotkeys } from './useMovieHotkeys';
import iconImg from './movie-icon.svg';

const MediaPlayer = lazyComponent(() => import('./MediaPlayer').then(m => ({ default: m.MediaPlayer })));
const SegmentsPanel = lazyComponent(() => import('./SegmentsPanel').then(m => ({ default: m.SegmentsPanel })));
const TransportControls = lazyComponent(() => import('./TransportControls').then(m => ({ default: m.TransportControls })));

/** The view under the provider shared by the player, its controls and the segments panel. */
const MovieEditView: React.FC = () => {
    useMovieHotkeys();
    return (
        <>
            <LayoutContent additionalPanels={<TransportControls />}>
                <MediaPlayer />
            </LayoutContent>
            <TopBanner />
        </>
    );
};

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    React.useEffect(() => {
        if (currentFile) {
            document.title = extractName(currentFile.path) || 'Video';
        }
    }, [currentFile]);

    if (!currentFile) return null;

    return (
        <MovieEditProvider path={currentFile.path} audio={isAudioPath(currentFile.path)}>
            <MovieEditView />
        </MovieEditProvider>
    );
};

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = extractName(file.path);
    return <><img src={iconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>;
}

const fileConfigFor = (file: FileDto) => {
    if (!isMediaPath(extractName(file.path))) return null;

    return {
        fileLabelCmp,
        mainView: MainView,
    };
};

export const plugin = {
    id: 'movie-edit',
    fileConfigFor,
    fileExtensions: supportedExtensions,
    toolBars: [{
        id: SEGMENTS_TAB_ID,
        title: 'Segments',
        icon: <ScissorOutlined />,
        render: () => <SegmentsPanel />,
    }],
} satisfies CmsPlugin;
