import { HolderOutlined } from '@ant-design/icons';
import { Tooltip } from '../feedback/Tooltip';
import type { ReorderHandleProps } from './useReorderable';

import './reorder.css';

/** Drag grip and keyboard control: arrows move one place, Home/End move to an end. `label` is the accessible name and tooltip. */
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
            {/* A disabled button fires no mouse events; the span carries the hover. */}
            {disabled ? <span style={{ display: 'inline-flex' }}>{grip}</span> : grip}
        </Tooltip>
    );
};
