import React from 'react';
import { Tooltip } from '../feedback/Tooltip';

export interface ToolbarButtonProps {
    text: string;
    onClick: () => void;
    icon: React.ReactNode;
    prefix: string;
    className?: string;
}

export const ToolbarButton: React.FC<ToolbarButtonProps> = ({ text, onClick, icon, prefix, className }) => (
    <Tooltip title={text} placement="bottom">
        <button className={`${prefix}-toolbar-btn${className ? ` ${className}` : ''}`} onClick={onClick}>
            {icon}
        </button>
    </Tooltip>
);
