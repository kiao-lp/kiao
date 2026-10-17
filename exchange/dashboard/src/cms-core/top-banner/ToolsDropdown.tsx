import React, { useCallback, useState } from 'react';
import { Button, Dropdown, Flex, MenuProps, message, Modal } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { AppstoreOutlined, CopyOutlined, DownloadOutlined, MoreOutlined, PieChartOutlined, SettingOutlined } from '@ant-design/icons';
import { themeMode } from 'kiao-style';
import { useTheme } from '../../ThemeContext';
import { themeMenuItems, themeMenuKey, themeModeIcon } from './themeMenu';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { DiskUsage, WorkerClient } from 'src/cms-core/files/service';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';
import { useGitDiffOptional } from '../toolbar/GitDiff-ctx';
import { useDashboardConfig } from '../config/DashboardConfig-ctx';
import { useShowMenuItems } from './ShowMenu';
import { useToolBarsOptional } from '../tool-bars/ToolBars-ctx';
import { TOOLBOX_TAB_ID } from '../toolbox';
// The context module by name, not the folder's barrel: the barrel also exports the view, whose
// own top banner draws this dropdown — an import cycle for the sake of one shorter path.
import { useFileOptimizationsViewOptional } from '../file-optimizations/FileOptimizations-ctx';
import { storeLinkOf } from 'kiao-worker/utils';
import { useAppRoutes } from '../app-routes';

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
    const location = useLocation();
    const navigate = useNavigate();
    // The pages plugins own that are not documents. Each one that says how it is reached
    // gets an entry here, so claiming a URL prefix is also the way in to it.
    const pages = useAppRoutes();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const gitDiff = useGitDiffOptional();
    const { gitEnabled } = useDashboardConfig();
    // Where each tool bar tab is drawn, or whether it is drawn at all — see top-banner/ShowMenu.tsx.
    const showItems = useShowMenuItems();
    // The configuration panel is a tab like any other, so the menu entry only has to put it in
    // front — back into the layout if it had been taken out, and its side switched on.
    const bars = useToolBarsOptional();
    // File optimizations is not a tab but an application mode over the central area, so its entry
    // switches that mode on rather than placing a panel — see cms-core/file-optimizations.
    const optimizations = useFileOptimizationsViewOptional();

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

    const handleCopyMarkdownLink = async () => {
        const title = document.title;
        // useLocation() is already stripped of the router basename, so this is the stored form:
        // no domain, no context path, and correct wherever the app is served from next.
        const url = location.pathname + location.search + location.hash;
        const markdown = `[${title}](${url})`;
        await navigator.clipboard.writeText(markdown);
        message.success('Link copied!');
    };

    // The store's one way of naming a document is the link form — from the root, with the leading
    // slash that tells a reference apart from a document-relative one (`storeLinkOf`,
    // kiao-worker/utils.ts). A path copied here is pasted into a document, so it is copied as that.
    const handleCopyPath = async () => {
        if (!currentFile) return;
        await navigator.clipboard.writeText(storeLinkOf(currentFile.path));
        message.success('Path copied!');
    };

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

    const items: MenuProps['items'] = [
        ...(extraItems && extraItems.length > 0
            ? [...extraItems, { type: 'divider' as const }]
            : []),
        {
            key: 'copy-markdown-link',
            icon: <CopyOutlined />,
            label: 'Copy markdown link',
            onClick: handleCopyMarkdownLink,
        },
        {
            key: 'copy-path',
            icon: <CopyOutlined />,
            label: 'Copy path',
            onClick: handleCopyPath,
            disabled: !currentFile || currentFile.isDirectory,
        },
        { type: 'divider' },
        ...(bars
            ? [{
                key: 'configuration',
                icon: <SettingOutlined />,
                label: 'Configuration…',
                onClick: () => bars.showTab(TOOLBOX_TAB_ID),
            }]
            : []),
        ...(optimizations
            ? [{
                key: 'file-optimizations',
                icon: <PieChartOutlined />,
                label: 'File optimizations…',
                onClick: optimizations.show,
            }]
            : []),
        // The pages that are not documents. Before the Show menu, because they are places to go
        // rather than ways to arrange where you already are. A page whose menu names a tab opens
        // that lateral panel instead of navigating — the list lives in the panel, and the prefix
        // is only what its rows link to.
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
        ...(showItems && showItems.length > 0 ? [...showItems, { type: 'divider' as const }] : []),
        ...(gitEnabled
            ? [
                {
                    key: 'git-pull',
                    icon: <DownloadOutlined />,
                    label: 'Git pull',
                    onClick: handleGitPull,
                    disabled: gitPulling,
                },
                { type: 'divider' as const },
            ]
            : []),
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
        ...(diskLabel
            ? [
                { type: 'divider' as const },
                {
                    key: 'disk',
                    label: <span style={{ fontSize: '0.85em', cursor: 'default' }}>{diskLabel}</span>,
                    onClick: undefined,
                },
            ]
            : []),
    ];

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
