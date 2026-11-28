import React from 'react';
import { IconButton, type IconButtonProps } from './IconButton';

export interface ToolbarButtonProps extends Pick<IconButtonProps, 'icon' | 'tooltip' | 'disabled'> {
    text: string;
    onClick: () => void;
    prefix: string;
    className?: string;
    active?: boolean;
}

export const ToolbarButton: React.FC<ToolbarButtonProps> = ({ text, prefix, className, active, ...props }) => {
    const base = `${prefix}-toolbar-btn`;
    const classes = [base, active && `${base}--active`, className].filter(Boolean).join(' ');
    return <IconButton type="plain" label={text} className={classes} aria-pressed={active} placement="bottom" {...props} />;
};
