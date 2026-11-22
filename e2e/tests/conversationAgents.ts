import { expect, type APIRequestContext, type Page, workerApi } from './harness';

export const removeTestAgent = async (request: APIRequestContext, id: string) => {
    const url = `${workerApi()}/agentic-resources-api/agents/${id}`;
    const status = await request.get(`${url}/deletion`);
    if (status.status() === 404) return;
    expect(status.ok(), await status.text()).toBe(true);
    const { confirmation } = await status.json();
    const removed = await request.delete(`${url}?confirmation=${encodeURIComponent(confirmation)}`);
    expect(removed.ok(), await removed.text()).toBe(true);
};

export const publishTestAgent = async (
    request: APIRequestContext,
    definition: { name: string; harness: string; model: string; effort?: string; profileId?: string; instructions?: string },
    skill?: string,
): Promise<{ id: string; name: string; published: { commit: string; version: string } }> => {
    const endpoint = `${workerApi()}/agentic-resources-api/agents`;
    const created = await request.post(endpoint, { data: { effort: 'low', ...definition } });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = await created.json();
    try {
        if (skill) {
            const linked = await request.put(`${endpoint}/${id}/skills/${encodeURIComponent(skill)}`);
            expect(linked.ok(), await linked.text()).toBe(true);
        }
        const published = await request.post(`${endpoint}/${id}/publish`, { data: {} });
        expect(published.ok(), await published.text()).toBe(true);
        return published.json();
    } catch (error) {
        await removeTestAgent(request, id);
        throw error;
    }
};

export const chooseConversationAgent = async (page: Page, agentName: string, column?: string) => {
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New conversation' });
    const row = dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: agentName, exact: true }) });
    // Choosing the cell is the whole gesture: the conversation is created from it.
    await (column ? row.getByRole('button', { name: `${agentName} · ${column}`, exact: true }) : row.getByRole('button').first()).click();
};
