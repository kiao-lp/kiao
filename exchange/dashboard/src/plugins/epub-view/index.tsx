
import React, { useState } from 'react';
import { ReactReader } from 'react-reader';
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
} from '@cms-core';

import iconImg from './epub-icon.svg';

// Supported extensions for this feature
const supportedExtensions = ['.epub'];

interface EbookViewerProps {
    url: string;
    token?: string;
}

const EbookViewer: React.FC<EbookViewerProps> = ({ url, token }) => {
    // An EPUB CFI addresses a position inside the book, so reopening it lands on
    // the page it was left at rather than back at the cover.
    const [reading, setReading] = useFileViewState('epub', { location: 0 as string | number });
    const [ebookData, setEbookData] = useState<ArrayBuffer | null>(null);

    React.useEffect(() => {
        const fetchEbook = async () => {
            try {
                const headers: Record<string, string> = {};
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
                const response = await fetch(url, { headers });
                if (!response.ok) throw new Error('Failed to fetch ebook');
                const buffer = await response.arrayBuffer();
                setEbookData(buffer);
            } catch (error) {
                console.error("Error loading ebook:", error);
            }
        };

        fetchEbook();
    }, [url, token]);

    if (!ebookData) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading eBook...</div>;
    }

    return (
        <div style={{ height: '100%', width: '100%', position: 'relative' }}>
            <ReactReader
                url={ebookData as any}
                location={reading.location}
                locationChanged={(epubcifi: string | number) => setReading({ location: epubcifi })}
                title="Ebook Reader"
            />
        </div>
    );
};


const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const token = useAuthToken();

    React.useEffect(() => {
        if (currentFile) {
            document.title = extractName(currentFile.path) || 'Ebook';
        }
    }, [currentFile]);

    if (!currentFile) return null;

    const cleanUrl = `/api/files/getFile?path=${encodeURIComponent(currentFile.path)}`;

    return (
        <>
            <LayoutContent>
                <EbookViewer url={cleanUrl} token={token} />
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

export const plugin: CmsPlugin = {
    id: 'epub-view',
    fileConfigFor,
    fileExtensions: supportedExtensions,
};
