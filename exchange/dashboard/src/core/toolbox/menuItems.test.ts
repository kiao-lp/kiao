import { describe, it, expect } from 'vitest';
import { harnessProfilesMenuItem, configurationMenuItem, toolboxMenuItems } from './menuItems';
import { HARNESS_PROFILES_TAB_ID, TOOLBOX_TAB_ID } from './panelIds';

describe('toolbox menu items', () => {
    it('offers configuration and Pi profiles as tools menu panels', () => {
        expect(toolboxMenuItems).toEqual([configurationMenuItem, harnessProfilesMenuItem]);
        expect([configurationMenuItem, harnessProfilesMenuItem].map(item => [item.id, item.label, item.panel.label]))
            .toEqual([
                [TOOLBOX_TAB_ID, 'Configuration…', 'Configuration'],
                [HARNESS_PROFILES_TAB_ID, 'Pi profiles…', 'Pi profiles'],
            ]);
    });
});
