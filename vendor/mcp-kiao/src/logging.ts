import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './config.js';

// A record of every `tools/call` this process serves, written to a file the turn cannot reach.
//
// The point is to see what the agent actually does with these tools — which ones it reaches for,
// what it passes, how long each takes, how much context the answer costs it — without the agent
// paying for the measurement or being able to read it back. So three rules hold everywhere below:
//
//   - **Nothing reaches the model.** No tool is added, no description grows, no result changes
//     shape, and nothing is ever written to stdout — stdout *is* the JSON-RPC channel of a stdio
//     server, and a stray line there corrupts the turn. The record goes to a file and nowhere else.
//   - **Nothing blocks the call.** The interceptor captures references and returns; building the
//     record and writing it happen afterwards, on a queue.
//   - **Nothing fails loudly.** A log line is never worth a turn. An unwritable directory, a full
//     disk, a value that will not serialize — all end as a dropped line.

/** How a call came out. `unexpected` is a call that neither failed nor answered properly. */
export type CallStatus = 'success' | 'error' | 'unexpected';

/** Upstream LLM usage, for a tool that ever calls one. See {@link recordTokenUsage}. */
export interface TokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

/** One line of the log. Field names are snake_case: these are data, read by a query, not by code. */
export interface CallRecord {
    timestamp: string;
    server: string;
    tool_name: string;
    request_id?: string | number;
    session_id?: string;
    duration_ms: number;
    status: CallStatus;
    arguments: unknown;
    /** Wire size of the arguments and of the result — what a call costs the turn's context. */
    input_bytes: number;
    output_bytes: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    /** Everything worth noticing that is not an outright failure. Omitted when there is none. */
    anomalies?: string[];
    error?: { name?: string; message: string; stack?: string };
}

/** A call slower than this, an answer larger than this: not failures, but worth being able to grep for. */
const LARGE_OUTPUT_BYTES = 65_536;

/** Argument values are a sample, not a copy — enough to tell two calls apart, bounded on purpose. */
const MAX_STRING = 500;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

/** Keys whose value is never written down, whatever it holds. */
const SECRET_KEY = /token|secret|password|passwd|authorization|api[-_]?key|credential/i;

// ── What a handler can report about its own call ────────────────────────────

interface CallContext {
    error?: unknown;
    usage?: TokenUsage;
}

/**
 * The current call, for the code inside it.
 *
 * `guard` in tools-common.ts turns a thrown error into a readable `isError` result, which is the
 * right thing for the model and loses the stack. Handing the error over here is how the stack
 * survives to the log without any handler signature changing.
 */
const callContext = new AsyncLocalStorage<CallContext>();

/** Report the error a handler caught, so the log keeps its stack. A no-op outside a tool call. */
export const recordToolError = (error: unknown): void => {
    const context = callContext.getStore();
    if (context && context.error === undefined) context.error = error;
};

/**
 * Report upstream LLM usage for the current call.
 *
 * Nothing calls this today: these servers talk to worker, and to nothing that bills tokens
 * — which is why every record carries byte sizes instead. This is where a tool that does reach an
 * LLM hands its `usage` block over, and the three token fields start being filled in.
 */
export const recordTokenUsage = (usage: TokenUsage): void => {
    const context = callContext.getStore();
    if (context) context.usage = usage;
};

// ── The interceptor ─────────────────────────────────────────────────────────

type RawHandler = (request: unknown, extra: unknown) => unknown;
type SetRequestHandler = (schema: unknown, handler: RawHandler) => void;

interface CallExtra {
    requestId?: string | number;
    sessionId?: string;
    signal?: AbortSignal;
}

/**
 * Wrap this server's `tools/call` handler so every invocation is timed and recorded.
 *
 * It intercepts one method on one object — `Server.setRequestHandler` — rather than each tool,
 * because that is the single place every call passes through. A wrapper around `registerTool`
 * would miss the calls that never reach a handler: an argument the schema rejects, a tool name the
 * model invented. Those are the interesting ones, and from here they look like any other call.
 *
 * Must be installed *before* the first tool is registered: `McpServer` installs its `tools/call`
 * handler lazily, on the first `registerTool`, and there is nothing to wrap until it does.
 */
