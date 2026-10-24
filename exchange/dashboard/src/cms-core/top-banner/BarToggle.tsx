import React from 'react';
import { Button } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { BorderLeftOutlined, BorderRightOutlined } from '@ant-design/icons';
import { useToolBarsOptional } from '../tool-bars/ToolBars-ctx';
import { BarSide, barsOfSide } from '../tool-bars/barsModel';

const ICON: Record<string, React.ReactNode> = {
    left: <BorderLeftOutlined />,
    right: <BorderRightOutlined />,
};

/**
 * One column, switched on and off from the end of the top banner it sits at.
 *
 * It says nothing about which tabs the column holds — that is the Show menu's — only whether the
 * column is there at all, which is the move wanted when the screen is needed for the document. A
 * column the open document puts no tab in has nothing to switch, so the button is disabled rather
 * than removed: it is a landmark of the banner, and a banner whose ends move is harder to aim at.
 */
export const BarToggle: React.FC<{ side: Exclude<BarSide, 'center'> }> = ({ side }) => {
    const bars = useToolBarsOptional();
    if (!bars) return null;

    const on = bars.isSideOn(side);
    const empty = barsOfSide(side).every(spec => bars.tabsIn(spec.id).length === 0);
    const title = empty
        ? `Nothing is placed in the ${side} column`
        : on ? `Hide the ${side} column` : `Show the ${side} column`;

    return (
        <Tooltip title={title}>
            <Button
                type={on && !empty ? 'primary' : 'text'}
                size="small"
                icon={ICON[side]}
                disabled={empty}
                onClick={() => bars.toggleSide(side)}
                className="cms-bar-toggle"
                aria-label={title}
                data-testid={`bar-toggle-${side}`}
            />
        </Tooltip>
    );
};
