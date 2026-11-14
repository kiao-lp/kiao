import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WorkerClient } from './files.js';
import { guard, ok } from './tools-common.js';

/** Register the direct file-access and git tools (`files_*`, `git_*`) on an MCP server. */
export function registerFileTools(server: McpServer, files: WorkerClient): void {
    // ── Direct file access ──────────────────────────────────────────────────

    server.registerTool('files_list', {
        description: 'List files and folders in a worker directory (path relative to the store root; "" for root).',
        inputSchema: { path: z.string().default('') },
    }, guard(async ({ path }) => ok(await files.listFiles(path))));

    server.registerTool('files_read', {
        description: 'Read a text file from worker and return its contents.',
        inputSchema: { path: z.string() },
    }, guard(async ({ path }) => ok(await files.getFileText(path))));

    server.registerTool('files_write', {
        description: 'Create or overwrite a text file in worker (creates the file if it does not exist).',
        inputSchema: { path: z.string(), content: z.string() },
    }, guard(async ({ path, content }) => {
        await files.writeFile(path, content);
        return ok(`Wrote ${path}`);
    }));

    server.registerTool('files_edit', {
        description: 'Replace an exact string in an existing text file (server-side read–modify–write). THE way to make a small change to a large file — never re-send the whole content with files_write. oldString must match exactly (including whitespace/indentation) and occur exactly once, unless replaceAll is true. Returns the replacement count and new file size.',
        inputSchema: {
            path: z.string(),
            oldString: z.string().describe('Exact text to find. Include enough surrounding context to be unique in the file.'),
            newString: z.string().describe('Replacement text.'),
            replaceAll: z.boolean().optional().describe('Replace every occurrence instead of requiring uniqueness. Default false.'),
        },
    }, guard(async ({ path, oldString, newString, replaceAll }) =>
        ok(await files.editFile(path, oldString, newString, replaceAll ?? false))));

    server.registerTool('files_info', {
        description: 'Get metadata (size, type, companions) for a single file or folder.',
        inputSchema: { path: z.string() },
    }, guard(async ({ path }) => ok(await files.getFileInfo(path))));

    server.registerTool('files_delete', {
        description: 'Delete a file, or a directory WITH EVERYTHING UNDER IT (recursive — there is no need to empty a folder first). Deleting a content file takes its `<file>.config.json` settings sidecar with it. Deleting what is not there succeeds. Internal references to the path are fixed up by the server. To remove several paths, prefer files_delete_batch — one request instead of one per file.',
        inputSchema: { path: z.string() },
    }, guard(async ({ path }) => {
        await files.delete(path);
        return ok(`Deleted ${path}`);
    }));

    server.registerTool('files_delete_batch', {
        description: 'Delete MANY paths in a single request — the way to clear out a set of files without one round trip each. Each path behaves exactly as in files_delete (a directory takes everything under it, sidecars follow their content file, a missing path is not an error). The server applies them in order and stops at the first genuine failure, so a partial delete is possible; the result says how many landed.',
        inputSchema: {
            paths: z.array(z.string()).min(1)
                .describe('Store paths to delete, in the order they should be applied.'),
        },
    }, guard(async ({ paths }) => {
        await files.deleteBatch(paths);
        return ok({ deleted: paths.length, paths });
    }));

    server.registerTool('files_rename', {
        description: 'Rename or move a file/directory. Internal references are updated by the server.',
        inputSchema: { path: z.string(), newPath: z.string() },
    }, guard(async ({ path, newPath }) => {
        await files.rename(path, newPath);
        return ok(`Renamed ${path} -> ${newPath}`);
    }));

    server.registerTool('files_mkdir', {
        description: 'Create a new directory.',
        inputSchema: { path: z.string() },
    }, guard(async ({ path }) => {
        await files.createFolder(path);
        return ok(`Created folder ${path}`);
    }));

    server.registerTool('files_search', {
        description: 'Search files under a directory. The query is a small language, and every '
            + 'condition in it must be satisfied by the same file — though they may match on '
            + 'different lines, and each is tried against the file name as well as the content. '
            + '`mot1 mot2` = both words anywhere, case-insensitive substrings. '
            + '`"Exact Text"` = that text with that exact case (\\" escapes a quote). '
            + '`/re[gG]ex/` = an RE2 regular expression, `/re/i` to ignore case; no spaces inside, '
            + 'use \\s. `-terme` excludes files containing it (needs at least one positive term). '
            + 'Forms combine: `plan "Plan B" /v\\d+/ -draft`. A slash-bearing word that is not a '
            + 'well-formed regex stays literal, so `units/foo` searches for itself.',
        inputSchema: {
            path: z.string().default(''),
            query: z.string(),
        },
    }, guard(async ({ path, query }) => ok(await files.search(path, query))));

    // ── Git (source control) ────────────────────────────────────────────────

    server.registerTool('git_status', {
        description: 'Show git status of the worker working tree (branch, ahead/behind, changed files).',
        inputSchema: {},
    }, guard(async () => ok(await files.gitStatus())));

    server.registerTool('git_commit', {
        description: 'Commit staged changes in the worker working tree.',
        inputSchema: { message: z.string(), amend: z.boolean().optional() },
    }, guard(async ({ message, amend }) => ok(await files.gitCommit(message, amend ?? false))));

    server.registerTool('git_stage', {
        description: 'Stage a file for commit.',
        inputSchema: { path: z.string() },
    }, guard(async ({ path }) => ok(await files.gitStage(path))));

    server.registerTool('git_unstage', {
        description: 'Unstage a file.',
        inputSchema: { path: z.string() },
    }, guard(async ({ path }) => ok(await files.gitUnstage(path))));

    server.registerTool('git_revert', {
        description: 'Discard local (working-tree) changes to a file.',
        inputSchema: { path: z.string() },
    }, guard(async ({ path }) => ok(await files.gitRevert(path))));

    server.registerTool('git_push', {
        description: 'Push committed changes to the remote.',
        inputSchema: {},
    }, guard(async () => ok(await files.gitPush())));

    server.registerTool('git_pull', {
        description: 'Pull changes from the remote.',
        inputSchema: {},
    }, guard(async () => ok(await files.gitPull())));
}
