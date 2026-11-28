import React from 'react';
import { Space } from 'antd';
import { IconButton } from '@kiao-dashboard-core';
import { EditOutlined, FileAddOutlined } from '@ant-design/icons';

export type TemplateEditMode = 'edit' | 'instantiate';

interface TemplateStatusBarProps {
    mode: TemplateEditMode;
    setMode: (mode: TemplateEditMode) => void;
}

export const TemplateStatusBar: React.FC<TemplateStatusBarProps> = ({ mode, setMode }) => {

    const navigationButtons = (
        <Space size={2}>
            <IconButton
                label="Modify Template"
                type={mode === 'edit' ? 'primary' : 'text'}
                icon={<EditOutlined />}
                onClick={() => setMode('edit')}
            />
            <IconButton
                label="Instantiate Template"
                tooltip
                type={mode === 'instantiate' ? 'primary' : 'text'}
                icon={<FileAddOutlined />}
                onClick={() => setMode('instantiate')}
            />
        </Space>
    );

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {navigationButtons}
        </div>
    );
};
