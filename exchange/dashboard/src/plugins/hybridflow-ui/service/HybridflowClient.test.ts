import { afterEach, describe, expect, it, vi } from 'vitest';
import { HybridflowClient } from './HybridflowClient';

describe('HybridflowClient', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('reads boards from the store itself', async () => {
        const fetched = vi.fn(async () => new Response(
            JSON.stringify({ boards: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', fetched);
        const client = new HybridflowClient('http://localhost/api/hybridflow', () => undefined);

        await client.boards();

        expect(fetched).toHaveBeenCalledWith(
            'http://localhost/api/hybridflow/boards',
            expect.objectContaining({ cache: 'no-store' }),
        );
    });
});
