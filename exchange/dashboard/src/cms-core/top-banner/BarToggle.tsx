import React from 'react';
import { Button } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { BorderLeftOutlined, BorderRightOutlined } from '@ant-design/icons';
import { useToolBarsOptional } from '../tool-bars/ToolBars-ctx';
import { isCenterBar } from '../tool-bars/barsModel';

type ToggleBar = 'left' | 'center' | 'center-2' | 'right';

const CentralAreaIcon: React.FC<{ number: number }> = ({ number }) => (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="1" stroke="currentColor" strokeWidth="2" />
        <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor">{number}</text>
    </svg>
);

const ICON: Record<ToggleBar, React.ReactNode> = {
    left: <BorderLeftOutlined />,
    center: <CentralAreaIcon number={1} />,
    'center-2': <CentralAreaIcon number={2} />,
    right: <BorderRightOutlined />,
};

/** Visibility is independent of tab placement and the configured central-area count. */
export const BarToggle: React.FC<{ bar: ToggleBar }> = ({ bar }) => {
    const bars = useToolBarsOptional();
    if (!bars || (bar === 'center-2' && bars.centralCount < 2)) return null;

    const on = bars.isBarOn(bar);
    const empty = !isCenterBar(bar) && bars.tabsIn(bar).length === 0;
    const area = bar === 'center' ? 'first central area'
        : bar === 'center-2' ? 'second central area' : `${bar} column`;
    const title = empty
        ? `Nothing is placed in the ${area}`
        : on ? `Hide the ${area}` : `Show the ${area}`;

    return (
        <Tooltip title={title}>
            <Button
                type={on && !empty ? 'primary' : 'text'}
                size="small"
                icon={ICON[bar]}
                disabled={empty}
                onClick={() => bars.toggleBar(bar)}
                className="cms-bar-toggle"
                aria-label={title}
                aria-pressed={on && !empty}
                data-testid={`bar-toggle-${bar}`}
            />
        </Tooltip>
    );
};
