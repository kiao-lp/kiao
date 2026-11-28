import { HolderOutlined } from '@ant-design/icons';
import { IconButton } from '../toolbar/IconButton';
import type { ReorderHandleProps } from './useReorderable';

import './reorder.css';

/** Drag grip and keyboard control: arrows move one place, Home/End move to an end. `label` is the accessible name. */
export const ReorderHandle: React.FC<ReorderHandleProps & { label: string }> = ({ label, dragging, ...props }) => (
    <IconButton type="plain" label={label} icon={<HolderOutlined />}
        aria-keyshortcuts="ArrowUp ArrowDown Home End"
        className={`kiao-reorder-handle${dragging ? ' is-dragging' : ''}`} {...props} />
);
