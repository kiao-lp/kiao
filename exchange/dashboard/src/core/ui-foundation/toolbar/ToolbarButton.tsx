import React from 'react';

export interface ToolbarButtonProps {
    text: string;
    onClick: () => void;
    icon: React.ReactNode;
    prefix: string;
    className?: string;
}

export const ToolbarButton: React.FC<ToolbarButtonProps> = ({ text, onClick, icon, prefix, className }) => (
    <button aria-label={text} className={`${prefix}-toolbar-btn${className ? ` ${className}` : ''}`} onClick={onClick}>
        {icon}
    </button>
);
