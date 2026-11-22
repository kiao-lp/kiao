import { describe, it, expect } from 'vitest';
import { plugin } from './index';
import { BOARDS_PREFIX } from './boardRoute';
import { AGENTS_TAB_ID, BOARD_TAB_ID, RUNNERS_TAB_ID } from './constants';

describe('hybridflow plugin', () => {
    it('claims the boards prefix, with no entry in the `...` menu', () => {
        expect(plugin.appRoutes).toHaveLength(1);
        const [page] = plugin.appRoutes ?? [];
        expect(page.prefix).toBe(BOARDS_PREFIX);
        expect(page.panel).toBe(BOARD_TAB_ID);
        expect(page.menu).toBeUndefined();
    });

    it('claims no file type at all', () => {
        expect(plugin.fileConfigFor).toBeUndefined();
        expect(plugin.fileExtensions).toBeUndefined();
    });

    it('keeps its tool bar tabs, boards included', () => {
        expect((plugin.toolBars ?? []).map(tab => tab.title))
            .toEqual(['Board', 'Node', 'Workflow', 'Chain runs', 'Boards', 'Conversations', 'Usage']);
    });

    it('keeps board editing available when conversation execution is disabled', () => {
        const config = { plugins: ['hybridflow'], gitEnabled: true, chatEnabled: false };
        expect(plugin.toolBars?.filter(tab => tab.isEnabled?.(config) ?? true).map(tab => tab.title))
            .toEqual(['Board', 'Node', 'Workflow', 'Boards']);
    });

    it('offers agents and runners as tools menu panels', () => {
        expect((plugin.toolsMenuItems ?? []).map(item => [item.id, item.label, item.panel.label]))
            .toEqual([
                ['agentic-resources', 'Agentic resources…', 'Agentic resources'],
                [AGENTS_TAB_ID, 'Agents…', 'Agents'],
                [RUNNERS_TAB_ID, 'Runners…', 'Runners'],
            ]);
    });

    it('offers a movable board panel in the central area by default', () => {
        const board = plugin.toolBars?.find(tab => tab.id === BOARD_TAB_ID);
        expect(board?.defaultBar).toBe('center');
        expect(board?.pinned).toBeFalsy();
        expect(board?.additionalPanels).toBeDefined();
    });
});
