import React from 'react';
import { Space, Button } from 'antd';
import { Tooltip } from '@cms-core';
import { EditOutlined, FileAddOutlined } from '@ant-design/icons';

export type TemplateEditMode = 'edit' | 'instantiate';

interface TemplateStatusBarProps {
    mode: TemplateEditMode;
    setMode: (mode: TemplateEditMode) => void;
}

export const TemplateStatusBar: React.FC<TemplateStatusBarProps> = ({ mode, setMode }) => {

    const navigationButtons = (
        <Space size={2}>
            <Tooltip title="Modify Template">
                <Button
                    type={mode === 'edit' ? 'primary' : 'text'}
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setMode('edit')}
                />
            </Tooltip>
            <Tooltip title="Instantiate Template">
                <Button
                    type={mode === 'instantiate' ? 'primary' : 'text'}
                    size="small"
                    icon={<FileAddOutlined />}
                    onClick={() => setMode('instantiate')}
                />
            </Tooltip>
        </Space>
    );

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {navigationButtons}
        </div>
    );
};
