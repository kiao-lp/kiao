import type { DropdownProps } from 'antd';

/**
 * Shifts menus into view and removes the 4px anchor gap. Menus taller than
 * the viewport still overflow; if antd drops the shift keys, only flipping remains.
 */
export const KEEP_MENU_IN_VIEWPORT = {
    autoAdjustOverflow: { adjustX: 1, adjustY: 1, shiftX: true, shiftY: true },
    align: { offset: [0, 0] },
} as Partial<DropdownProps>;
