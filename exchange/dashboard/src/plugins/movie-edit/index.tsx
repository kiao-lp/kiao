import React from 'react';
import { ScissorOutlined } from '@ant-design/icons';
import {
    CmsPlugin,
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
import { MediaPlayer } from './MediaPlayer';
import { MovieEditProvider } from './MovieEdit-ctx';
import { SegmentsPanel } from './SegmentsPanel';
import { TransportControls } from './TransportControls';
import { useMovieHotkeys } from './useMovieHotkeys';
import iconImg from './movie-icon.svg';

/** The view proper, under the provider the player, the banner and the segments panel share. */
const MovieEditView: React.FC = () => {
    useMovieHotkeys();
    return (
        <>
            <LayoutContent>
                <MediaPlayer />
            </LayoutContent>
            <TopBanner additionalPanels={<TransportControls />} />
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

    // Around the layout rather than inside it: the segments panel is a tool bar tab, which
    // LayoutContent draws in a column, and the banner sits beside it — both read the player.
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

// A video's `.config.json` sidecar is not claimed: on its own it means nothing without its video,
// and code-edit shows it as the JSON it is — see ARCHITECTURE.md, "A sidecar is deliberately
// unclaimed".
const fileConfigFor = (file: FileDto) => {
    if (!isMediaPath(extractName(file.path))) return null;

    return {
        fileLabelCmp,
        mainView: MainView,
    };
};

export const plugin: CmsPlugin = {
    id: 'movie-edit',
    fileConfigFor,
    fileExtensions: supportedExtensions,
    // The segments of the open video. Registered for every view, as every plugin's tab is, and
    // saying what it is for when what is open is not a video.
    toolBars: [{
        id: SEGMENTS_TAB_ID,
        title: 'Segments',
        icon: <ScissorOutlined />,
        render: () => <SegmentsPanel />,
    }],
};
