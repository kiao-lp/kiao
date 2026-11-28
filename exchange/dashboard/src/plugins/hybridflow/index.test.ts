import { describe, it, expect } from 'vitest';
import { plugin } from './index';
import { BOARDS_PREFIX, TASKS_PREFIX } from './boardRoute';
import { AGENTIC_RESOURCES_PANEL_ID, BOARD_TAB_ID, RUNNERS_TAB_ID } from './constants';

describe('hybridflow plugin', () => {
    it('opens board and task routes in the Board panel', () => {
        expect(plugin.appRoutes?.map(({ prefix, panel, menu }) => ({ prefix, panel, menu }))).toEqual([
            { prefix: BOARDS_PREFIX, panel: BOARD_TAB_ID, menu: undefined },
            { prefix: TASKS_PREFIX, panel: BOARD_TAB_ID, menu: undefined },
        ]);
    });

    it('claims no file type at all', () => {
        expect(plugin.fileConfigFor).toBeUndefined();
        expect(plugin.fileExtensions).toBeUndefined();
    });

    it('keeps its tool bar tabs, boards included', () => {
        expect((plugin.toolBars ?? []).map(tab => tab.title))
            .toEqual(['Board', 'Flow node', 'Workflow', 'Chain runs', 'Boards', 'Conversations', 'Usage']);
    });

    it('keeps board editing available when conversation execution is disabled', () => {
        const config = { plugins: ['hybridflow'], gitEnabled: true, chatEnabled: false };
        expect(plugin.toolBars?.filter(tab => tab.isEnabled?.(config) ?? true).map(tab => tab.title))
            .toEqual(['Board', 'Flow node', 'Workflow', 'Boards']);
    });

    it('offers the resource catalogue, legacy editor and runners in the Tools menu', () => {
        expect((plugin.toolsMenuItems ?? []).map(item => [item.id, item.label, item.panel.label]))
            .toEqual([
                [AGENTIC_RESOURCES_PANEL_ID, 'Agentic resources…', 'Agentic resources'],
                ['agentic-resources', 'Agentic resources (legacy)…', 'Agentic resources (legacy)'],
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
