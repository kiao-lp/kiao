import { describe, it, expect } from 'vitest';
import { plugin } from './index';
import { TAGS_TAB_ID } from './constants';

describe('tags plugin', () => {
    it('offers its panel as a tools menu panel', () => {
        expect(plugin.toolBars).toBeUndefined();
        expect((plugin.toolsMenuItems ?? []).map(item => [item.id, item.label, item.panel.label]))
            .toEqual([[TAGS_TAB_ID, 'Tags…', 'Tags']]);
    });
});
