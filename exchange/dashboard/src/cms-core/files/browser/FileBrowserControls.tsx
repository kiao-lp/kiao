import React from 'react';
import { Button } from 'antd';
import { Tooltip } from '../../ui/Tooltip';
import { CheckSquareOutlined, ReloadOutlined } from '@ant-design/icons';
import { NewButtonCmp } from './NewButton-cmp';
import { ViewModeSwitch } from '../view-mode/ViewModeSwitch';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useRefreshFileList } from '../core/CurrentFileList-ctx';
import { useIsCoarsePointer } from './useLongPress';

export const FileBrowserControls: React.FC = () => {
    const selection = useFileSelection();
    const isCoarse = useIsCoarsePointer();
    const refreshFileList = useRefreshFileList();

    return (
        <>
            {isCoarse && (
                <Tooltip title={selection.selectMode ? 'Exit select mode' : 'Enter select mode'}>
                    <Button
                        type={selection.selectMode ? 'primary' : 'text'}
                        size="small"
                        icon={<CheckSquareOutlined />}
                        onClick={() => selection.setSelectMode(!selection.selectMode)}
                        data-testid="select-mode-toggle"
                    />
                </Tooltip>
            )}
            <Tooltip title="Refresh file list">
                <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => void refreshFileList()}
                    aria-label="Refresh file list"
                    data-testid="refresh-file-list"
                />
            </Tooltip>
            <ViewModeSwitch />
            <NewButtonCmp />
        </>
    );
};
