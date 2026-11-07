import { useMemo } from 'react';
import { MenuProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { parentPath } from '../service';
import { useCreationCommands } from '../creation/CreationCommandRegistry-ctx';

type MenuItems = NonNullable<MenuProps['items']>;

/**
 * Appends a New submenu with the navigation bar's creation commands, in
 * targetPath or the browsed folder. Omits it when no command is available.
 */
export const useMenuItemsWithNew = (items: MenuProps['items'], targetPath?: string): MenuItems => {
    const commands = useCreationCommands(targetPath);

    return useMemo(() => {
        const result: MenuItems = items ? [...items] : [];
        if (commands.length === 0) return result;

        if (result.length > 0) result.push({ type: 'divider', key: 'sep-new' });
        result.push({
            key: 'new',
            label: 'New',
            icon: <PlusOutlined />,
            children: commands.map(cmd => ({
                key: `new:${cmd.id}`,
                icon: cmd.icon,
                label: cmd.label,
                onClick: (e) => { e.domEvent.stopPropagation(); cmd.execute(); },
            })),
        });
        return result;
    }, [items, commands]);
};

/**
 * Returns path if a folder, else its parent. May differ from the browsed
 * folder (tree pane, search hit).
 */
export const creationTargetOf = (path: string, isDirectory: boolean): string =>
    isDirectory ? path : parentPath(path);
