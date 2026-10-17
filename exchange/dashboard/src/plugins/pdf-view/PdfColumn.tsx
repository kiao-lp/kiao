import {
    forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { Document, Page } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import {
    anchoredScrollTop, columnRatios, layOutColumn, pageInFocus, pagesInView, scrollTopFor,
    EMPTY_LAYOUT, type ColumnLayout, type PageRange,
} from './pageColumn';
import './pdf-view.css';

/**
 * How many pages either side of the viewport stay mounted. One is enough to meet an ordinary
 * scroll with a page already rendered, and few enough that even an atlas-sized document keeps
 * four canvases alive rather than four hundred.
 */
const OVERSCAN = 1;

/** The space above, below and between the pages. */
const PAGE_GAP = 12;

/** Kept clear on either side of a page, so it never touches the scrollbar. */
const COLUMN_PADDING = 8;

/** What the top banner's page controls drive. */
export interface PdfColumnHandle {
    goToPage: (pageNumber: number) => void;
}

interface PdfColumnProps {
    url: string;
    token?: string;
    zoom: number;
    /** The page to open on — where the document was left. */
    initialPage: number;
    /** The page now being read, reported as the reader crosses into it. */
    onPageChange: (pageNumber: number) => void;
    /** The length of the document, once it has loaded. */
    onNumPages: (numPages: number) => void;
}

/**
 * The document as one continuous column of pages.
 *
 * Nothing here measures the DOM to decide what to draw. `pageColumn` lays the whole document out
 * from its page proportions, which gives three things at once: a scrollbar that spans the document
 * before a single page has been rasterised, a jump to any page that costs one assignment to
 * `scrollTop`, and a mounted set that can be narrowed to what the viewport actually shows.
 *
 * The relayouts are where the care goes. A zoom step, a resized window and a page reporting a size
 * its neighbours had not implied all move every box below them; each is followed by
 * `anchoredScrollTop`, so the reader stays on the line they were reading instead of being thrown
 * up or down the document by a change they did not make.
 */
export const PdfColumn = forwardRef<PdfColumnHandle, PdfColumnProps>((
    { url, token, zoom, initialPage, onPageChange, onNumPages }, ref,
) => {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [numPages, setNumPages] = useState(0);
    const [columnWidth, setColumnWidth] = useState(0);
    const [range, setRange] = useState<PageRange>({ first: 1, last: 0 });
    /** A page's proportion, learned the first time it is rendered — see `columnRatios`. */
    const [measured, setMeasured] = useState<ReadonlyMap<number, number>>(() => new Map());

    // react-pdf reloads the document whenever this object changes identity, so it must not be
    // rebuilt on every render.
    const file = useMemo(() => (
        token ? { url, httpHeaders: { Authorization: `Bearer ${token}` } } : { url }
    ), [url, token]);

    const pageWidth = Math.max(0, Math.floor((columnWidth - 2 * COLUMN_PADDING) * zoom));
    const layout = useMemo(
        () => layOutColumn(columnRatios(numPages, measured), pageWidth, PAGE_GAP),
        [numPages, measured, pageWidth],
    );

    const noteRatio = useCallback((pageNumber: number, ratio: number) => {
        if (!Number.isFinite(ratio) || ratio <= 0) return;
        setMeasured(prev => (prev.get(pageNumber) === ratio ? prev : new Map(prev).set(pageNumber, ratio)));
    }, []);

    const handleLoad = useCallback((pdf: PDFDocumentProxy) => {
        setNumPages(pdf.numPages);
        onNumPages(pdf.numPages);
        // The first page's proportion stands in for every page not yet rendered, so it is worth
        // asking pdf.js for outright: a document reopened at page 300 never mounts page 1, and
        // would otherwise lay out three hundred A4 guesses for a document of another shape.
        pdf.getPage(1)
            .then(page => {
                const { width, height } = page.getViewport({ scale: 1 });
                if (width > 0) noteRatio(1, height / width);
            })
            .catch(() => { /* the column keeps the A4 default */ });
    }, [onNumPages, noteRatio]);

    /** The width the pages are laid out in, kept in step with the scroller. */
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;

        const observer = new ResizeObserver(([entry]) => {
            if (entry) setColumnWidth(entry.contentRect.width);
        });
        observer.observe(scroller);
        return () => observer.disconnect();
    }, []);

    /**
     * Reading the scroller: which pages to mount, and which one is being read. Held in a ref and
     * rewritten on every render so the scroll listener below, attached once, always runs against
     * the current layout.
     */
    const reportedPage = useRef(0);
    const syncToScroll = useRef(() => { });
    syncToScroll.current = () => {
        const scroller = scrollerRef.current;
        if (!scroller || !layout.boxes.length) return;

        const next = pagesInView(layout, scroller.scrollTop, scroller.clientHeight, OVERSCAN);
        setRange(prev => (prev.first === next.first && prev.last === next.last ? prev : next));

        // Only a page turn is worth telling: this runs on every frame the reader scrolls, and
        // each report is a write to the remembered view state.
        const page = pageInFocus(layout, scroller.scrollTop, scroller.clientHeight);
        if (page !== reportedPage.current) {
            reportedPage.current = page;
            onPageChange(page);
        }
    };

    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;

        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                syncToScroll.current();
            });
        };
        scroller.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            scroller.removeEventListener('scroll', onScroll);
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);

    /** Opening on the page the document was left at, the moment there is a column to scroll. */
    const openedAt = useRef(initialPage);
    const opened = useRef(false);
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (opened.current || !scroller || !layout.boxes.length) return;
        opened.current = true;
        scroller.scrollTop = scrollTopFor(layout, openedAt.current);
    }, [layout]);

    /** Every later relayout keeps the reader where they were rather than where the pixels went. */
    const laidOut = useRef<ColumnLayout>(EMPTY_LAYOUT);
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        const before = laidOut.current;
        laidOut.current = layout;
        if (!scroller || !before.boxes.length) return;

        // Only when the correction actually moves the reader. A page confirming the proportion it
        // had borrowed relays the column out to exactly the same boxes, and writing `scrollTop`
        // for that would cancel any smooth scroll in flight — which is every step of the Next
        // button, since the page it steps to reports its size on the way.
        const anchored = anchoredScrollTop(before, layout, scroller.scrollTop);
        if (Math.abs(anchored - scroller.scrollTop) >= 1) scroller.scrollTop = anchored;
    }, [layout]);

    /** A relayout moves the pages under the viewport, so what it shows is worth reading again. */
    useLayoutEffect(() => { syncToScroll.current(); }, [layout]);

    useImperativeHandle(ref, () => ({
        goToPage: (pageNumber: number) => {
            const scroller = scrollerRef.current;
            if (!scroller || !layout.boxes.length) return;
            // A step to the next page is worth animating; a jump across the document is not —
            // it would mount and discard every page in between on the way past.
            const behavior = Math.abs(pageNumber - reportedPage.current) <= 1 ? 'smooth' : 'auto';
            scroller.scrollTo({ top: scrollTopFor(layout, pageNumber), behavior });
        },
    }), [layout]);

    const mounted = useMemo(() => {
        const pages: number[] = [];
        for (let n = range.first; n <= range.last; n++) pages.push(n);
        return pages;
    }, [range]);

    return (
        <div ref={scrollerRef} className="pdf-column-scroller">
            <Document
                file={file}
                onLoadSuccess={handleLoad}
                onLoadError={error => console.error('PDF Load Error:', error)}
                loading={<div className="pdf-column-message">Loading PDF…</div>}
                error={<div className="pdf-column-message">This PDF could not be opened.</div>}
            >
                <div
                    className="pdf-column"
                    style={{ height: layout.height, minWidth: layout.width + 2 * COLUMN_PADDING }}
                >
                    {mounted.map(pageNumber => {
                        const box = layout.boxes[pageNumber - 1];
                        return (
                            <div
                                key={pageNumber}
                                className="pdf-page-slot"
                                style={{ top: box.top, height: box.height, width: layout.width }}
                            >
                                <Page
                                    pageNumber={pageNumber}
                                    width={layout.width}
                                    onLoadSuccess={page => noteRatio(pageNumber, page.originalHeight / page.originalWidth)}
                                    // The slot is already page-shaped and page-coloured, so a page
                                    // still rendering is blank paper rather than a line of text.
                                    loading=""
                                    error={<div className="pdf-page-message">Page {pageNumber} could not be rendered.</div>}
                                />
                            </div>
                        );
                    })}
                </div>
            </Document>
        </div>
    );
});

PdfColumn.displayName = 'PdfColumn';
