import React from 'react';
import { IconButton } from '../toolbar/IconButton';
import { Select, Flex } from 'antd';
import { RedoOutlined } from '@ant-design/icons';

const DEFAULT_ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const percentage = (zoom: number) => `${Math.round(zoom * 100)}%`;

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
                aria-label="Zoom"
                value={zoom}
                onChange={onZoomChange}
                size="small"
                style={{ width: 'auto' }}
                popupMatchSelectWidth={false}
                disabled={disabled}
                labelRender={() => percentage(zoom)}
                options={zoomLevels.map(level => ({ value: level, label: percentage(level) }))}
            />
            <IconButton
                label="Reset zoom to 100%"
                type="default"
                icon={<RedoOutlined />}
                onClick={handleResetZoom}
                disabled={disabled || zoom === 1.0}
            />
        </Flex>
    );
};
