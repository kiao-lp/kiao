import React, { useMemo } from 'react';
import { IconButton } from '../../ui-foundation/toolbar/IconButton';
import { Dropdown, MenuProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCreationCommands } from '../creation/CreationCommandRegistry-ctx';

export const NewButtonCmp: React.FC = () => {
    const commands = useCreationCommands();

    const items: MenuProps['items'] = useMemo(() => commands.map(cmd => ({
        key: cmd.id,
        icon: cmd.icon,
        label: cmd.label,
        onClick: () => { cmd.execute(); },
    })), [commands]);

    if (items.length === 0) return null;

    return (
        <Dropdown menu={{ items }} trigger={['click']} placement="bottomLeft">
            <IconButton
                label="New"
                icon={<PlusOutlined />}
                className="cms-new-button"
                data-testid="new-button-toolbar"
            />
        </Dropdown>
    );
};
