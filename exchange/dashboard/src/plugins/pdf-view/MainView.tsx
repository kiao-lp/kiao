import React, { useCallback, useRef, useState } from 'react';
import { Flex } from 'antd';
import { pdfjs } from 'react-pdf';
import { ZoomControl } from '@kiao-dashboard-kit/zoom-control';
import {
    useFileBrowsingPersistenceContext,
    useAuthToken,
    useFileViewState,
    MainViewCmp,
    extractName,
    LayoutContent,
    TopBanner,
    PageNavigation,
} from '@kiao-dashboard-core';
import { PdfColumn, type PdfColumnHandle } from './PdfColumn';

// Set worker using standard Vite URL import pattern
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const token = useAuthToken();
    const path = currentFile?.path ?? '';

    React.useEffect(() => {
        if (currentFile) document.title = extractName(currentFile.path) || 'PDF';
    }, [currentFile]);

    // Where this document was left, remembered until it is opened again.
    const [view, setView] = useFileViewState('pdf', { pageNumber: 1, zoom: 1.0 });
    const { pageNumber, zoom } = view;

    // Carries the path it was counted for: navigating between two PDFs does not remount this
    // view, and the outgoing document's length must not be shown against the incoming one.
    const [counted, setCounted] = useState({ path: '', numPages: 0 });
    const numPages = counted.path === path ? counted.numPages : 0;
    const onNumPages = useCallback((count: number) => setCounted({ path, numPages: count }), [path]);

    const column = useRef<PdfColumnHandle>(null);
    const onPageChange = useCallback((page: number) => setView({ pageNumber: page }), [setView]);

    if (!currentFile) return null;

    const cleanUrl = `/api/files/getFile?path=${encodeURIComponent(path)}`;

    return (
        <>
            <LayoutContent additionalPanels={
                <Flex align="center" gap="small">
                    <PageNavigation
                        page={pageNumber}
                        numPages={numPages}
                        onGoTo={page => column.current?.goToPage(page)}
                    />
                    <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
                    <ZoomControl zoom={zoom} onZoomChange={z => setView({ zoom: z })} />
                </Flex>
            }>
                <PdfColumn
                    // A different document is a different column: its length, its page
                    // proportions and the page it opens at are all its own.
                    key={path}
                    ref={column}
                    url={cleanUrl}
                    token={token}
                    zoom={zoom}
                    initialPage={pageNumber}
                    onPageChange={onPageChange}
                    onNumPages={onNumPages}
                />
            </LayoutContent>
            <TopBanner />
        </>
    );
};

export default MainView;
