import React, { useCallback, useContext, useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';
import vsLight from 'react-syntax-highlighter/dist/esm/styles/prism/vs';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './markdown.css';

import { themeMode, DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeContext } from '../../ThemeContext';
import { usePluginListContext } from '../core/PluginList-ctx';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';
import { useWorkerClient } from '../files/service/ui';
import { RevealInTreeButton } from '../files/nav-bar/RevealInTreeButton';
import { resolveInternalLink, storePathOfHref } from '../lib/internal-links';
import { storePathOfImage } from './imageSource';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Mermaid, PlantUML, SvgRenderer, ArchDia, Graph } from './lazy';
import { AsyncImage } from './components/AsyncImage';
import { CopyButton } from './components/buttons/CopyButton';
import { CopySvgButton } from './components/buttons/CopySvgButton';
import { CopyHtmlButton } from './components/buttons/CopyHtmlButton';
import { EditBlockButton } from './components/buttons/EditBlockButton';
import { ExtractBlockButton } from './components/buttons/ExtractBlockButton';
import { rehypeSourceLine } from './lib/rehypeSourceLine';
import { remarkKiaoDiagramRestore, remarkKiaoDiagramHideCompanion } from './lib/kiaoDiagramRemark';
import type { Theme } from '../../ThemeContext';
import type { BlockEditor, BlockExtractor } from './types';

export interface ConfiguredMarkdownProps {
    children: string;
    className?: string;
    useDivForParagraphs?: boolean;
    /**
     * The store folder the rendered document lives in, which its relative image links are written
     * against (see `imageSource.ts`). Defaults to the folder the browser is on — that *is* the
     * document, for everything the CMS opens. What passes its own is content the browser is not
     * showing: the Claude panel, where the relative paths a reply carries are the model's, written
     * against the conversation's working folder.
     */
    documentFolder?: string;
    showCopyHtml?: boolean;
    /** Stamp rendered blocks with their markdown line, for editor/preview scroll sync. */
    sourceLineAttributes?: boolean;
    /** Per-language handlers that put an edit button on a fenced block. */
    blockEditors?: Record<string, BlockEditor>;
    /** Per-language handlers that put an extract button on a fenced block. */
    blockExtractors?: Record<string, BlockExtractor>;
    /**
     * Whether a link into the store carries the crosshair that shows where it is. On by default,
     * because the render is a page being read. What turns it off is a render that is not one: a
     * mindmap note, which is a label on a canvas — small, sized to its own text, and dragged by
     * the hand that would otherwise be reaching past a button to grab it.
     */
    revealLinkTargets?: boolean;
}

const MermaidBlock: React.FC<{ code: string; theme: Theme; actions?: React.ReactNode }> = ({ code, theme, actions }) => {
    const svgRef = useRef<string | null>(null);
    return (
        <div className="code-block-wrapper diagram-block">
            <div className="code-block-actions">
                <CopyButton code={code} />
                <CopySvgButton getSvg={() => svgRef.current} />
                {actions}
            </div>
            <Mermaid theme={theme} onSvg={(svg) => { svgRef.current = svg; }}>{code}</Mermaid>
        </div>
    );
};

const PlantUMLBlock: React.FC<{ code: string; theme: Theme; actions?: React.ReactNode }> = ({ code, theme, actions }) => {
    const imageUrlRef = useRef<string | null>(null);
    const getSvg = useCallback(async () => {
        if (!imageUrlRef.current) return null;
        const res = await fetch(imageUrlRef.current);
        return await res.text();
    }, []);
    return (
        <div className="code-block-wrapper diagram-block">
            <div className="code-block-actions">
                <CopyButton code={code} />
                <CopySvgButton getSvg={getSvg} />
                {actions}
            </div>
            <PlantUML theme={theme} onUrl={(url) => { imageUrlRef.current = url; }}>{code}</PlantUML>
        </div>
    );
};

