import React, { useCallback, useState } from 'react';
import { Button, Dropdown, Flex, MenuProps, message, Modal } from 'antd';
import { Tooltip } from '../../ui-foundation/feedback/Tooltip';
import { ApiOutlined, AppstoreOutlined, DownloadOutlined, MoreOutlined, SettingOutlined } from '@ant-design/icons';
import { themeMode } from 'kiao-style';
import { useTheme } from '../../ui-foundation/theme/ThemeContext';
import { themeMenuItems, themeMenuKey, themeModeIcon } from './themeMenu';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { DiskUsage, WorkerClient } from 'src/cms-core/files/service';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGitDiffOptional } from '../../git/GitDiff-ctx';
import { useDashboardConfig } from '../../config/DashboardConfig-ctx';
import { useShowMenuItems } from './ShowMenu';
import { useToolBarsOptional } from '../toolbars/ToolBars-ctx';
import { AGENT_PROFILES_TAB_ID, TOOLBOX_TAB_ID } from '../../toolbox';
import { useToolsMenu } from './ToolsMenu-ctx';
import { useAppRoutes } from '../../app-routes';

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

const unicodeChars = [
    '⚠️', '🔍', '🧠', '✔️', '❌', '❓', '❗', '⭐', '🔥', '💡',
    '🔎', '✅', '⚙️', '🧩', '📦', '🔗', '🐳', '🌐', '💬',
    '☒', '☐', '▣', '⚠', '📍', '📧', '▶️', '📹', '★', '🌍',
    '🇬🇧', '🇺🇸', '🇨🇳', '🇩🇪', '🇫🇷', '🇨🇭',
    '📐', '🎨', '🖥️', '</>', '🏡'
];

export interface ToolsDropdownProps {
    /** Extra menu items contributed by the currently active plugin, shown above the common tools. */
    extraItems?: MenuProps['items'];
}

export const ToolsDropdown: React.FC<ToolsDropdownProps> = ({ extraItems }) => {
    const { theme, setTheme } = useTheme();
    const workerClient = useWorkerClient();
    const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null);
    const [gitPulling, setGitPulling] = useState(false);
    const navigate = useNavigate();
    // The pages plugins own that are not documents. Each one that says how it is reached
    // gets an entry here, so claiming a URL prefix is also the way in to it.
    const pages = useAppRoutes();
    const gitDiff = useGitDiffOptional();
    const { gitEnabled } = useDashboardConfig();
    const showItems = useShowMenuItems();
    const bars = useToolBarsOptional();
    const tools = useToolsMenu();

    useEffect(() => {
        const fetchDiskUsage = async () => {
            try {
                const fs = workerClient as WorkerClient;
                if (fs.getDiskUsage) {
                    const usage = await fs.getDiskUsage();
                    setDiskUsage(usage);
                }
            } catch (e) {
                console.error('Failed to fetch disk usage', e);
            }
        };
        fetchDiskUsage();
    }, [workerClient]);

    const handleGitPull = useCallback(async () => {
        if (gitPulling) return;
        setGitPulling(true);
        try {
            const r = await workerClient.gitPull();
            if (r.ok) {
                message.success({ content: 'Git pull ✓', duration: 2 });
            } else {
                Modal.error({ title: 'Git pull failed', content: <pre className="git-output">{r.output}</pre> });
            }
        } catch (e: any) {
            message.error(`Git pull failed: ${e?.message ?? e}`);
        } finally {
            setGitPulling(false);
            gitDiff?.requestRefresh();
        }
    }, [gitPulling, workerClient, gitDiff]);

    const diskLabel = diskUsage
        ? (() => {
            const usedSpace = diskUsage.totalSpace - diskUsage.freeSpace;
            const pct = diskUsage.totalSpace > 0
                ? Math.round((usedSpace / diskUsage.totalSpace) * 100)
                : 0;
            return `Disk: ${pct}% (${formatBytes(usedSpace)} / ${formatBytes(diskUsage.totalSpace)})`;
        })()
        : null;

    const unicodePalette = (
        <Flex gap="small" wrap="wrap" style={{ maxWidth: '200px' }}>
            {unicodeChars.map(char => (
                <Button key={char} size="small" onClick={() => navigator.clipboard.writeText(char)}>
                    {char}
                </Button>
            ))}
        </Flex>
    );

    type Section = NonNullable<MenuProps['items']>;
    const sections: Section[] = [];
    if (extraItems && extraItems.length > 0) sections.push(extraItems);
    // The pages that are not documents. Before the Show menu, because they are places to go
    // rather than ways to arrange where you already are. A page whose menu names a tab opens
    // that lateral panel instead of navigating.
    const destinations: Section = [
        ...(bars
            ? [{
                key: 'configuration',
                icon: <SettingOutlined />,
                label: 'Configuration…',
                onClick: () => bars.showTab(TOOLBOX_TAB_ID),
            }, {
                key: 'pi-profiles',
                icon: <ApiOutlined />,
                label: 'Pi profiles…',
                onClick: () => bars.showTab(AGENT_PROFILES_TAB_ID),
            }]
            : []),
        ...(tools?.items ?? []).map(item => ({
            key: `plugin-tool-${item.id}`,
            icon: item.icon,
            label: item.label,
            disabled: !tools?.openPanel,
            onClick: () => tools?.openPanel?.({ ...item.panel, id: item.id }),
        })),
        ...pages.filter(page => page.menu).map(page => ({
            key: `page-${page.prefix}`,
            icon: page.menu!.icon,
            label: page.menu!.label,
            onClick: () => {
                const tabId = page.menu!.showTab;
                if (tabId && bars) bars.showTab(tabId);
                else navigate(page.prefix);
            },
        })),
    ];
    if (destinations.length > 0) sections.push(destinations);
    if (showItems && showItems.length > 0) sections.push(showItems);
    if (gitEnabled) {
        sections.push([{
            key: 'git-pull',
            icon: <DownloadOutlined />,
            label: 'Git pull',
            onClick: handleGitPull,
            disabled: gitPulling,
        }]);
    }
    sections.push([
        {
            key: 'theme',
            icon: <span>{themeModeIcon(themeMode(theme))}</span>,
            label: 'Theme',
            children: themeMenuItems(setTheme),
        },
        {
            key: 'unicode',
            icon: <AppstoreOutlined />,
            label: 'Unicode Palette',
            children: [
                {
                    key: 'unicode-palette',
                    label: unicodePalette,
                    style: {
                        height: 'auto',
                        lineHeight: 'normal',
                        padding: 8,
                        cursor: 'default',
                        backgroundColor: 'transparent',
                    },
                },
            ],
        },
    ]);
    if (diskLabel) {
        sections.push([{
            key: 'disk',
            label: <span style={{ fontSize: '0.85em', cursor: 'default' }}>{diskLabel}</span>,
        }]);
    }
    const items: MenuProps['items'] = sections.flatMap((section, index) =>
        index === 0 ? section : [{ type: 'divider' as const, key: `sep-${index}` }, ...section],
    );

    return (
        <Dropdown
            // Selection is the theme's alone: `selectedKeys` is ours to hold, so clicking any
            // other entry leaves it where it is.
            menu={{ items, selectable: true, selectedKeys: [themeMenuKey(theme)] }}
            trigger={['click']}
            placement="bottomRight"
        >
            <Tooltip title="Tools">
                <Button type="text" size="small" icon={<MoreOutlined />} />
            </Tooltip>
        </Dropdown>
    );
};
