import { afterEach, expect, it, vi } from 'vitest';
import { ResourceClient } from './Client';

afterEach(() => vi.unstubAllGlobals());

it('explains a gateway failure when the resource manager cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));
    const client = new ResourceClient('/api/agentic', () => undefined);

    await expect(client.createAgent({ repository: 'agent.git', name: '', harness: '' })).rejects.toThrow(
        'The Dashboard cannot reach the resource manager. Check its service URL and that it is running.',
    );
});
