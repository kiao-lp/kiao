import React, { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeClassCard, FlowNodeClassChainProps, FlowNodeClassMenuProps } from './NodeClassCard';
import { FlowNodeClass, newFlowNodeClass } from '../flowNodeClass';
import { scheduleLabel } from '../flowNodeSchedule';
import styles from '../Hybridflow.module.css';

// The tag chips are a capability the `tags` plugin publishes; the board asks for it by name and
// wears nothing where nothing published it. Stubbed here, like the card's own tests stub them.
vi.mock('@cms-kit/capabilities', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-kit/capabilities')>()),
    useTagsUi: () => ({
        TagChips: ({ labels }: { labels?: string[] }) => (
            <>{(labels ?? []).map(label => <span key={label} data-testid="tag-chip">{label}</span>)}</>
        ),
        TagPicker: () => null,
    }),
}));

const noop = vi.fn();
const pointerProps = {
    onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop,
    onLostPointerCapture: noop,
};
const chainProps: FlowNodeClassChainProps = { knobProps: pointerProps, source: false, target: false };
const menu: FlowNodeClassMenuProps = { onClone: noop, onDelete: noop, deleting: 1 };

const classOf = (over: Partial<FlowNodeClass> = {}): FlowNodeClass => ({
    ...newFlowNodeClass('ai'), id: 'c1', title: 'Review', ...over,
});

const show = (
    flowNodeClass: FlowNodeClass,
    chain: FlowNodeClassChainProps | null = chainProps,
    over: Partial<FlowNodeClassMenuProps> = {},
) => render(
    <NodeClassCard
        flowNodeClass={flowNodeClass}
        next={null}
        chain={chain}
        selected={false}
        menu={{ ...menu, ...over }}
        onOpen={noop}
        onMark={noop}
        onKeyDown={noop}
        cardClass={undefined}
        dragProps={pointerProps}
    />,
);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('NodeClassCard', () => {
    it('wears the bolder dotted border that tells a class from a card', () => {
        show(classOf());
        const card = screen.getByTestId('flow-node-class-card');
        expect(card.className).toContain(styles.cardClass);
    });

    it('names the latest published version, and the drafts beside it', () => {
        show(classOf({
            versions: [
                { id: 'v1', number: 1, body: '', criteria: [], template: false, agent: '', status: 'published' },
                { id: 'v2', number: 2, body: '', criteria: [], template: false, agent: '', status: 'draft' },
            ],
        }));
        expect(screen.getByTestId('flow-node-class-version')).toHaveTextContent('v1 published · 1 draft');
    });

    it('says where no version is published yet', () => {
        show(classOf({ versions: [] }));
        expect(screen.getByTestId('flow-node-class-version')).toHaveTextContent('no published version');
    });

    it('wears the permission and the pinning, and nothing of the agent', () => {
        show(classOf({ permission: 'manualLive', runner: 'r1' }));
        const chips = screen.getAllByTestId('flow-node-class-chip').map(chip => chip.textContent);
        expect(chips).toEqual(['live', 'pinned']);
    });
});

