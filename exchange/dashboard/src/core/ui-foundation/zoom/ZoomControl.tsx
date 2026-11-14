import React from 'react';
import { Button, Select, Flex } from 'antd';
import { RedoOutlined } from '@ant-design/icons';

const DEFAULT_ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

interface ZoomControlProps {
    zoom: number;
    onZoomChange: (zoom: number) => void;
    zoomLevels?: number[];
    disabled?: boolean;
    className?: string;
}

export const ZoomControl: React.FC<ZoomControlProps> = ({
    zoom,
    onZoomChange,
    zoomLevels = DEFAULT_ZOOM_LEVELS,
    disabled = false,
    className
}) => {
    const handleResetZoom = () => {
        onZoomChange(1.0);
    };

    // No fixed width: the box fits the percentage, and the popup sizes to its content.
    return (
        <Flex gap="small" align="center" className={className}>
            <Select
                value={zoom}
                onChange={onZoomChange}
                size="small"
                style={{ width: 'auto' }}
                popupMatchSelectWidth={false}
                disabled={disabled}
                options={zoomLevels.map(level => ({
                    value: level,
                    label: `${Math.round(level * 100)}%`
                }))}
            />
            <Button
                size="small"
                icon={<RedoOutlined />}
                onClick={handleResetZoom}
                aria-label="Reset zoom to 100%"
                disabled={disabled || zoom === 1.0}
            />
        </Flex>
    );
};
