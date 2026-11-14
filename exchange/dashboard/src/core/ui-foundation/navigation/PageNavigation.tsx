import React, { useState } from 'react';
import { Button, Flex, Input } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';

/** Follows the current page except while a draft page number is being entered. */
export const PageNavigation: React.FC<{
    page: number;
    numPages: number;
    onGoTo: (pageNumber: number) => void;
}> = ({ page, numPages, onGoTo }) => {
    const [draft, setDraft] = useState<string | null>(null);

    const commit = () => {
        if (draft === null) return;
        const wanted = Number.parseInt(draft, 10);
        setDraft(null);
        if (Number.isFinite(wanted)) onGoTo(Math.min(Math.max(wanted, 1), numPages));
    };

    return (
        <Flex gap={4} align="center">
            <Button
                size="small"
                icon={<UpOutlined />}
                disabled={page <= 1}
                onClick={() => onGoTo(page - 1)}
                aria-label="Previous page"
            />
            <Input
                size="small"
                style={{ width: 52, textAlign: 'center' }}
                value={draft ?? (page || '')}
                onFocus={() => setDraft(String(page || ''))}
                onChange={event => setDraft(event.target.value)}
                onPressEnter={commit}
                onBlur={commit}
                disabled={!numPages}
                aria-label="Page number"
            />
            <span style={{ whiteSpace: 'nowrap' }}>/ {numPages || '--'}</span>
            <Button
                size="small"
                icon={<DownOutlined />}
                disabled={!numPages || page >= numPages}
                onClick={() => onGoTo(page + 1)}
                aria-label="Next page"
            />
        </Flex>
    );
};
