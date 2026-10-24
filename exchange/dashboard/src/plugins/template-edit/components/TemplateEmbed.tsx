import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useWorkerClient, ConfiguredMarkdown } from '@cms-core';
import { WorkerClient } from 'kiao-worker';
import { TemplateCollectionV0, instantiateTemplate } from '@cms-kit/template-lang';
import { useGlobalTemplateStore } from '@cms-kit/template-fields';

// Context to track visited templates and prevent infinite recursion
const RecursionContext = createContext<Set<string>>(new Set());

interface TemplateEmbedProps {
    /** The path to the template file, provided by the markdown renderer */
    id: string;
    /** Optional title, usually the link text */
    title?: string;
}

export const TemplateEmbed: React.FC<TemplateEmbedProps> = ({ id: path, title }) => {
    const workerClient = useWorkerClient() as WorkerClient;
    const { heap, enabledMap } = useGlobalTemplateStore();
    const [template, setTemplate] = useState<TemplateCollectionV0 | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Recursion Detection
    const visited = useContext(RecursionContext);
    const isRecursive = visited.has(path);

    // Load template logic
    useEffect(() => {
        if (!path || isRecursive) return;

        let isMounted = true;
        setLoading(true);

        const load = async () => {
            try {
                // Determine full path. Assuming path is relative to root or absolute.
                // If extension is missing, add it? Existing notes logic uses specific extension.
                // Template definition says "template::path". User example might include extension.
                // We'll try to load as is, or append .template.json if fails?
                // For now assume path is correct.
                // Note: user said "template:: + path of a file".

                let loadPath = path;
                if (!loadPath.endsWith('.template.json')) {
                    // Try adding extension if it looks like a name only?
                    // Or trust the user. Let's try as is first.
                }

                // Check if we need to decode URI?
                loadPath = decodeURI(loadPath);

                const data = await workerClient.getDocument<TemplateCollectionV0>(loadPath);
                if (isMounted) {
                    if (data) {
                        setTemplate(data.content);
                    } else {
                        setError(`Template not found: ${loadPath}`);
                    }
                }
            } catch (e) {
                if (isMounted) {
                    setError(`Error loading template: ${e}`);
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        load();

        return () => { isMounted = false; };
    }, [path, workerClient, isRecursive]);

    // Memoize the next visited set
    const nextVisited = useMemo(() => new Set(visited).add(path), [visited, path]);

    const result = useMemo(
        () => (template ? instantiateTemplate(heap, template, enabledMap) : ''),
        [heap, template, enabledMap],
    );

    if (isRecursive) {
        return (
            <div style={{ border: '1px solid red', padding: '5px', color: 'red' }}>
                Infinite recursion detected: {path}
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ color: 'red' }}>
                {error}
            </div>
        );
    }

    if (loading || !template) {
        // Show title if available while loading
        return <span className="template-loading">{title || `Loading template ${path}...`}</span>;
    }

    const rootTemplate = template.rootTemplate;
    if (!rootTemplate) return <div>Invalid Template</div>;

    // The header names the template and opens it: the router path is the store path, so the
    // template's own path is already the link. Templates are always markdown, so the instantiated
    // text below it is rendered markdown.
    return (
        <RecursionContext.Provider value={nextVisited}>
            <div className="template-embed" style={{ margin: '10px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                    <div style={{ margin: 0, flex: 1, fontWeight: 'bold' }}>
                        <Link
                            to={`/${path}`}
                            style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                            {title || template.name || path} <span style={{ fontSize: '0.8em', color: 'var(--muted)', marginLeft: '8px' }}>TEMPLATE</span>
                        </Link>
                    </div>
                    <button
                        onClick={() => navigator.clipboard.writeText(result)}
                        style={{ cursor: 'pointer', padding: '4px 8px' }}
                    >
                        Copy
                    </button>
                </div>
                <div className="markdown-body">
                    <ConfiguredMarkdown showCopyHtml={true}>{result}</ConfiguredMarkdown>
                </div>
            </div>
        </RecursionContext.Provider>
    );
};
