import { HolderOutlined } from '@ant-design/icons';
import { Tooltip } from '@cms-core';
import type { ReorderHandleProps } from './useReorderable';

import './reorder.css';

/**
 * The grip a row is dragged by — and, because it is a real button, the row's keyboard reordering
 * too: focus it and use ↑ ↓ to move the row one place, Home / End to send it to an end.
 *
 * A plain `<button>` rather than an antd one: it carries a cursor, a drag gesture and no click,
 * which is the opposite of what a Button is styled and wired for.
 *
 * `label` names the row it belongs to — it is both the accessible name and the tooltip, so it is
 * written in whatever language the surrounding screen speaks.
 */
export const ReorderHandle: React.FC<ReorderHandleProps & { label: string }> = (
    { label, dragging, disabled, ...handlers },
) => {
    const grip = (
        <button
            type="button"
            className={`kiao-reorder-handle${dragging ? ' is-dragging' : ''}`}
            aria-label={label}
            disabled={disabled}
            {...handlers}
        >
            <HolderOutlined />
        </button>
    );
    return (
        <Tooltip title={label}>
            {/* A disabled button fires no mouse events, so the tooltip would never open on it
                directly — the span carries the hover. */}
            {disabled ? <span style={{ display: 'inline-flex' }}>{grip}</span> : grip}
        </Tooltip>
    );
};
