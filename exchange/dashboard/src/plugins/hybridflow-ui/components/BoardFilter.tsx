import React from 'react';
import { Button } from 'antd';
import { Tooltip } from '@cms-core';
import { ClearOutlined } from '@ant-design/icons';
import { useTagsAvailable, useTagsUi } from '@cms-kit/capabilities';
import { ZoomControl } from '@cms-kit/zoom-control';
import { useBoardControls } from '../BoardControls-ctx';
import styles from '../Hybridflow.module.css';

/**
 * What a board is read at: a quarter of its size — the whole of a board of forty cards on one
 * screen — up to a quarter past its own, past which a card is a title too big for its neighbours
 * to still be read beside it. The steps a diagram is zoomed by, stopping where prose stays prose.
 */
export const BOARD_ZOOM_LEVELS = [0.25, 0.5, 0.7, 0.8, 0.9, 1, 1.25];

interface BoardFilterProps {
    /** The words the board's cards wear — see `boardFilter.boardTags`. */
    tags: string[];
    /** The words being asked for, none of them meaning every card. */
    selected: string[];
    onToggle: (label: string) => void;
    onClear: () => void;
    /**
     * How many cards the board draws, and how many it holds — said only while a filter is
     * on.
     */
    shown: number;
    total: number;
    /** The size the board is read at — one of {@link BOARD_ZOOM_LEVELS}. */
    zoom: number;
    onZoomChange: (zoom: number) => void;
}

/**
 * The board's tag filter and read size, in the Board tab strip.
 *
 * **The chips are the ones the cards wear.** They are the `tags` plugin's own component, asked for
 * as a capability, so a word reads the same in the filter as on the card it leaves on screen. A
 * word not being asked for is dimmed: the row reads as "these ones", and the pressed chips catch
 * the eye.
 *
 * **The chips are not drawn at all** where the board wears no tag, or where the assembly has no
 * tags plugin. The zoom is — a board with nothing to ask of it still has a size to be read at.
 */
export const BoardFilter: React.FC<BoardFilterProps> = ({
    tags, selected, onToggle, onClear, shown, total, zoom, onZoomChange,
}) => {
    const { TagChips } = useTagsUi();
    const available = useTagsAvailable();
    const filtering = available && tags.length > 0;

    const isOn = (label: string) => selected.some(word => word.toLowerCase() === label.toLowerCase());

    /**
     * How a chip is worn. **Nothing asked for is every card shown**, so the whole row is lit: a row
     * of uniformly dimmed chips would say the board was holding something back when it is showing
     * everything. It is only once a word is pressed that the others fall back, and the pressed ones
     * take a ring — the state of a filter is not a thing to say in opacity alone.
     */
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
                    {/* What the filter costs, in cards. A board answering a question about three of
                        its forty flow nodes looks like a board that has lost thirty-seven, and this is
                        the line that says otherwise. */}
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
            {/* The size the board is read at, at the end of the row: what of the board is on
                screen is asked first, and at what size after. */}
            <ZoomControl
                zoom={zoom}
                onZoomChange={onZoomChange}
                zoomLevels={BOARD_ZOOM_LEVELS}
            />
        </div>
    );
};

/** The filter row bound to the board's view state, for the document tab strip. */
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
