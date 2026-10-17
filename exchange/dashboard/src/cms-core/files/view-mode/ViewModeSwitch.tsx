import React from 'react';
import { Segmented } from 'antd';
import { Tooltip } from '../../ui/Tooltip';
import { UnorderedListOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useViewMode, ViewMode } from './ViewMode-ctx';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';

export const ViewModeSwitch: React.FC = () => {
    const { currentPath } = useFileBrowsingPersistenceContext();
    const { mode, setMode } = useViewMode(currentPath);

    return (
        <Segmented<ViewMode>
            size="small"
            value={mode}
            onChange={setMode}
            data-testid="view-mode-switch"
            options={[
                {
                    value: 'details',
                    className: 'cms-view-mode-details',
                    label: <Tooltip title="Details"><UnorderedListOutlined /></Tooltip>,
                },
                {
                    value: 'grid',
                    className: 'cms-view-mode-grid',
                    label: <Tooltip title="Grid"><AppstoreOutlined /></Tooltip>,
                },
            ]}
        />
    );
};
