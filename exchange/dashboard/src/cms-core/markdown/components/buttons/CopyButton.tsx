import React, { useCallback, useState } from 'react';
import { Tooltip } from '../../../ui/Tooltip';

export const CopyButton: React.FC<{ code: string }> = ({ code }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [code]);

    return (
        <Tooltip title="Copy code">
            <button
                type="button"
                onClick={handleCopy}
                className="code-copy-btn"
                aria-label="Copy code"
            >
                {copied ? '✓' : '⎘'}
            </button>
        </Tooltip>
    );
};
