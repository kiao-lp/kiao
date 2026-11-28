import React, { useId, useRef, useState } from 'react';
import { Popover } from 'antd';
import type { KiaoTheme } from 'kiao-style';
import { KEEP_MENU_IN_VIEWPORT } from '../interactions/menuPlacement';

export interface DiagramSize {
    width: number;
    height: number;
}

const presets = [
    { name: 'Small', width: 640, height: 480 },
    { name: 'Medium', width: 925, height: 768 },
    { name: 'Large', width: 1280, height: 960 },
    { name: 'Wide', width: 1600, height: 900 },
    { name: 'XL', width: 1920, height: 1080 },
];

const dimensions = ({ width, height }: DiagramSize) => `${width}×${height}`;
const presetLabel = (preset: typeof presets[number]) => `${preset.name} (${dimensions(preset)})`;
const parseDimension = (text: string) => text.trim() ? Number(text) : NaN;

export function DiagramSizePicker({ size, onChange, theme, placement = 'bottom' }: {
    size: DiagramSize;
    onChange: (size: DiagramSize) => void;
    theme: KiaoTheme;
    placement?: 'top' | 'bottom';
}) {
    const [open, setOpen] = useState(false);
    const [width, setWidth] = useState('');
    const [height, setHeight] = useState('');
    const trigger = useRef<HTMLButtonElement>(null);
    const firstPreset = useRef<HTMLButtonElement>(null);
    const id = useId();
    const currentPreset = presets.find(preset => preset.width === size.width && preset.height === size.height);
    const customWidth = parseDimension(width);
    const customHeight = parseDimension(height);
    const valid = Number.isFinite(customWidth) && Number.isFinite(customHeight);

    const changeOpen = (next: boolean) => {
        if (next) {
            setWidth(String(size.width));
            setHeight(String(size.height));
        }
        setOpen(next);
    };

    const close = () => {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
    };

    const apply = (next: DiagramSize) => {
        onChange(next);
        close();
    };

    const dismiss = (event: React.KeyboardEvent) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        close();
    };

    return (
        <Popover
            trigger="click"
            placement={placement}
            autoAdjustOverflow={KEEP_MENU_IN_VIEWPORT.autoAdjustOverflow}
            arrow={false}
            open={open}
            onOpenChange={changeOpen}
            afterOpenChange={visible => {
                if (visible && trigger.current === document.activeElement) {
                    firstPreset.current?.focus({ preventScroll: true });
                }
            }}
            destroyOnHidden
            styles={{ container: { padding: 0 } }}
            content={(
                <div id={id} role="group" aria-label="Diagram dimensions" className="diagram-size-picker"
                    data-theme={theme} onKeyDown={dismiss}>
                    {presets.map((preset, index) => (
                        <button key={preset.name} ref={index === 0 ? firstPreset : undefined} type="button"
                            className="diagram-size-preset" aria-pressed={preset === currentPreset}
                            onClick={() => apply({ width: preset.width, height: preset.height })}>
                            {presetLabel(preset)}
                        </button>
                    ))}
                    <form className="diagram-size-custom" noValidate onSubmit={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (valid) apply({
                            width: Math.max(100, Math.trunc(customWidth)),
                            height: Math.max(100, Math.trunc(customHeight)),
                        });
                    }}>
                        <div className="diagram-size-fields">
                            <label>
                                W <input type="number" aria-label="Width" value={width}
                                    onChange={event => setWidth(event.target.value)} />
                            </label>
                            <label>
                                H <input type="number" aria-label="Height" value={height}
                                    onChange={event => setHeight(event.target.value)} />
                            </label>
                        </div>
                        <button type="submit" disabled={!valid}>Apply</button>
                    </form>
                </div>
            )}
        >
            <button type="button" ref={trigger} className="diagram-toolbar-btn diagram-size-label"
                aria-label="Diagram size" aria-expanded={open} aria-controls={open ? id : undefined} onKeyDown={dismiss}>
                {currentPreset ? presetLabel(currentPreset) : dimensions(size)}
            </button>
        </Popover>
    );
}
