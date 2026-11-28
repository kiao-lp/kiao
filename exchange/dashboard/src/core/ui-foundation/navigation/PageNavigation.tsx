import React from 'react';
import { CommitInput } from '../forms/CommitInput';
import { IconButton } from '../toolbar/IconButton';
import { Flex } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';

/** Follows the current page except while a draft page number is being entered. */
export const PageNavigation: React.FC<{
    page: number;
    numPages: number;
    onGoTo: (pageNumber: number) => void;
}> = ({ page, numPages, onGoTo }) => {
    const commit = (value: string) => {
        const wanted = Number.parseInt(value, 10);
        if (Number.isFinite(wanted)) onGoTo(Math.min(Math.max(wanted, 1), numPages));
    };

    return (
        <Flex gap={4} align="center">
            <IconButton
                label="Previous page"
                type="default"
                icon={<UpOutlined />}
                disabled={page <= 1}
                onClick={() => onGoTo(page - 1)}
            />
            <CommitInput
                style={{ width: 52, textAlign: 'center' }}
                value={String(page || '')}
                onCommit={commit}
                preserveDraft
                disabled={!numPages}
                aria-label="Page number"
            />
            <span style={{ whiteSpace: 'nowrap' }}>/ {numPages || '--'}</span>
            <IconButton
                label="Next page"
                type="default"
                icon={<DownOutlined />}
                disabled={!numPages || page >= numPages}
                onClick={() => onGoTo(page + 1)}
            />
        </Flex>
    );
};