// The right-click menu files a copy of the class on the board already open: the first item,
// the one wanted here rather than on another board.
describe('NodeClassCard — cloning the class', () => {
    it('offers Clone class first, and clones the class it was opened on', async () => {
        const onClone = vi.fn();
        show(classOf(), chainProps, { onClone });

        fireEvent.contextMenu(screen.getByTestId('flow-node-class-card'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Clone class'));

        expect(onClone).toHaveBeenCalledTimes(1);
    });
});

// The right-click menu files the class on another board: one item per board but this one, under
// "Move to..." — and the count the way the Delete's reads where several classes are marked.
describe('NodeClassCard — moving to another board', () => {
    it('offers the other boards under Move to..., and moves to the one picked', async () => {
        const onMove = vi.fn();
        show(classOf(), chainProps, {
            moveTargets: [{ slug: 'other', name: 'Other board' }], onMove, moving: 1,
        });

        fireEvent.contextMenu(screen.getByTestId('flow-node-class-card'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.mouseEnter(screen.getByText('Move to...'));
        fireEvent.click(await screen.findByTestId('move-to-other'));

        expect(onMove).toHaveBeenCalledWith('other');
    });

    it('says how many classes the move takes, and where there is nowhere to move to', async () => {
        show(classOf(), chainProps, { moveTargets: [], moving: 3 });

        fireEvent.contextMenu(screen.getByTestId('flow-node-class-card'));
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText('Move 3 classes to...')).toBeTruthy();
        fireEvent.mouseEnter(screen.getByText('Move 3 classes to...'));
        expect(await screen.findByText('No other boards')).toBeTruthy();
    });
});

// The right-click menu files a workflow class round the aimed classes — from one class
// up — and the panel it opens is where the rectangle is named.
describe('NodeClassCard — creating a workflow class', () => {
    it('offers Create workflow class for a single class, and creates it', async () => {
        const onCreateWorkflowClass = vi.fn();
        show(classOf(), chainProps, { onCreateWorkflowClass, creating: 1 });

        fireEvent.contextMenu(screen.getByTestId('flow-node-class-card'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Create workflow class (1 class)'));

        expect(onCreateWorkflowClass).toHaveBeenCalledTimes(1);
    });
});

// A mouse press anywhere on the class card starts a move — the grip is gone, and the title has
// its corner back. The knob keeps the presses that draw a chain.
describe('NodeClassCard — dragging from anywhere', () => {
    const dragDown = vi.fn();
    const knobDown = vi.fn();
    const dragSpies = {
        onPointerDown: dragDown, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop,
        onLostPointerCapture: noop,
    };

    const showDraggable = () => render(
        <NodeClassCard
            flowNodeClass={classOf()}
            next={null}
            chain={{ knobProps: { ...dragSpies, onPointerDown: knobDown }, source: false, target: false }}
            selected={false}
            menu={menu}
            onOpen={noop}
            onMark={noop}
            onKeyDown={noop}
            cardClass={undefined}
            dragProps={dragSpies}
        />,
    );

    /** A mouse press on the target, as jsdom has no `PointerEvent` — see `useSpotDrag.test.tsx`. */
    const press = (target: Element) => {
        const event = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0,
        });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        Object.defineProperty(event, 'pointerType', { value: 'mouse' });
        fireEvent(target, event);
    };

    it('starts a drag from a press anywhere on the card', () => {
        showDraggable();
        press(screen.getByTestId('flow-node-class-card'));
        expect(dragDown).toHaveBeenCalledTimes(1);
    });

    it('carries no grip anymore', () => {
        showDraggable();
        expect(screen.queryByTestId('flow-node-class-grip')).toBeNull();
    });

    it('draws a chain from the knob rather than moving the card', () => {
        showDraggable();
        press(screen.getByTestId('flow-node-class-chain'));
        expect(knobDown).toHaveBeenCalledTimes(1);
        expect(dragDown).not.toHaveBeenCalled();
    });
});

// A Shutdown or a Scheduler class is a BPMN event's circle rather than a card, with a dotted
// ring — the label under it is the card's own.
describe('NodeClassCard — BPMN symbols', () => {
    it('draws a Scheduler class as a circle with its datetime under it', () => {
        show(classOf({ type: 'scheduler', at: '2026-09-03T22:00' }));
        const node = screen.getByTestId('flow-node-class-card');
        expect(node).toHaveAttribute('data-shape', 'circle');
        expect(node.className).toContain(styles.symbolClass);
        const chips = screen.getAllByTestId('flow-node-class-chip').map(chip => chip.textContent);
        expect(chips).toEqual([scheduleLabel('2026-09-03T22:00')]);
    });

    it('draws a Shutdown class as a circle', () => {
        show(classOf({ type: 'shutdown' }));
        const node = screen.getByTestId('flow-node-class-card');
        expect(node).toHaveAttribute('data-shape', 'circle');
        expect(node).toHaveTextContent('Review');
    });

    it('leaves AI and Human classes as cards', () => {
        const ai = show(classOf());
        expect(screen.getByTestId('flow-node-class-card')).not.toHaveAttribute('data-shape');
        ai.unmount();

        show(classOf({ type: 'human' }));
        expect(screen.getByTestId('flow-node-class-card')).not.toHaveAttribute('data-shape');
    });
});
