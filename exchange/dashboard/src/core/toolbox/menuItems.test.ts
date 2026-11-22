import { describe, it, expect } from 'vitest';
import { toolboxMenuItems } from './menuItems';
import { HARNESS_PROFILES_TAB_ID, TOOLBOX_TAB_ID } from './panelIds';

describe('toolbox menu items', () => {
    it('offers configuration, installed harnesses and Pi setup in Tools', () => {
        const items = toolboxMenuItems([{ value: 'codex', label: 'Codex' }]);
        expect(items.map(item => [item.id, item.label, item.panel.label]))
            .toEqual([
                [TOOLBOX_TAB_ID, 'Configuration…', 'Configuration'],
                ['harness-models-codex', 'Codex (harness)…', 'Codex (harness)'],
                [HARNESS_PROFILES_TAB_ID, 'Pi (harness)…', 'Pi (harness)'],
            ]);
    });
});
