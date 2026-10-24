import React, { useCallback, useRef, useState } from 'react';
import { Button, Flex, Input } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { pdfjs } from 'react-pdf';
import { ZoomControl } from '@cms-kit/zoom-control';
import {
    useFileBrowsingPersistenceContext,
    useAuthToken,
    useFileViewState,
    MainViewCmp,
    extractName,
    LayoutContent,
    TopBanner,
    Tooltip,
} from '@cms-core';
import { PdfColumn, type PdfColumnHandle } from './PdfColumn';

// Set worker using standard Vite URL import pattern
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

/**
 * The page counter, which is also how a reader reaches a page a thousand scroll wheels away.
 *
 * The box shows the page being read until it is typed in, and goes back to following the scroll
 * as soon as it is left: a number half typed must not be overwritten by the reader's own
 * scrolling, and a number abandoned must not be left standing where the page is.
 */
const PageJump: React.FC<{
    page: number;
    numPages: number;
    onGoTo: (pageNumber: number) => void;
}> = ({ page, numPages, onGoTo }) => {
    const [draft, setDraft] = useState<string | null>(null);

    const commit = () => {
        if (draft === null) return;
        const wanted = Number.parseInt(draft, 10);
        setDraft(null);
        if (Number.isFinite(wanted)) onGoTo(Math.min(Math.max(wanted, 1), numPages));
    };

    return (
        <Flex gap={4} align="center">
            <Tooltip title="Previous page">
                <Button
                    size="small"
                    icon={<UpOutlined />}
                    disabled={page <= 1}
                    onClick={() => onGoTo(page - 1)}
                    aria-label="Previous page"
                />
            </Tooltip>
            <Input
                size="small"
                style={{ width: 52, textAlign: 'center' }}
                value={draft ?? (page || '')}
                onFocus={() => setDraft(String(page || ''))}
                onChange={event => setDraft(event.target.value)}
                onPressEnter={commit}
                onBlur={commit}
                disabled={!numPages}
                aria-label="Page number"
            />
            <span style={{ whiteSpace: 'nowrap' }}>/ {numPages || '--'}</span>
            <Tooltip title="Next page">
                <Button
                    size="small"
                    icon={<DownOutlined />}
                    disabled={!numPages || page >= numPages}
                    onClick={() => onGoTo(page + 1)}
                    aria-label="Next page"
                />
            </Tooltip>
        </Flex>
    );
};

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
                    <PageJump
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
