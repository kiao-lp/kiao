import React from 'react';
import type { MenuProps } from 'antd';
import { KIAO_THEMES, type KiaoTheme, type ThemeMode } from 'kiao-style';

/** A theme is offered under the brightness it wears. */
export const themeModeIcon = (mode: ThemeMode): string => (mode === 'dark' ? '🌙' : '☀️');

/** The menu key a theme is offered under, and what marks it as the one in use. */
export const themeMenuKey = (theme: KiaoTheme): string => `theme-${theme}`;

/**
 * The charter's themes as menu entries.
 *
 * The list is kiao-style's, not this menu's: nothing here knows how many themes there are, so
 * one added to the charter is offered without a change. It replaces the light/dark toggle this
 * entry used to be — with four themes there is no next one to flip to.
 *
 * Which one is in use is left to the menu's `selectedKeys` rather than written into a label:
 * a label that changes with the state is a label that cannot be clicked by name.
 */
export const themeMenuItems = (
    setTheme: (next: KiaoTheme) => void,
): NonNullable<MenuProps['items']> =>
    KIAO_THEMES.map(({ id, label, mode }) => ({
        key: themeMenuKey(id),
        icon: <span>{themeModeIcon(mode)}</span>,
        label,
        onClick: () => setTheme(id),
    }));
