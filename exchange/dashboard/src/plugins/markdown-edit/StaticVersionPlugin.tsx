import { type FC, type ReactNode, useCallback } from 'react';
import { FileImageOutlined } from '@ant-design/icons';
import { message } from 'antd';
import { extractName, useWorkerClient, useRefreshFileList, useContextMenuItems, generateStaticMarkdown, type StaticMarkdownResult } from '@cms-core';
import { staticVersionTarget, type StaticVersionTarget } from './staticVersion';

/** One toast per generation: the loading message is replaced in place by the outcome. */
const PROGRESS_KEY = 'markdown-static-version';

/** Where the entry sits: with the server's file actions, since that is what it is. */
const MENU_GROUP = '6-actions';

/**
 * One line saying what was written and what, if anything, was lost.
 *
 * A failed diagram is not a failed generation — its source stays in the output — but it is not a
 * silent success either: a document that quietly drops a picture is worse than one that says so,
 * because nobody re-reads a file they were told was fine.
 */
export const summarizeGeneration = (name: string, result: StaticMarkdownResult): {
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
        text: `${name}: ${total === 0 ? 'no diagrams' : `${total} diagram${total > 1 ? 's' : ''}`}`,
    };
};

/**
 * Offers "Generate static version" on a `.src.md`, and runs it in the browser.
 *
 * The conversion happens here rather than behind a worker action because the renderers it
 * needs are already loaded and already correct in this tab — mermaid, archdia, graph and
 * the PlantUML server the preview talks to. A provider service would have to reproduce all four
 * headlessly — behind a JSDOM shim, with no layout engine to ask for text metrics — and be deployed
 * beside every worker; a provider service exists nowhere today, so the entry would be
 * missing from the Docker image and `bin/local-start-kiao.sh` — every place a
 * document is actually written.
 */
export const StaticVersionPlugin: FC<{ children?: ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();

    const generate = useCallback(async (target: StaticVersionTarget) => {
        const name = extractName(target.output);
        message.open({ key: PROGRESS_KEY, type: 'loading', content: `Generating ${name}…`, duration: 0 });

        try {
            const source = await client.getFileText(target.source);
            const result = await generateStaticMarkdown(source, {
                assetFolder: target.assetFolder,
                onProgress: (done, total) => message.open({
                    key: PROGRESS_KEY,
                    type: 'loading',
                    content: `Generating ${name}… diagram ${done} of ${total}`,
                    duration: 0,
                }),
            });

            if (result.assets.length > 0) {
                await client.createFolder(target.assetFolderPath);
                // One at a time: the pictures of a long document are megabytes together, and a
                // burst of parallel uploads buys nothing against a file store on the same machine.
                for (const asset of result.assets) {
                    await client.update(
                        `${target.assetFolderPath}/${asset.name}`,
                        new Blob([asset.svg], { type: 'image/svg+xml' }),
                    );
                }
            }
            // The markdown last, so it is never on disk pointing at pictures that are not.
            await client.update(target.output, result.markdown);
            refreshFileList();

            const { type, text } = summarizeGeneration(name, result);
            message.open({ key: PROGRESS_KEY, type, content: text, duration: 5 });
        } catch (error) {
            message.open({
                key: PROGRESS_KEY,
                type: 'error',
                content: `Generating ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
                duration: 8,
            });
        }
    }, [client, refreshFileList]);

    useContextMenuItems('markdown-static-version', [
        {
            id: 'generate-static-version',
            label: 'Generate static version',
            icon: <FileImageOutlined />,
            group: MENU_GROUP,
            order: 5,
            // One file at a time: a generation names one output, and a multi-selection names none.
            enabledWhen: (ctx) => !ctx.isEmptyArea
                && ctx.paths.length === 1
                && !!ctx.pointedFile
                && !ctx.pointedFile.isDirectory
                && staticVersionTarget(ctx.pointedFile.path) !== null,
            execute: (ctx) => {
                const target = ctx.pointedFile && staticVersionTarget(ctx.pointedFile.path);
                if (target) void generate(target);
            },
        },
    ], [generate]);

    return <>{children}</>;
};
