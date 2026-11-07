import { recordToolError } from './logging.js';

// Shared helpers for the MCP tool registrars (registerFileTools / registerHybridflowTools, and any
// out-of-package registrar through the `shared` subpath).

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/**
 * A successful tool result.
 *
 * JSON is serialized compact, without the indentation `JSON.stringify(…, null, 2)` adds. The only
 * reader is a model, which parses either form equally well, and the indentation is not free:
 * it is a quarter of a directory listing and nearly half of a board listing, paid on every call.
 * Files written to the store keep their pretty form — those a human reads, and git diffs.
 */
export const ok = (data: unknown): ToolResult => ({
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }],
});

/** Wrap a handler so thrown errors become a readable MCP error result instead of a crash. */
export const guard =
    <A>(fn: (args: A) => Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> => {
        try {
            return await fn(args);
        } catch (err) {
            // Hand the error over before it is flattened into a message: the tool-call log wants the
            // stack, and this is the last place that still has it. A no-op when nothing is logging.
            recordToolError(err);
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
        }
    };