const ArchDiaBlock: React.FC<{ code: string; theme: Theme; actions?: React.ReactNode }> = ({ code, theme, actions }) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    // Scoped to this block's own wrapper: a document routinely holds several
    // diagrams, and a document-wide lookup would copy the first one.
    const getSvg = useCallback(async () => {
        const svg = wrapperRef.current?.querySelector('.archdia-svg');
        if (!svg) return null;
        const { serializeSvgForExport } = await import('@cms-kit/archdia');
        return serializeSvgForExport(svg);
    }, []);
    return (
        <div className="code-block-wrapper diagram-block" ref={wrapperRef}>
            <div className="code-block-actions">
                <CopyButton code={code} />
                <CopySvgButton getSvg={getSvg} />
                {actions}
            </div>
            <ArchDia theme={theme}>{code}</ArchDia>
        </div>
    );
};

export const ConfiguredMarkdown: React.FC<ConfiguredMarkdownProps> = ({
    children,
    className,
    useDivForParagraphs,
    documentFolder,
    showCopyHtml,
    sourceLineAttributes,
    blockEditors,
    blockExtractors,
    revealLinkTargets = true,
}) => {
    const theme = useContext(ThemeContext)?.theme ?? DEFAULT_KIAO_THEME;
    const fileClient = useWorkerClient();
    const { customLinkRenderers } = usePluginListContext();
    const { currentPath } = useFileBrowsingPersistenceContext();
    const contentRef = useRef<HTMLDivElement>(null);

    const isDark = themeMode(theme) === 'dark';

    // A link to another document of the store carries the crosshair that shows where it is,
    // because a link is exactly where one meets a document one has not placed yet — and following
    // it is not the only thing one may want to do about that. Only such a link: one out to the web
    // names no row of the tree, and a `#heading` names a place in the page one is already on. A
    // render that is not a page being read says so, and every link in it stays bare.
    //
    // Held still across renders: the renderer tells one block from the next by the identity of
    // what draws it, and a fresh function is a fresh set of blocks — every diagram in the document
    // drawn again for nothing. The link renderers need no such care: the plugin list memoizes them.
    const linkAdornment = useMemo(() => (revealLinkTargets ? (href: string) => {
        const path = storePathOfHref(href);
        return path === null ? null : <RevealInTreeButton path={path} />;
    } : undefined), [revealLinkTargets]);

    const baseFolder = documentFolder ?? currentPath;

    const effectiveResolveImage = useMemo(() => {
        if (fileClient) {
            return (src: string) => {
                // Embedded / object images are already resolvable as-is
                if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) return src;
                return fileClient.getDownloadUrl(storePathOfImage(decodeURIComponent(src), baseFolder));
            };
        }
        return undefined;
    }, [fileClient, baseFolder]);

    const rehypePlugins = useMemo(
        () => [rehypeSlug, rehypeRaw, rehypeKatex, rehypeStringify, ...(sourceLineAttributes ? [rehypeSourceLine] : [])],
        [sourceLineAttributes],
    );

    /**
     * How each kind of block is drawn — one object, kept for as long as what it draws with is.
     *
     * react-markdown builds the document out of these functions, and React tells a block apart
     * by the identity of the function that drew it. Built afresh at every render, they are a
     * fresh set of component types at every render, so React takes every block down and mounts
     * a new one in its place — for markdown that has not changed a character. Nothing moves on
     * screen, which is why it goes unseen, but a block that costs something to mount pays it
     * every time: a diagram is drawn again from nothing, a picture fetched again. The Claude
     * panel does it to a whole transcript at every keystroke in the box below it, since the
     * text being typed re-renders the list the transcript is in.
     */
    const components = useMemo<Components>(() => ({
        p: useDivForParagraphs ? 'div' : 'p',
        img: (props) => <AsyncImage {...props} resolveImage={effectiveResolveImage} />,
        code: ({ className: codeClassName, children, node, ...props }: any) => {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const isInline = !match && !String(children).includes('\n');
            const codeString = String(children).replace(/\n$/, '');
            // `node.position` spans the whole fence, markers included, and is the only anchor
            // that survives duplicate blocks and fences of varying length — hence offsets
            // rather than `data-source-line`.
            const start = node?.position?.start?.offset;
            const end = node?.position?.end?.offset;
            const block = match && start !== undefined && end !== undefined
                ? { language: match[1], code: codeString, range: { start, end } }
                : null;
            const editBlock = block ? blockEditors?.[block.language] : undefined;
            const extractBlock = block ? blockExtractors?.[block.language] : undefined;
            const actions = block && (editBlock || extractBlock) ? (
                <>
                    {editBlock && <EditBlockButton onClick={() => editBlock(block)} />}
                    {extractBlock && <ExtractBlockButton onClick={() => extractBlock(block)} />}
                </>
            ) : null;

            if (!isInline && match && match[1] === 'mermaid') {
                return <MermaidBlock code={codeString} theme={theme} actions={actions} />;
            }

            if (!isInline && match && match[1] === 'plantuml') {
                return <PlantUMLBlock code={codeString} theme={theme} actions={actions} />;
            }

            if (!isInline && match && match[1] === 'archdia') {
                return <ArchDiaBlock code={codeString} theme={theme} actions={actions} />;
            }

            if (!isInline && match && match[1] === 'graph') {
                return (
                    <div className="code-block-wrapper diagram-block">
                        <div className="code-block-actions">
                            <CopyButton code={codeString} />
                            {actions}
                        </div>
                        <Graph theme={theme}>{codeString}</Graph>
                    </div>
                );
            }

            if (!isInline && match && match[1] === 'svg') {
                return (
                    <div className="code-block-wrapper diagram-block">
                        <div className="code-block-actions">
                            <CopyButton code={codeString} />
                            {actions}
                        </div>
                        <SvgRenderer>{codeString}</SvgRenderer>
                    </div>
                );
            }

            if (!isInline && match) {
                const { ref: _ref, style: _style, ...rest } = props;
                return (
                    <div className="code-block-wrapper">
                        <div className="code-block-actions">
                            <CopyButton code={codeString} />
                            {actions}
                        </div>
                        <SyntaxHighlighter
                            style={isDark ? vscDarkPlus as any : vsLight as any}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{ maxWidth: '100%', overflowX: 'auto' }}
                            {...rest}
                        >
                            {codeString}
                        </SyntaxHighlighter>
                    </div>
                );
            }

            return (
                <code {...props} className={codeClassName}>
                    {children}
                </code>
            );
        },
        a: ({ href, children, ...props }) => {
            const nodeHref = (props as any).node?.properties?.href as string | undefined;
            const correctHref = nodeHref || href || '';

            const separatorIndex = correctHref.indexOf('::');
            if (separatorIndex !== -1) {
                const prefix = correctHref.substring(0, separatorIndex);
                const id = correctHref.substring(separatorIndex + 2);

                if (customLinkRenderers && customLinkRenderers[prefix]) {
                    const Renderer = customLinkRenderers[prefix];
                    return <Renderer id={id} title={String(children)} isLink={true} />;
                }
            }

            // Applied only here, past the prefix:: branch, so a scheme owned by a link
            // renderer is never resolved as a plain path.
            const resolvedHref = resolveInternalLink(correctHref);

            const anchor = (
                <a href={resolvedHref} {...props}>
                    {children}
                </a>
            );
            // Beside the anchor rather than inside it: the crosshair is about the
            // destination, not part of the link, and must not be one more thing that follows it.
            const adornment = linkAdornment?.(resolvedHref);
            return adornment ? <>{anchor}{adornment}</> : anchor;
        },
    }), [
        useDivForParagraphs, effectiveResolveImage, theme, isDark,
        blockEditors, blockExtractors, customLinkRenderers, linkAdornment,
    ]);

    return (
        <ErrorBoundary>
            <div className={`configured-markdown-container ${className || ''}`}>
                {showCopyHtml && <CopyHtmlButton containerRef={contentRef} />}
                <div ref={contentRef}>
                    <ReactMarkdown
                        // react-markdown's default drops every URL whose scheme it does not know —
                        // the `prefix::id` links a plugin draws, and the `data:` pictures pasted
                        // images arrive as. The anchors read the raw destination off the node
                        // anyway (see above); this keeps the pictures.
                        urlTransform={(url) => url}
                        components={components}
                        remarkPlugins={[remarkGfm, remarkMath, remarkKiaoDiagramRestore, remarkKiaoDiagramHideCompanion]}
                        rehypePlugins={rehypePlugins}
                    >
                        {children}
                    </ReactMarkdown>
                </div>
            </div>
        </ErrorBoundary>
    );
};
