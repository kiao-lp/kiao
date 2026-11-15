import React from 'react';
import { Button } from 'antd';
import { BorderLeftOutlined, BorderRightOutlined } from '@ant-design/icons';
import { useToolBarsOptional } from '../toolbars/ToolBars-ctx';

const SecondCentralAreaIcon: React.FC = () => (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="1" stroke="currentColor" strokeWidth="2" />
        <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor">2</text>
    </svg>
);

export const BarToggle: React.FC<{ bar: 'left' | 'right' }> = ({ bar }) => {
    const bars = useToolBarsOptional();
    if (!bars) return null;

    const on = bars.isSideOn(bar);
    const empty = bars.tabsIn(bar).length === 0;
    const title = empty
        ? `Nothing is placed in the ${bar} column`
        : on ? `Hide the ${bar} column` : `Show the ${bar} column`;

    return (
        <Button
            type={on && !empty ? 'primary' : 'text'}
            size="small"
            icon={bar === 'left' ? <BorderLeftOutlined /> : <BorderRightOutlined />}
            disabled={empty}
            onClick={() => bars.toggleSide(bar)}
            className="cms-bar-toggle"
            aria-label={title}
            aria-pressed={on && !empty}
            data-testid={`bar-toggle-${bar}`}
        />
    );
};

export const SecondCentralAreaToggle: React.FC = () => {
    const bars = useToolBarsOptional();
    if (!bars) return null;

    const on = bars.secondCentralArea;
    const title = on ? 'Hide the second central area' : 'Show the second central area';

    return (
        <Button
            type={on ? 'primary' : 'text'}
            size="small"
            icon={<SecondCentralAreaIcon />}
            onClick={() => bars.setSecondCentralArea(!on)}
            className="cms-bar-toggle"
            aria-label={title}
            aria-pressed={on}
            data-testid="bar-toggle-center-2"
        />
    );
};
