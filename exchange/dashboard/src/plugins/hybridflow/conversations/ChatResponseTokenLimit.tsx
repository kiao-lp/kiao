import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Dropdown } from 'antd';
import { DownOutlined } from '@ant-design/icons';

const GRID_SIZE = 4;
const FIBONACCI_MULTIPLIER = 8n;
const choices: (string | undefined)[] = [undefined];
let current = 1n;
let next = 2n;
while (choices.length < GRID_SIZE * GRID_SIZE) {
    choices.push((current * FIBONACCI_MULTIPLIER).toString());
    [current, next] = [next, current + next];
}

const scientific = new Intl.NumberFormat('en', { notation: 'scientific', maximumSignificantDigits: 3 });
const choiceLabel = (value: string | undefined) => {
    if (value === undefined) return 'None';
    return value.length <= 4 ? value : scientific.format(BigInt(value));
};

interface ChatResponseTokenLimitProps {
    value: string | undefined;
    onChange: (value: string | undefined) => void;
    disabled: boolean;
}

export function ChatResponseTokenLimit({ value, onChange, disabled }: ChatResponseTokenLimitProps) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const gridId = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const grid = useRef<HTMLTableElement>(null);
    const visible = open && !disabled;
    const selected = choices.indexOf(value);
    useEffect(() => {
        if (disabled) {
            setOpen(false);
            return;
        }
        if (!open) return;
        const frame = requestAnimationFrame(() => {
            grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [open, disabled]);

    const close = () => {
        setOpen(false);
        trigger.current?.focus();
    };

    const navigate = (event: React.KeyboardEvent<HTMLTableElement>) => {
        let row = Math.floor(active / GRID_SIZE);
        let column = active % GRID_SIZE;
        switch (event.key) {
            case 'Escape':
            case 'Tab':
                event.stopPropagation();
                if (event.key === 'Escape') event.preventDefault();
                close();
                return;
            case 'ArrowLeft': column = Math.max(0, column - 1); break;
            case 'ArrowRight': column = Math.min(GRID_SIZE - 1, column + 1); break;
            case 'ArrowUp': row = Math.max(0, row - 1); break;
            case 'ArrowDown': row = Math.min(GRID_SIZE - 1, row + 1); break;
            case 'Home': column = 0; break;
            case 'End': column = GRID_SIZE - 1; break;
            default: return;
        }
        event.preventDefault();
        event.currentTarget.rows[row].cells[column].querySelector('button')?.focus();
    };

    return (
        <Dropdown
            placement="top"
            trigger={['click']}
            disabled={disabled}
            open={visible}
            destroyOnHidden
            onOpenChange={nextOpen => {
                if (nextOpen) setActive(Math.max(0, selected));
                setOpen(nextOpen);
            }}
            popupRender={() => (
                <div className="chat-token-limit-popup">
                    <table id={gridId} ref={grid} role="grid" aria-label="Response token limit" onKeyDown={navigate}>
                        <tbody>
                            {Array.from({ length: GRID_SIZE }, (_, row) => {
                                const start = row * GRID_SIZE;
                                return (
                                    <tr key={row}>
                                        {choices.slice(start, start + GRID_SIZE).map((option, column) => {
                                            const index = start + column;
                                            return (
                                                <td key={index} role="gridcell">
                                                    <button
                                                        type="button"
                                                        aria-pressed={index === selected}
                                                        aria-label={option ?? 'None'}
                                                        title={option === undefined ? 'No response token limit' : `${option} tokens`}
                                                        tabIndex={index === active ? 0 : -1}
                                                        onFocus={() => setActive(index)}
                                                        onClick={() => { onChange(option); close(); }}
                                                    >
                                                        {choiceLabel(option)}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        >
            <Button
                ref={trigger}
                className="chat-token-limit-trigger"
                size="small"
                icon={<DownOutlined />}
                iconPlacement="end"
                disabled={disabled}
                aria-haspopup="grid"
                aria-expanded={visible}
                aria-controls={visible ? gridId : undefined}
                aria-label={`Response token limit: ${value === undefined ? 'None' : `${value} tokens`}`}
                title={value === undefined ? 'No response token limit' : `At most ${value} tokens in the agent’s visible replies this turn`}
            >
                {choiceLabel(value)}
            </Button>
        </Dropdown>
    );
}
