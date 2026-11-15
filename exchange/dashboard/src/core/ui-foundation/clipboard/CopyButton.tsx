import React, { useCallback, useState } from 'react';
import './CopyButton.css';

export const CopyButton: React.FC<{ code: string; label?: string; className?: string }> = ({
    code, label = 'Copy code', className = 'ui-copy-button',
}) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [code]);

    return (
        <button
            type="button"
            onClick={handleCopy}
            className={className}
            aria-label={label}
        >
            {copied ? '✓' : '⎘'}
        </button>
    );
};
