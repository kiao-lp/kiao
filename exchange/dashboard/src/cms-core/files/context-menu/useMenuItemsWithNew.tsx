import { useMemo } from 'react';
import { MenuProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { parentPath } from '../service';
import { useCreationCommands } from '../creation/CreationCommandRegistry-ctx';

type MenuItems = NonNullable<MenuProps['items']>;

/**
 * A context menu, closed by a "New" submenu offering the same choices as the New button of
 * the navigation bar. `targetPath` is the folder they create in — the browsed folder when
 * left out. The submenu is dropped when no plugin offers anything to create.
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
 * The folder a context menu opened on `path` creates in: inside a folder, and beside a file —
 * which is not always the browsed folder, since a menu may be opened on a row the browsed
 * folder does not hold (the tree pane, a search hit).
 */
export const creationTargetOf = (path: string, isDirectory: boolean): string =>
    isDirectory ? path : parentPath(path);
