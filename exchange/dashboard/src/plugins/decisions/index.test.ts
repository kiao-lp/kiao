import { describe, it, expect } from 'vitest';
import { plugin } from './index';
import { DECISIONS_TAB_ID, DECISION_SOURCES_TAB_ID } from './constants';

describe('decisions plugin', () => {
    it('offers a persistent panel and a sources panel in the tools menu', () => {
        expect(plugin.toolBars?.map(tab => tab.id)).toEqual([DECISIONS_TAB_ID]);
        expect((plugin.toolsMenuItems ?? []).map(item => [item.id, item.label, item.panel.label]))
            .toEqual([[DECISION_SOURCES_TAB_ID, 'Decision sources…', 'Decision sources']]);
    });
});
