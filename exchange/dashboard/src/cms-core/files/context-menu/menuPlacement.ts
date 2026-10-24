import type { DropdownProps } from 'antd';

/**
 * Flipping alone can place tall menus above the viewport. Shift back into view and remove the
 * 4px anchor gap; menus taller than the viewport still overflow.
 * The assertion covers loosely typed align and untyped shift keys forwarded to
 * @rc-component/trigger. If Ant Design stops forwarding them, only flipping remains.
 */
export const KEEP_MENU_IN_VIEWPORT = {
    autoAdjustOverflow: { adjustX: 1, adjustY: 1, shiftX: true, shiftY: true },
    align: { offset: [0, 0] },
} as Partial<DropdownProps>;
