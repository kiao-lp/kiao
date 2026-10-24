import React from 'react';
import { Flex, Slider } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { ZoomInOutlined } from '@ant-design/icons';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, useZoomTargetOptional } from './ZoomTarget-ctx';

const percent = (factor: number) => Math.round(factor * 100);

/**
 * The banner's magnifier, shown only while something is selected.
 *
 * It appears where it does — in the one bar that is on screen whatever the open document is —
 * because the thing it magnifies may belong to a panel, a preview or a chat, and none of those own
 * a place to put a control. The bar is also the reason a magnified element never covers it.
 */
export const ZoomSlider: React.FC = () => {
    const zoom = useZoomTargetOptional();
    if (!zoom?.element) return null;

    return (
        <Tooltip title="Zoom the selected element. Escape, or Ctrl-click it again, puts it back.">
            <Flex align="center" gap={6} className="cms-zoom-slider">
                <ZoomInOutlined />
                <Slider
                    min={percent(MIN_ZOOM)}
                    max={percent(MAX_ZOOM)}
                    step={percent(ZOOM_STEP)}
                    value={percent(zoom.factor)}
                    onChange={value => zoom.setFactor(value / 100)}
                    tooltip={{ formatter: value => `${value}%` }}
                    ariaLabelForHandle="Zoom the selected element"
                    style={{ width: 140, margin: 0 }}
                />
                <span className="cms-zoom-readout">{percent(zoom.factor)}%</span>
            </Flex>
        </Tooltip>
    );
};
