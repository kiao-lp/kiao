import React from 'react';
import {
    FileDto,
    CmsPlugin,
    useFileBrowsingPersistenceContext,
    useAuthenticatedFileUrl,
    usePluginHotkeys,
    MainViewCmp,
    FileLabelCmp,
    extractName,
    LayoutContent,
    TopBanner,
} from '@cms-core';

import { isImagePath, supportedExtensions } from './gallery';
import { useGallery } from './useGallery';
import { GalleryControls } from './GalleryControls';
import iconImg from './image-icon.svg';

const ImageViewer: React.FC<{ url: string, alt: string }> = ({ url, alt }) => {
    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', overflow: 'hidden' }}>
            <img
                src={url}
                alt={alt}
                style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
            />
        </div>
    );
};

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const url = useAuthenticatedFileUrl(currentFile?.path ?? '');
    const gallery = useGallery();

    React.useEffect(() => {
        if (currentFile) {
            document.title = extractName(currentFile.path) || 'Image';
        }
    }, [currentFile]);

    // The file browser's own arrows and Delete are gated on a folder being browsed, so they are
    // out of the way here and these three keys are the view's for as long as a picture is open.
    //
    // Registered once, and reading the gallery through a ref rather than closing over it. The
    // registry snapshots which hotkeys are live and only recomputes when a *registration* changes,
    // so a key gated on `gallery.next` would be dead between the render that learnt the folder's
    // listing and the effect that re-registers on it — a window a fast hand, or a loaded machine,
    // lands inside. Nothing is gated instead: an arrow at the end of the folder has nowhere to go
    // and does nothing, which is what a disabled button says and what the reader sees either way.
    const galleryRef = React.useRef(gallery);
    galleryRef.current = gallery;

    usePluginHotkeys('image-view', [
        {
            id: 'image-previous',
            key: 'ArrowLeft',
            title: <>←. Previous image</>,
            execute: () => galleryRef.current.goPrevious(),
        },
        {
            id: 'image-next',
            key: 'ArrowRight',
            title: <>→. Next image</>,
            execute: () => galleryRef.current.goNext(),
        },
        {
            id: 'image-delete',
            key: 'Delete',
            title: <>Delete. Delete this image</>,
            execute: () => galleryRef.current.remove(),
        },
    ]);

    if (!currentFile) return null;

    return (
        <>
            <LayoutContent additionalPanels={<GalleryControls gallery={gallery} />}>
                <ImageViewer url={url} alt={extractName(currentFile.path)} />
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
    if (!isImagePath(file.path)) return null;

    return {

        fileLabelCmp,
        mainView: MainView,
    };
};

export const plugin: CmsPlugin = {
    id: 'image-view',
    fileConfigFor,
    fileExtensions: supportedExtensions,
};
