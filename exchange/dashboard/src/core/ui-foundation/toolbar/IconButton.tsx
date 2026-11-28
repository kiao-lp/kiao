import React, { forwardRef } from 'react';
import { Button, type ButtonProps } from 'antd';
import { Tooltip, type AppTooltipProps } from '../feedback/Tooltip';

type Presentation = {
    type?: ButtonProps['type'];
    size?: ButtonProps['size'];
    danger?: boolean;
    loading?: ButtonProps['loading'];
} | {
    type: 'plain';
    size?: never;
    danger?: never;
    loading?: never;
};

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title' | 'type' | 'color' | 'aria-label'> & Presentation & {
    label: string;
    icon: React.ReactNode;
    /** Supply a description, or use true to show the accessible name. */
    tooltip?: React.ReactNode;
    placement?: AppTooltipProps['placement'];
};

const tooltipTriggers: AppTooltipProps['trigger'] = ['hover', 'focus'];

interface TooltipAnchorProps extends React.HTMLAttributes<HTMLSpanElement> {
    button: React.ReactElement<React.AriaAttributes>;
    disabled?: boolean;
}

// Keep the anchor and the button mounted when availability changes.
const TooltipAnchor = forwardRef<HTMLSpanElement, TooltipAnchorProps>(({
    button, disabled, 'aria-describedby': tooltipId, ...props
}, ref) => (
    <span {...props} ref={ref} style={{ display: 'inline-flex' }} onClick={disabled ? event => {
        event.preventDefault();
        event.stopPropagation();
    } : undefined}>
        {React.cloneElement(button, {
            'aria-describedby': [button.props['aria-describedby'], tooltipId].filter(Boolean).join(' ') || undefined,
        })}
    </span>
));

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({
    label, icon, tooltip, placement, type = 'text', size = 'small', danger, loading, disabled, style, ...props
}, ref) => {
    const description = tooltip === true ? label : tooltip;
    const hasTooltip = description != null && description !== false;
    const attributes = {
        ...props, ref, disabled, 'aria-label': label,
        style: disabled && hasTooltip ? { ...style, pointerEvents: 'none' as const } : style,
    };
    const button = type === 'plain'
        ? <button {...attributes} type="button">{icon}</button>
        : <Button {...attributes} type={type} size={size} danger={danger} loading={loading} icon={icon} />;

    if (!hasTooltip) return button;

    return (
        <Tooltip title={description} placement={placement} trigger={tooltipTriggers}>
            <TooltipAnchor button={button} disabled={disabled} />
        </Tooltip>
    );
});

IconButton.displayName = 'IconButton';
