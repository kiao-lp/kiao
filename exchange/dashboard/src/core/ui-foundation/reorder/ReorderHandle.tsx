import { HolderOutlined } from '@ant-design/icons';
import type { ReorderHandleProps } from './useReorderable';

import './reorder.css';

/** Drag grip and keyboard control: arrows move one place, Home/End move to an end. `label` is the accessible name. */
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
    return grip;
};
