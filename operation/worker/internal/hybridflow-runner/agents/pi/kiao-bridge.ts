// KIAO bridge 1.0.0, qualified with Pi RPC 1.2.0 and 1.3.0.
// The hub owns approval deadlines; questions always retain their own response protocol.
export default function kiaoBridge(pi) {
    pi.on('tool_call', async (event, ctx) => {
        if (event.toolName === 'ask_user' || process.env.KIAO_PI_PERMISSION_MODE === 'bypassPermissions') return;
        const allowed = await ctx.ui.confirm('kiao.permission', JSON.stringify({
            tool: event.toolName, input: event.input, toolUseId: event.toolCallId,
        }));
        if (!allowed) return { block: true, reason: 'The user declined this tool call.' };
    });
    pi.registerTool({
        name: 'ask_user', label: 'Ask user', exposure: 'model-only',
        description: 'Ask the user a question. Wait for their answer before continuing.',
        parameters: {
            type: 'object', properties: {
                question: { type: 'string' },
                options: { type: 'array', items: { type: 'string' } },
            }, required: ['question'],
        },
        async execute(_id, input, _signal, _onUpdate, ctx) {
            const answer = await ctx.ui.input('kiao.question', JSON.stringify(input));
            return { content: [{ type: 'text', text: answer ?? 'The question was dismissed.' }] };
        },
    });
}
