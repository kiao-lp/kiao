
import React, { useState } from 'react';
import { ReactReader } from 'react-reader';
import {
    useFileBrowsingPersistenceContext,
    useAuthToken,
    useFileViewState,
    MainViewCmp,
    extractName,
    LayoutContent,
    TopBanner,
} from '@cms-core';

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

export default MainView;
