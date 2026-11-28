import React from 'react';
import { IconButton } from '../../ui-foundation/toolbar/IconButton';
import { CheckSquareOutlined, ReloadOutlined } from '@ant-design/icons';
import { NewButtonCmp } from './NewButton-cmp';
import { ViewModeSwitch } from '../view-mode/ViewModeSwitch';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useRefreshFileList } from '../core/CurrentFileList-ctx';
import { useIsCoarsePointer } from '../../ui-foundation/interactions/useLongPress';

export const FileBrowserControls: React.FC = () => {
    const selection = useFileSelection();
    const isCoarse = useIsCoarsePointer();
    const refreshFileList = useRefreshFileList();

    return (
        <>
            {isCoarse && (
                <IconButton
                    label={selection.selectMode ? 'Exit select mode' : 'Enter select mode'}
                    type={selection.selectMode ? 'primary' : 'text'}
                    icon={<CheckSquareOutlined />}
                    onClick={() => selection.setSelectMode(!selection.selectMode)}
                    data-testid="select-mode-toggle"
                />
            )}
            <IconButton
                label="Refresh file list"
                icon={<ReloadOutlined />}
                onClick={() => void refreshFileList()}
                data-testid="refresh-file-list"
            />
            <ViewModeSwitch />
            <NewButtonCmp />
        </>
    );
};
