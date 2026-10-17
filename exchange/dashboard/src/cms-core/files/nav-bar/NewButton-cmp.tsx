import React, { useMemo } from 'react';
import { Button, Dropdown, MenuProps } from 'antd';
import { Tooltip } from '../../ui/Tooltip';
import { PlusOutlined } from '@ant-design/icons';
import { useCreationCommands } from '../creation/CreationCommandRegistry-ctx';

export type NewButtonPlacement = 'nav' | 'toolbar';

export type NewButtonProps = {
    placement?: NewButtonPlacement;
};

export const NewButtonCmp: React.FC<NewButtonProps> = ({ placement = 'nav' }) => {
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
            <Tooltip title="New">
                <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    className="cms-new-button"
                    data-testid={`new-button-${placement}`}
                />
            </Tooltip>
        </Dropdown>
    );
};
