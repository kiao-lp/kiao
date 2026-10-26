#!/usr/bin/env node
// Deterministic RPC peer, using real 1.3 record shapes. No network, credentials or npm install.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
if (process.argv.includes('--version')) { process.stdout.write('1.3.0\n'); process.exit(0); }
const arg = flag => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const dir = process.env.PI_CODING_AGENT_DIR;
const providers = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8')).providers;
const models = Object.entries(providers).flatMap(([provider, connection]) => connection.models.map(model => ({ ...model, provider, name: model.name || model.id, input: model.input || ['text'] })));
let model = models[0], effort = 'off', session = arg('--session') || path.join(arg('--session-dir'), `${randomUUID()}.jsonl`);
let entries = fs.existsSync(session) ? fs.readFileSync(session, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type !== 'session') : [];
let streaming = false, following = [], steering = [], timer, currentPrompt = '', cost = 0, count = 0;
let dialogs = new Map();
const send = record => process.stdout.write(`${JSON.stringify(record)}\n`);
const response = (request, data = {}, success = true, error) => send({ type: 'response', id: request.id, command: request.type, success, data, error });
const persist = () => {
    fs.mkdirSync(path.dirname(session), { recursive: true });
    fs.writeFileSync(session, `${JSON.stringify({ type: 'session', version: 3, id: path.basename(session), cwd: process.cwd() })}\n${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`);
};
const entry = message => {
    const id = randomUUID(); entries.push({ type: 'message', id, parentId: entries.at(-1)?.id ?? null, message }); persist();
    send({ type: 'message_start', message }); send({ type: 'message_end', message }); return id;
};
const queue = () => send({ type: 'queue_update', steering: [...steering], followUp: [...following] });
const finish = (aborted = false) => {
    if (!streaming) return;
    streaming = false; clearTimeout(timer);
    if (!aborted) {
        count++; cost += 0.001;
        const content = [{ type: 'text', text: `Pi ✓\u2028${model.provider}/${model.id}: ${currentPrompt}` }];
        entry({ role: 'assistant', content, stopReason: 'stop' });
    }
    send({ type: 'agent_end', messages: [] });
    if (following.length && !aborted) {
        const next = following.shift(); queue(); start(next); return;
    }
    send({ type: 'agent_settled', aborted });
};
const start = text => {
    streaming = true; currentPrompt = text; send({ type: 'agent_start' });
    entry({ role: 'user', content: [{ type: 'text', text }] });
    const diagnostic = process.env.KIAO_TEST_PI_DIAGNOSTIC || ({ 'diagnostic-crash': 'crash', 'diagnostic-api-error': 'api-error-exit' })[model.id];
    if (text === 'Reply with OK.' && diagnostic) {
        if (diagnostic === 'api-error-exit') {
            send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: `401 Invalid API key: ${process.env.KIAO_PI_KEY_0}` } });
            send({ type: 'message_end', message: { role: 'user' } });
        }
        if (diagnostic === 'empty-success') { send({ type: 'agent_settled' }); return; }
        if (diagnostic === 'invalid-json') { process.stdout.write('this is not JSON\n'); return; }
        process.stderr.write(`TypeError: simulated Pi crash using ${process.env.KIAO_PI_KEY_0}\n`);
        if (diagnostic === 'large-stderr') process.stderr.write('stack frame\n'.repeat(2000));
        process.exitCode = 7;
        process.stdin.destroy();
        return;
    }
    if (text.startsWith('descendant')) {
        const child = spawn('sleep', ['100'], { detached: true, stdio: 'ignore' }); child.unref();
        fs.writeFileSync(process.env.KIAO_TEST_PI_CHILD_PID, String(child.pid));
        if (text === 'descendant-crash') process.exit(4);
    }
    if (text === 'crash') { process.exit(4); }
    if (text === 'question' || text === 'permission') {
        const id = randomUUID(); dialogs.set(id, text);
        send({ type: 'extension_ui_request', id, method: text === 'permission' ? 'confirm' : 'input',
            title: text === 'permission' ? 'kiao.permission' : 'kiao.question',
            message: JSON.stringify({ tool: 'bash', input: { command: 'true' }, toolUseId: 'call-1' }),
            placeholder: JSON.stringify({ question: 'Choose a colour', options: ['Blue', 'Red'] }) }); return;
    }
    if (text === 'tools') {
        for (const [id, name] of [['parent','codemode'], ['parent/1','mcp__fixture__echo'], ['parent/2','bash']]) {
            send({ type: 'tool_execution_start', toolCallId: id, toolName: name, args: { text: 'héllo' } });
            send({ type: 'tool_execution_end', toolCallId: id, toolName: name, result: { content: [{ type: 'text', text: id }] }, isError: id.endsWith('/2') });
        }
    }
    if (text === 'retry') {
        entry({ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'temporarily unavailable' });
        send({ type: 'agent_end', messages: [] });
        send({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 30, errorMessage: 'temporarily unavailable' });
        timer = setTimeout(() => { send({ type: 'auto_retry_end', success: true, attempt: 2 }); finish(); }, 60); return;
    }
    if (text === 'failure') {
        entry({ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'persistent failure' });
        send({ type: 'agent_end', messages: [] }); streaming = false;
        send({ type: 'agent_settled', aborted: false }); return;
    }
    timer = setTimeout(() => finish(), (text.includes('slow') || text === 'descendant-stop') ? 3000 : 15);
};
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
    for (;;) {
        const index = input.indexOf('\n'); if (index < 0) break;
        const line = input.slice(0, index); input = input.slice(index + 1);
        if (!line.trim()) continue;
        const request = JSON.parse(line);
        if (process.env.KIAO_TEST_PI_COMMAND_LOG) fs.appendFileSync(process.env.KIAO_TEST_PI_COMMAND_LOG, `${request.type}\n`);
        switch (request.type) {
            case 'get_state': response(request, { sessionFile: session, sessionId: path.basename(session), model, isStreaming: streaming, thinkingLevel: effort }); break;
            case 'get_entries': response(request, { entries, leafId: entries.at(-1)?.id ?? null }); break;
            case 'get_available_models': response(request, { models }); break;
            case 'get_available_thinking_levels': response(request, { levels: model.reasoning ? ['off', 'low', 'high'] : ['off'] }); break;
            case 'set_model':
                if (process.env.KIAO_TEST_PI_DIAGNOSTIC === 'reject-model') { response(request, {}, false, 'model configuration is invalid'); break; }
                model = models.find(model => model.provider === request.provider && model.id === request.modelId); response(request, model, !!model, 'model unavailable'); break;
            case 'set_thinking_level': effort = request.level; response(request); break;
            case 'get_session_stats': response(request, { tokens: { input: count * 20, output: count * 10, cacheRead: count * 5, cacheWrite: 0 }, cost }); break;
            case 'get_commands': response(request, { commands: [] }); break;
            case 'clone': session = path.join(arg('--session-dir'), `${randomUUID()}.jsonl`); persist(); response(request, { cancelled: false }); break;
            case 'fork': {
                const index = entries.findIndex(entry => entry.id === request.entryId && entry.message?.role === 'user');
                if (index < 0) { response(request, {}, false, 'invalid fork entry'); break; }
                entries = entries.slice(0, index); session = path.join(arg('--session-dir'), `${randomUUID()}.jsonl`); persist(); response(request, { cancelled: false }); break;
            }
            case 'prompt': response(request, { disposition: 'started' }); start(request.message); break;
            case 'steer': steering.push(request.message); queue(); response(request, { disposition: 'queued' }); break;
            case 'follow_up': following.push(request.message); queue(); response(request, { disposition: 'queued' }); break;
            case 'clear_queue': {
                const data = { steering: [...steering], followUp: [...following] }; steering = []; following = []; queue(); response(request, data); break;
            }
            case 'abort': dialogs.clear(); finish(true); response(request); break;
            case 'compact':
                send({ type: 'compaction_start', reason: 'manual' }); count++; cost += 0.002;
                send({ type: 'compaction_end', reason: 'manual', result: { summary: 'fixture summary' }, aborted: false, willRetry: false });
                response(request, { summary: 'fixture summary' }); break;
            case 'extension_ui_response': {
                const kind = dialogs.get(request.id); dialogs.delete(request.id);
                if (kind) { currentPrompt = request.value || (request.confirmed ? 'allowed' : 'declined'); finish(); } break;
            }
            default: response(request);
        }
    }
});
process.stdin.on('end', () => { clearTimeout(timer); process.exit(0); });
