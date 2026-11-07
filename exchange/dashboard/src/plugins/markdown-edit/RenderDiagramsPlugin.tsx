import { type FC, type ReactNode, useCallback } from 'react';
import { FileImageOutlined } from '@ant-design/icons';
import { message } from 'antd';
import {
    extractName,
    useWorkerClient,
    useRefreshFileList,
    useContextMenuItems,
    generateKiaoDiagramMarkdown,
    diagramAssetTarget,
    type KiaoDiagramResult,
} from '@cms-core';
import type { WorkerClient } from 'kiao-worker';

/** One toast per run: the loading message is replaced in place by the outcome. */
const PROGRESS_KEY = 'markdown-render-diagrams';

/** Where the entry sits: with the server's file actions, since that is what it is. */
const MENU_GROUP = '6-actions';

/** A generated picture: `01-mermaid.svg` and its siblings, nothing the author wrote by hand. */
const GENERATED_ASSET = /^\d+-(mermaid|plantuml|archdia|graph|svg)\.svg$/i;

/**
 * One line saying what was written and what, if anything, was lost.
 *
 * A failed diagram is not a failed render — its block stays untouched — but it is not a silent
 * success either: a document that quietly keeps an outdated picture is worse than one that says
 * so, because nobody re-reads a file they were told was fine.
 */
export const summarizeRender = (name: string, result: KiaoDiagramResult): {
    type: 'success' | 'warning';
    text: string;
} => {
    const drawn = result.assets.length;
    const total = drawn + result.failures.length;

    if (result.failures.length > 0) {
        const [first] = result.failures;
        return {
            type: 'warning',
            text: `${name}: ${drawn} of ${total} diagrams drawn — ${first.language} #${first.position} failed (${first.message})`,
        };
    }
    return {
        type: 'success',
        text: `${name}: ${total === 0 ? 'no diagrams' : `${total} diagram${total > 1 ? 's' : ''} rendered`}`,
    };
};

/** Drops the generated pictures no block references any more — a diagram deleted or renumbered. */
const cleanupOrphans = async (
    client: WorkerClient,
    assetFolderPath: string,
    finalMarkdown: string,
    written: string[],
): Promise<void> => {
    let entries: { path: string }[];
    try {
        entries = await client.listFiles(assetFolderPath);
    } catch {
        return;
    }
    const keep = new Set(written);
    for (const entry of entries) {
        const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
        if (!GENERATED_ASSET.test(name)) continue;
        if (keep.has(name)) continue;
        // A failed diagram keeps its block untouched, still pointing at its previous picture.
        if (finalMarkdown.includes(name)) continue;
        try {
            await client.delete(entry.path);
        } catch {
            // A picture that cannot be deleted is clutter, not a failed render.
        }
    }
};

/**
 * Renders one markdown file's diagrams in place: the pictures beside it, the blocks wrapped
 * around their source. Returns null when the file holds no diagram at all — nothing was written.
 */
const renderOneFile = async (
    client: WorkerClient,
    path: string,
    assetFolder: string,
    assetFolderPath: string,
    onProgress?: (done: number, total: number) => void,
): Promise<KiaoDiagramResult | null> => {
    const source = await client.getFileText(path);
    const result = await generateKiaoDiagramMarkdown(source, { assetFolder, onProgress });

    if (result.assets.length === 0 && result.failures.length === 0) return null;

    if (result.assets.length > 0) {
        await client.createFolder(assetFolderPath);
        for (const asset of result.assets) {
            await client.update(
                `${assetFolderPath}/${asset.name}`,
                new Blob([asset.svg], { type: 'image/svg+xml' }),
            );
        }
        await cleanupOrphans(
            client,
            assetFolderPath,
            result.markdown,
            result.assets.map(a => a.name),
        );
    }
    // The markdown last, so it is never on disk pointing at pictures that are not.
    if (result.markdown !== source) await client.update(path, result.markdown);
    return result;
};

/**
 * Offers "Render diagrams" on a markdown file and on a folder, and runs it in the browser.
 *
 * The conversion happens here rather than behind a worker action because the renderers it needs
 * are already loaded and already correct in this tab — mermaid, archdia, graph and the PlantUML
 * server the preview talks to. A provider service would have to reproduce all four headlessly and
 * be deployed beside every worker; a provider service exists nowhere today, so the entry would be
 * missing from the Docker image and `bin/local-start-kiao.sh` — every place a document is
 * actually written.
 */
