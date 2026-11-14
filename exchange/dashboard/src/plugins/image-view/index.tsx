import React from 'react';
import {
    FileDto,
    DashboardPlugin,
    useFileBrowsingPersistenceContext,
    useAuthenticatedFileUrl,
    usePluginHotkeys,
    MainViewCmp,
    FileLabelCmp,
    extractName,
    LayoutContent,
    TopBanner,
} from '@kiao-dashboard-core';

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

    // Browser arrows/Delete are inactive while an image is open.
    // Register once via ref: the registry snapshots keys on registration, so gating on gallery state leaves dead shortcuts.
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

export const plugin = {
    id: 'image-view',
    fileConfigFor,
    fileExtensions: supportedExtensions,
} satisfies DashboardPlugin;