export function installToolLogging(server: McpServer, serverName: string, config: Config): void {
    if (!config.logDir) return;

    // The only cast in here. `setRequestHandler` is generic over the request schema, and this
    // wrapper is deliberately indifferent to it — it forwards every schema untouched and only
    // looks inside the one request it recognizes.
    const target = server.server as unknown as { setRequestHandler: SetRequestHandler };
    const install = target.setRequestHandler.bind(server.server);

    target.setRequestHandler = (schema, handler) => {
        if (!isToolCall(schema)) return install(schema, handler);
        install(schema, (request, extra) => runLogged(config, serverName, handler, request, extra));
    };
}

/**
 * Does this request schema describe `tools/call`? Identity settles it today — the SDK and this
 * file import the same schema object — and the method literal is the fallback the SDK itself reads,
 * so a schema rebuilt by some later version still matches instead of quietly going unlogged.
 */
const isToolCall = (schema: unknown): boolean => {
    if (schema === CallToolRequestSchema) return true;
    const shape = (schema as { shape?: { method?: { value?: unknown } } } | undefined)?.shape;
    return shape?.method?.value === 'tools/call';
};

/** Run the real handler, unchanged, and record what happened on the way out. */
async function runLogged(
    config: Config,
    serverName: string,
    handler: RawHandler,
    request: unknown,
    extra: unknown,
): Promise<unknown> {
    const params = (request as { params?: { name?: unknown; arguments?: unknown } } | undefined)?.params;
    const context: CallContext = {};
    const timestamp = new Date().toISOString();
    const startedAt = process.hrtime.bigint();

    let result: unknown;
    let thrown: unknown;
    try {
        result = await callContext.run(context, () => handler(request, extra));
        return result;
    } catch (error) {
        thrown = error;
        throw error;
    } finally {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const call = extra as CallExtra | undefined;
        // A thunk, not a record: serializing a result can mean a hundred kilobytes of JSON, and the
        // response is not waiting for it.
        schedule(config.logDir, () =>
            buildRecord({
                timestamp,
                serverName,
                toolName: typeof params?.name === 'string' ? params.name : '<unknown>',
                requestId: call?.requestId,
                sessionId: call?.sessionId,
                args: params?.arguments,
                result,
                thrown,
                reported: context.error,
                usage: context.usage,
                durationMs,
                aborted: call?.signal?.aborted === true,
                slowCallMs: config.slowCallMs,
            }),
        );
    }
}

// ── The record ──────────────────────────────────────────────────────────────

export interface RecordInput {
    /** When the call *started* — which is what pairs with `duration_ms`, and what decides its day. */
    timestamp: string;
    serverName: string;
    toolName: string;
    requestId?: string | number;
    sessionId?: string;
    args: unknown;
    result: unknown;
    thrown?: unknown;
    /** The error a handler caught and reported, which still has its stack. */
    reported?: unknown;
    usage?: TokenUsage;
    durationMs: number;
    aborted: boolean;
    slowCallMs: number;
}

/** Turn one finished call into the line that describes it. Exported for the tests. */
export function buildRecord(input: RecordInput): CallRecord {
    const shape = inspectResult(input.result);
    const failure = input.thrown ?? input.reported ?? (shape.isError ? new Error(shape.text) : undefined);

    const anomalies: string[] = [];
    if (input.durationMs >= input.slowCallMs) anomalies.push('slow_call');
    if (input.aborted) anomalies.push('aborted');
    if (shape.malformed) anomalies.push('malformed_result');
    else if (shape.empty) anomalies.push('empty_result');
    if (shape.bytes >= LARGE_OUTPUT_BYTES) anomalies.push('large_output');

    // An outright failure is an error however odd its result looked; a call that neither failed nor
    // answered properly — nothing in the content, a shape no client can read, a client that gave up
    // waiting — is what `unexpected` is for. Slowness and bulk stay anomalies on a successful call:
    // they say something about the call, not about whether it worked.
    const status: CallStatus = failure
        ? 'error'
        : shape.malformed || shape.empty || input.aborted
          ? 'unexpected'
          : 'success';

    // Written in declaration order, and an absent field left out rather than set to null: these
    // lines are read raw as often as they are queried, and a line should read as a sentence.
    return {
        timestamp: input.timestamp,
        server: input.serverName,
        tool_name: input.toolName,
        ...(input.requestId !== undefined && { request_id: input.requestId }),
        ...(input.sessionId && { session_id: input.sessionId }),
        duration_ms: Math.round(input.durationMs * 1000) / 1000,
        status,
        arguments: sanitizeArguments(input.args),
        input_bytes: byteLength(input.args),
        output_bytes: shape.bytes,
        ...tokenFields(input.usage),
        ...(anomalies.length > 0 && { anomalies }),
        ...(failure !== undefined && { error: describeError(failure) }),
    };
}

