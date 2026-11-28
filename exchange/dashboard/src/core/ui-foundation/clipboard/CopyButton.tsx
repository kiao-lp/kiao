import React, { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { IconButton, type IconButtonProps } from '../toolbar/IconButton';
import { IconCheck, IconCopy } from '../toolbar/icons';
import { setClipboard } from './clipboard';
import './CopyButton.css';

type CopyTextButtonProps<T = IconButtonProps> = T extends IconButtonProps
    ? Omit<T, 'icon' | 'onClick'> & {
        text: string;
        icon?: React.ReactNode;
        successMessage?: string;
        errorMessage?: string;
    }
    : never;

export function CopyTextButton({
    text, icon = <IconCopy />, tooltip, successMessage,
    errorMessage = 'Could not copy to the clipboard', ...button
}: CopyTextButtonProps) {
    const [copied, setCopied] = useState(false);
    const latestAttempt = useRef(0);
    const timer = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => () => {
        latestAttempt.current++;
        clearTimeout(timer.current);
    }, []);

    const copy = async () => {
        const attempt = ++latestAttempt.current;
        clearTimeout(timer.current);
        setCopied(false);
        try {
            await setClipboard(text);
        } catch {
            if (attempt === latestAttempt.current) message.error(errorMessage);
            return;
        }
        if (attempt !== latestAttempt.current) return;
        setCopied(true);
        if (successMessage) message.success(successMessage);
        timer.current = setTimeout(() => setCopied(false), 1500);
    };

    return (
        <>
            <IconButton {...button} icon={copied ? <IconCheck /> : icon}
                tooltip={copied && tooltip ? 'Copied' : tooltip} onClick={copy} />
            {!successMessage && <span className="ui-copy-status" aria-live="polite">{copied && 'Copied'}</span>}
        </>
    );
}

export const CopyButton: React.FC<{ code: string; label?: string; className?: string }> = ({
    code, label = 'Copy code', className = 'ui-copy-button',
}) => <CopyTextButton text={code} label={label} className={className} type="plain" />;
