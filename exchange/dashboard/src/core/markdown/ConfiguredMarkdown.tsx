import React, { useCallback, useContext, useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';
import vsLight from 'react-syntax-highlighter/dist/esm/styles/prism/vs';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './markdown.css';

import { themeMode, DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeContext } from '../ui-foundation/theme/ThemeContext';
import { usePluginListContext } from '../extensibility/PluginList-ctx';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';
import { useWorkerClient } from '../files/service/ui';
import { RevealInTreeButton } from '../files/nav-bar/RevealInTreeButton';
import { resolveInternalLink, storePathOfHref } from '../navigation/internal-links';
import { storePathOfImage } from './imageSource';
import { ErrorBoundary } from '../ui-foundation/feedback/ErrorBoundary';
import { Mermaid, PlantUML, SvgRenderer, ArchDia, Graph } from './lazy';
import { AsyncImage } from '../ui-foundation/media/AsyncImage';
import { CopyButton } from '../ui-foundation/clipboard/CopyButton';
import { CopySvgButton } from '../ui-foundation/clipboard/CopySvgButton';
import { CopyHtmlButton } from '../ui-foundation/clipboard/CopyHtmlButton';
import { EditBlockButton } from './components/buttons/EditBlockButton';
import { ExtractBlockButton } from './components/buttons/ExtractBlockButton';
import { rehypeSourceLine, SOURCE_LINE_ATTRIBUTE } from './lib/rehypeSourceLine';
import { remarkKiaoDiagramRestore, remarkKiaoDiagramHideCompanion } from './lib/kiaoDiagramRemark';
import type { Theme } from '../ui-foundation/theme/ThemeContext';
import type { BlockEditor, BlockExtractor } from './types';

export interface ConfiguredMarkdownProps {
    children: string;
    className?: string;
    useDivForParagraphs?: boolean;
    /** Folder for relative images; defaults to the browsed folder. */
    documentFolder?: string;
    showCopyHtml?: boolean;
    sourceLineAttributes?: boolean;
    blockEditors?: Record<string, BlockEditor>;
    blockExtractors?: Record<string, BlockExtractor>;
    /** Disable for non-page renders (e.g. canvas labels). */
    revealLinkTargets?: boolean;
}

const MermaidBlock: React.FC<{ code: string; theme: Theme; actions?: React.ReactNode }> = ({ code, theme, actions }) => {
    const svgRef = useRef<string | null>(null);
    return (
        <div className="code-block-wrapper diagram-block">
            <div className="code-block-actions">
                <CopyButton className="code-copy-btn" code={code} />
                <CopySvgButton className="code-copy-btn svg-copy-btn" getSvg={() => svgRef.current} />
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
                <CopyButton className="code-copy-btn" code={code} />
                <CopySvgButton className="code-copy-btn svg-copy-btn" getSvg={getSvg} />
                {actions}
            </div>
            <PlantUML theme={theme} onUrl={(url) => { imageUrlRef.current = url; }}>{code}</PlantUML>
        </div>
    );
};

const ArchDiaBlock: React.FC<{ code: string; theme: Theme; actions?: React.ReactNode }> = ({ code, theme, actions }) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    // Scoped to this wrapper; a document-wide lookup would copy the first diagram.
    const getSvg = useCallback(async () => {
        const svg = wrapperRef.current?.querySelector('.archdia-svg');
        if (!svg) return null;
        const { serializeSvgForExport } = await import('@kiao-dashboard-kit/archdia');
        return serializeSvgForExport(svg);
    }, []);
    return (
        <div className="code-block-wrapper diagram-block" ref={wrapperRef}>
            <div className="code-block-actions">
                <CopyButton className="code-copy-btn" code={code} />
                <CopySvgButton className="code-copy-btn svg-copy-btn" getSvg={getSvg} />
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

    // Crosshair only for store-document links. Memoized: a fresh function remounts every block.
    const linkAdornment = useMemo(() => (revealLinkTargets ? (href: string) => {
        const path = storePathOfHref(href);
        return path === null ? null : <RevealInTreeButton path={path} />;
    } : undefined), [revealLinkTargets]);

    const baseFolder = documentFolder ?? currentPath;

    const effectiveResolveImage = useMemo(() => {
        if (fileClient) {
            return (src: string) => {
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

    // Memoized: React keys blocks by component identity; rebuilding remounts every block.
    const components = useMemo<Components>(() => ({
        p: useDivForParagraphs ? 'div' : 'p',
        img: (props) => <AsyncImage {...props} resolveImage={effectiveResolveImage} />,
        code: ({ className: codeClassName, children, node, ...props }: any) => {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const isInline = !match && !String(children).includes('\n');
            const codeString = String(children).replace(/\n$/, '');
            // Offsets span the whole fence; they survive duplicates where line numbers do not.
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
                            <CopyButton className="code-copy-btn" code={codeString} />
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
                            <CopyButton className="code-copy-btn" code={codeString} />
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
                            <CopyButton className="code-copy-btn" code={codeString} />
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

            // Past the prefix:: branch so renderer-owned schemes are not resolved as paths.
            const resolvedHref = resolveInternalLink(correctHref);

            const anchor = (
                <a href={resolvedHref} {...props}>
                    {children}
                </a>
            );
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
                {showCopyHtml && <CopyHtmlButton
                    containerRef={contentRef}
                    omitAttributes={[SOURCE_LINE_ATTRIBUTE]}
                    className="copy-html-btn icon-only"
                    label="Copy HTML"
                    copiedLabel="Copied!"
                />}
                <div ref={contentRef}>
                    <ReactMarkdown
                        // Identity transform: the default drops unknown schemes (`prefix::`, `data:`).
                        urlTransform={(url) => url}
                        components={components}
                        remarkPlugins={[remarkFrontmatter, remarkGfm, remarkMath, remarkKiaoDiagramRestore, remarkKiaoDiagramHideCompanion]}
                        rehypePlugins={rehypePlugins}
                    >
                        {children}
                    </ReactMarkdown>
                </div>
            </div>
        </ErrorBoundary>
    );
};