/** The three token fields, present only for a call that reported upstream usage. */
function tokenFields(usage: TokenUsage | undefined): Partial<CallRecord> {
    const { inputTokens, outputTokens, totalTokens } = usage ?? {};
    const total = totalTokens
        ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
    return {
        ...(inputTokens !== undefined && { input_tokens: inputTokens }),
        ...(outputTokens !== undefined && { output_tokens: outputTokens }),
        ...(total !== undefined && { total_tokens: total }),
    };
}

interface ResultShape {
    isError: boolean;
    /** Answered, but with nothing in it. */
    empty: boolean;
    /** Not a tool result at all — no content array, no structured content. */
    malformed: boolean;
    /** First text block, the only description of a failure left when nothing reported the error. */
    text: string;
    bytes: number;
}

/** Read the result the way a client would, and note where it stops making sense. */
function inspectResult(result: unknown): ResultShape {
    const bytes = byteLength(result);
    if (!result || typeof result !== 'object') {
        return { isError: false, empty: false, malformed: true, text: '', bytes };
    }
    const { content, structuredContent, isError } = result as {
        content?: unknown;
        structuredContent?: unknown;
        isError?: unknown;
    };
    if (!Array.isArray(content)) {
        const malformed = structuredContent === undefined;
        return { isError: isError === true, empty: false, malformed, text: '', bytes };
    }
    const texts = content
        .map((block) => (block as { text?: unknown } | null)?.text)
        .filter((text): text is string => typeof text === 'string');
    return {
        isError: isError === true,
        empty: content.length === 0 || (texts.length === content.length && texts.every((text) => text.trim() === '')),
        malformed: false,
        text: texts[0] ?? '',
        bytes,
    };
}

const describeError = (error: unknown): { name?: string; message: string; stack?: string } =>
    error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: typeof error === 'string' ? error : safeJson(error) };

/**
 * A sample of what the call was given: long strings cut, long arrays cut, anything that looks like
 * a credential dropped. A `files_write` carries a whole document and a `unit_create` a whole
 * lesson; keeping them verbatim would make the log larger than the store it describes, and the
 * question this answers is *which* call it was, not what it wrote.
 */
export function sanitizeArguments(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') {
        return value.length <= MAX_STRING ? value : `${value.slice(0, MAX_STRING)}…(+${value.length - MAX_STRING} chars)`;
    }
    if (Array.isArray(value)) {
        if (depth >= MAX_DEPTH) return `[array(${value.length})]`;
        const kept = value.slice(0, MAX_ARRAY).map((item) => sanitizeArguments(item, depth + 1));
        return value.length > MAX_ARRAY ? [...kept, `…(+${value.length - MAX_ARRAY} more)`] : kept;
    }
    if (value && typeof value === 'object') {
        if (depth >= MAX_DEPTH) return '[object]';
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [
                key,
                SECRET_KEY.test(key) ? '[redacted]' : sanitizeArguments(nested, depth + 1),
            ]),
        );
    }
    return value;
}

/** Serialization that cannot throw — a cycle or a BigInt in a payload must not cost the line. */
function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return '';
    }
}

const byteLength = (value: unknown): number => (value === undefined ? 0 : Buffer.byteLength(safeJson(value)));

// ── The file ────────────────────────────────────────────────────────────────

/** One append at a time, so two calls finishing together cannot interleave halfway through a line. */
let tail: Promise<void> = Promise.resolve();
/** `mkdir` per directory, done once. Dropped on failure, so one that becomes writable is picked up. */
const directoriesReady = new Map<string, Promise<void>>();

const ensureDirectory = (directory: string): Promise<void> => {
    const existing = directoriesReady.get(directory);
    if (existing) return existing;
    const created = mkdir(directory, { recursive: true }).then(() => undefined);
    directoriesReady.set(directory, created);
    return created;
};

/** Queue one line. Returns immediately; the caller is a response on its way out. */
function schedule(directory: string, build: () => CallRecord): void {
    tail = tail
        .then(async () => {
            const record = build();
            // A file per day: the log rotates by itself, and a day of a turn's work is one grep.
            const file = join(directory, `${record.timestamp.slice(0, 10)}.jsonl`);
            await ensureDirectory(directory);
            await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
        })
        .catch(() => {
            directoriesReady.delete(directory);
        });
}

/** Wait for every queued line to land. For the tests — a turn never needs it. */
export const flushLog = (): Promise<void> => tail;
