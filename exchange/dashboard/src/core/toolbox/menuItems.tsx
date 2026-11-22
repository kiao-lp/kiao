import React, { useEffect, useMemo, useState } from 'react';
import { ApiOutlined, SettingOutlined } from '@ant-design/icons';
import type { HarnessOption } from 'kiao-worker';
import { stackPanelItem, type ToolsMenuItemDeclaration } from '../extensibility/FileBasedPlugin';
import { useWorkerClient } from '../files/service/ui';
import { lazyComponent } from '../ui-foundation/react/lazyComponent';
import { TOOLBOX_CHANGED_EVENT } from './events';
import { HARNESS_PROFILES_TAB_ID, TOOLBOX_TAB_ID, harnessPanelId } from './panelIds';

const ToolboxPanel = lazyComponent(() => import('./ToolboxPanel').then(m => ({ default: m.ToolboxPanel })));
const HarnessProfilesPanel = lazyComponent(() => import('./HarnessProfilesPanel').then(m => ({ default: m.HarnessProfilesPanel })));
const HarnessModelsPanel = lazyComponent(() => import('./HarnessModelsPanel').then(m => ({ default: m.HarnessModelsPanel })));

export const configurationMenuItem: ToolsMenuItemDeclaration = stackPanelItem({
    id: TOOLBOX_TAB_ID,
    title: 'Configuration',
    icon: <SettingOutlined />,
    content: <ToolboxPanel />,
});

export const harnessProfilesMenuItem: ToolsMenuItemDeclaration = stackPanelItem({
    id: HARNESS_PROFILES_TAB_ID,
    title: 'Pi (harness)',
    icon: <ApiOutlined />,
    content: <HarnessProfilesPanel />,
});

export const toolboxMenuItems = (harnesses: HarnessOption[]): ToolsMenuItemDeclaration[] => [
    configurationMenuItem,
    ...harnesses.map(({ value, label }) => {
        const title = `${value === 'claude' ? 'Claude Code' : label} (harness)`;
        const item = stackPanelItem({
            id: harnessPanelId(value),
            title,
            icon: <ApiOutlined />,
            content: <HarnessModelsPanel key={value} harness={value} />,
        });
        return { ...item, panel: { ...item.panel, title } };
    }),
    harnessProfilesMenuItem,
];

export const useToolboxMenuItems = (): ToolsMenuItemDeclaration[] => {
    const client = useWorkerClient();
    const [harnesses, setHarnesses] = useState<HarnessOption[]>([]);
    useEffect(() => {
        let generation = 0;
        const refresh = async () => {
            const current = ++generation;
            try {
                const installed = await client.getConfigurableHarnesses();
                if (generation === current) setHarnesses(installed);
            } catch {
                // The configuration and Pi setup panels are also available on older workers.
            }
        };
        void refresh();
        window.addEventListener(TOOLBOX_CHANGED_EVENT, refresh);
        return () => {
            generation++;
            window.removeEventListener(TOOLBOX_CHANGED_EVENT, refresh);
        };
    }, [client]);
    return useMemo(() => toolboxMenuItems(harnesses), [harnesses]);
};
