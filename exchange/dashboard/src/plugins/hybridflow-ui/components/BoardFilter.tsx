import React from 'react';
import { Button } from 'antd';
import { Tooltip } from '@cms-core';
import { ClearOutlined } from '@ant-design/icons';
import { useTagsAvailable, useTagsUi } from '@cms-kit/capabilities';
import { ZoomControl } from '@cms-kit/zoom-control';
import { useBoardControls } from '../BoardControls-ctx';
import styles from '../Hybridflow.module.css';

/** Zoom levels from 0. 25 to 1. */
export const BOARD_ZOOM_LEVELS = [0.25, 0.5, 0.7, 0.8, 0.9, 1, 1.25];

interface BoardFilterProps {
    tags: string[];
    selected: string[];
    onToggle: (label: string) => void;
    onClear: () => void;
    /** Shown and total card counts; shown only while filtering. */
    shown: number;
    total: number;
    zoom: number;
    onZoomChange: (zoom: number) => void;
}

/** Tag filter and zoom for the board tab strip. */
export const BoardFilter: React.FC<BoardFilterProps> = ({
    tags, selected, onToggle, onClear, shown, total, zoom, onZoomChange,
}) => {
    const { TagChips } = useTagsUi();
    const available = useTagsAvailable();
    const filtering = available && tags.length > 0;

    const isOn = (label: string) => selected.some(word => word.toLowerCase() === label.toLowerCase());

    /** Chip style: with no selection all chips are lit; otherwise selected chips are ringed. */
    const chipClass = (label: string) => {
        if (!selected.length) return styles.filterTag;
        return `${styles.filterTag} ${isOn(label) ? styles.filterTagOn : styles.filterTagOff}`;
    };

    return (
        <div className={styles.filterRow} data-testid="board-filter" role="group" aria-label="Filter by tag">
            {filtering && tags.map(label => (
                <button
                    key={label}
                    type="button"
                    className={chipClass(label)}
                    aria-pressed={isOn(label)}
                    aria-label={`Show only ${label}`}
                    data-testid="board-filter-tag"
                    data-tag={label}
                    onClick={() => onToggle(label)}
                >
                    <TagChips labels={[label]} />
                </button>
            ))}
            {filtering && selected.length > 0 && (
                <>

                    <span className={styles.filterCount} data-testid="board-filter-count">
                        {shown} of {total} shown
                    </span>
                    <Tooltip title="Show every card again">
                        <Button
                            type="text"
                            size="small"
                            icon={<ClearOutlined />}
                            className={styles.filterClear}
                            aria-label="Clear the tag filter"
                            data-testid="board-filter-clear"
                            onClick={onClear}
                        />
                    </Tooltip>
                </>
            )}

            <ZoomControl
                zoom={zoom}
                onZoomChange={onZoomChange}
                zoomLevels={BOARD_ZOOM_LEVELS}
            />
        </div>
    );
};

/** Filter row bound to board view state. */
export const BoardFilterStrip: React.FC = () => {
    const { tags, filter, toggle, clear, shown, total, zoom, setZoom } = useBoardControls();
    return (
        <BoardFilter
            tags={tags}
            selected={filter}
            onToggle={toggle}
            onClear={clear}
            shown={shown}
            total={total}
            zoom={zoom}
            onZoomChange={setZoom}
        />
    );
};
