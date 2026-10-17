import React from 'react';
import { Button, ColorPicker, Flex, InputNumber, Segmented, Select } from 'antd';
import { FormatPainterOutlined } from '@ant-design/icons';
import { Tooltip, useSelectionContext } from '@cms-core';
import { ZoomControl } from '@cms-kit/zoom-control';
import { NewShapeKind, SvgViewMode, useSvgStateContext } from '../state';
import { useApplyStyleToSelection } from '../hooks/useShapes';

/**
 * The look a new shape is born with — its kind, fill, stroke and stroke weight. Shapes come
 * in series, so it is set once here rather than on each shape, the mindmap note style's own
 * rule. The brush hands that same look to the shapes already drawn and selected.
 */
export const NewShapeControl: React.FC = () => {
    const { newShapeStyle, patchNewShapeStyle, mode } = useSvgStateContext();
    const [selection] = useSelectionContext();
    const applyStyleToSelection = useApplyStyleToSelection();

    const selectProps = {
        size: 'small' as const,
        style: { width: 'auto' } as React.CSSProperties,
        popupMatchSelectWidth: false,
        disabled: mode !== 'canvas',
    };

    return (
        <Flex gap={4} align="center" className="svg-new-shape-style">
            <Select
                {...selectProps}
                value={newShapeStyle.kind}
                onChange={(kind: NewShapeKind) => patchNewShapeStyle({ kind })}
                title="Kind of a new shape"
                options={[
                    { value: 'rect', label: 'Rectangle' },
                    { value: 'circle', label: 'Circle' },
                    { value: 'ellipse', label: 'Ellipse' },
                    { value: 'line', label: 'Line' },
                    { value: 'text', label: 'Text' },
                ]}
            />
            <Tooltip title="Fill of a new shape">
                <ColorPicker
                    size="small"
                    value={newShapeStyle.fill}
                    disabled={mode !== 'canvas'}
                    onChange={color => patchNewShapeStyle({ fill: `#${color.toHex()}` })}
                />
            </Tooltip>
            <Tooltip title="Stroke of a new shape">
                <ColorPicker
                    size="small"
                    value={newShapeStyle.stroke}
                    disabled={mode !== 'canvas'}
                    onChange={color => patchNewShapeStyle({ stroke: `#${color.toHex()}` })}
                />
            </Tooltip>
            <Select
                {...selectProps}
                value={newShapeStyle.strokeWidth}
                onChange={(strokeWidth: number) => patchNewShapeStyle({ strokeWidth })}
                title="Stroke weight of a new shape"
                options={[1, 2, 3, 4, 6, 8].map(width => ({ value: width, label: `${width}px` }))}
            />
            <Tooltip title="Apply this style to the selected shapes">
                <Button
                    size="small"
                    type="text"
                    icon={<FormatPainterOutlined />}
                    disabled={mode !== 'canvas' || selection.length === 0}
                    onClick={applyStyleToSelection}
                    aria-label="Apply this style to the selected shapes"
                />
            </Tooltip>
        </Flex>
    );
};

export const SvgZoomControl: React.FC = () => {
    const { zoom, setZoom, mode } = useSvgStateContext();
    return <ZoomControl zoom={zoom} onZoomChange={setZoom} disabled={mode !== 'canvas'} className="svg-zoom-control" />;
};

/**
 * Canvas or source, and — on the canvas — the size the drawing is. The size is document
 * data, written to `width`/`height`: what an exported SVG opens at.
 */
export const SvgViewControl: React.FC = () => {
    const { document, setCanvas, saveSvg, mode, setMode } = useSvgStateContext();
    const canvas = document?.drawing.canvas ?? { width: 800, height: 600 };

    return (
        <Flex gap={4} align="center" className="svg-view-control">
            <Segmented
                size="small"
                value={mode}
                onChange={value => setMode(value as SvgViewMode)}
                options={[
                    { value: 'canvas', label: 'Canvas' },
                    { value: 'source', label: 'Source' },
                ]}
            />
            <Tooltip title="Canvas width in SVG units">
                <InputNumber
                    size="small"
                    value={canvas.width}
                    min={1}
                    max={10000}
                    disabled={mode !== 'canvas' || !document}
                    onChange={width => {
                        if (typeof width === 'number' && document) {
                            setCanvas({ ...document.drawing.canvas, width });
                            saveSvg();
                        }
                    }}
                   aria-label="Canvas width"
                />
            </Tooltip>
            <Tooltip title="Canvas height in SVG units">
                <InputNumber
                    size="small"
                    value={canvas.height}
                    min={1}
                    max={10000}
                    disabled={mode !== 'canvas' || !document}
                    onChange={height => {
                        if (typeof height === 'number' && document) {
                            setCanvas({ ...document.drawing.canvas, height });
                            saveSvg();
                        }
                    }}
                    aria-label="Canvas height"
                />
            </Tooltip>
        </Flex>
    );
};