export const RenderDiagramsPlugin: FC<{ children?: ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();

    const renderFile = useCallback(async (path: string) => {
        const target = diagramAssetTarget(path);
        if (!target) return;
        const name = extractName(target.source);
        message.open({ key: PROGRESS_KEY, type: 'loading', content: `Rendering diagrams in ${name}…`, duration: 0 });

        try {
            const result = await renderOneFile(client, target.source, target.assetFolder, target.assetFolderPath,
                (done, total) => message.open({
                    key: PROGRESS_KEY,
                    type: 'loading',
                    content: `Rendering diagrams in ${name}… diagram ${done} of ${total}`,
                    duration: 0,
                }));
            refreshFileList();

            if (!result) {
                message.open({ key: PROGRESS_KEY, type: 'info', content: `${name}: no diagrams`, duration: 5 });
                return;
            }
            const { type, text } = summarizeRender(name, result);
            message.open({ key: PROGRESS_KEY, type, content: text, duration: 5 });
        } catch (error) {
            message.open({
                key: PROGRESS_KEY,
                type: 'error',
                content: `Rendering diagrams in ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
                duration: 8,
            });
        }
    }, [client, refreshFileList]);

    const renderFolder = useCallback(async (folder: string) => {
        const name = folder === '' ? 'the store' : extractName(folder);
        message.open({ key: PROGRESS_KEY, type: 'loading', content: `Rendering diagrams in ${name}…`, duration: 0 });

        try {
            const scope = await client.listRecursive([folder]);
            const markdownFiles = scope.files
                .filter(f => !f.isDirectory)
                .map(f => f.path)
                .filter(p => !p.includes('.assets/'))
                .filter(p => diagramAssetTarget(p) !== null)
                .sort();

            if (markdownFiles.length === 0) {
                message.open({ key: PROGRESS_KEY, type: 'info', content: `${name}: no markdown files`, duration: 5 });
                return;
            }

            let rendered = 0;
            let filesWithDiagrams = 0;
            const failures: string[] = [];
            for (let i = 0; i < markdownFiles.length; i++) {
                const path = markdownFiles[i];
                const target = diagramAssetTarget(path);
                if (!target) continue;
                message.open({
                    key: PROGRESS_KEY,
                    type: 'loading',
                    content: `Rendering diagrams in ${name}… file ${i + 1} of ${markdownFiles.length}`,
                    duration: 0,
                });
                try {
                    const result = await renderOneFile(client, target.source, target.assetFolder, target.assetFolderPath);
                    if (result) {
                        filesWithDiagrams++;
                        rendered += result.assets.length;
                        for (const failure of result.failures) {
                            failures.push(`${extractName(path)} ${failure.language} #${failure.position} (${failure.message})`);
                        }
                    }
                } catch (error) {
                    failures.push(`${extractName(path)}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            refreshFileList();

            if (failures.length > 0) {
                message.open({
                    key: PROGRESS_KEY,
                    type: 'warning',
                    content: `${name}: ${rendered} diagram${rendered === 1 ? '' : 's'} rendered in ${filesWithDiagrams} file${filesWithDiagrams === 1 ? '' : 's'} — ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}${scope.truncated ? ' (listing truncated)' : ''}`,
                    duration: 8,
                });
                return;
            }
            message.open({
                key: PROGRESS_KEY,
                type: filesWithDiagrams === 0 ? 'info' : 'success',
                content: filesWithDiagrams === 0
                    ? `${name}: no diagrams in ${markdownFiles.length} file${markdownFiles.length === 1 ? '' : 's'}`
                    : `${name}: ${rendered} diagram${rendered === 1 ? '' : 's'} rendered in ${filesWithDiagrams} file${filesWithDiagrams === 1 ? '' : 's'}${scope.truncated ? ' (listing truncated)' : ''}`,
                duration: 5,
            });
        } catch (error) {
            message.open({
                key: PROGRESS_KEY,
                type: 'error',
                content: `Rendering diagrams in ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
                duration: 8,
            });
        }
    }, [client, refreshFileList]);

    useContextMenuItems('markdown-render-diagrams', [
        {
            id: 'render-diagrams',
            label: 'Render diagrams',
            icon: <FileImageOutlined />,
            group: MENU_GROUP,
            order: 10,
            enabledWhen: (ctx) => !ctx.isEmptyArea
                && ctx.paths.length === 1
                && !!ctx.pointedFile
                && (ctx.pointedFile.isDirectory || diagramAssetTarget(ctx.pointedFile.path) !== null),
            execute: (ctx) => {
                const pointed = ctx.pointedFile;
                if (!pointed) return;
                if (pointed.isDirectory) void renderFolder(pointed.path);
                else void renderFile(pointed.path);
            },
        },
    ], [renderFile, renderFolder]);

    return <>{children}</>;
};
