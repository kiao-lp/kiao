import React, { useEffect, useRef, useState } from 'react';
import { Input, InputRef, Modal } from 'antd';

/**
 * What a run is called, asked for at the moment it starts.
 *
 * **Several play at once**, and a run is otherwise a board path and a flow node id — two things two runs
 * of one board share. The name is the whole of what tells them apart in the chain runs panel,
 * in the notices they raise and in the tooltip of the card they are on, so it is asked for once,
 * here, rather than derived from anything.
 *
 * It is prefilled with the moment the run starts, which is a name — the honest one for the run
 * somebody starts without thinking about what to call it — and it opens selected, so typing over it
 * costs nothing and keeping it costs a press of Enter. The service writes the same sentence for an
 * empty box, so clearing it is not a way of having no name.
 */
export interface StartChainRunModalProps {
    /** The card the run would start on, by title, for the line above the box. Null when closed. */
    flowNode: string | null;
    onCancel: () => void;
    onStart: (name: string) => void;
}

/** The prefill: the moment the run is being started, said as a person reads a clock. */
export const startedNow = (at: Date = new Date()): string =>
    `Started ${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} `
    + `${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

export const StartChainRunModal: React.FC<StartChainRunModalProps> = ({ flowNode, onCancel, onStart }) => {
    const [name, setName] = useState('');
    const input = useRef<InputRef>(null);

    // A fresh prefill every time the box opens: the name is the moment the run starts, and a dialogue
    // opened at noon and reused at four would offer noon.
    useEffect(() => {
        if (flowNode !== null) setName(startedNow());
    }, [flowNode]);

    // Selected rather than merely focused, so the next keystroke replaces the prefill and Enter keeps
    // it — the two things anybody does with a name they were handed.
    const selectName = (open: boolean) => { if (open) input.current?.focus({ cursor: 'all' }); };

    return (
        <Modal
            open={flowNode !== null}
            title="Start a chain run"
            okText="Start"
            onOk={() => onStart(name)}
            onCancel={onCancel}
            afterOpenChange={selectName}
            destroyOnHidden
        >
            <p>
                Playing “{flowNode || 'Untitled'}” and the chain after it. What should this chain run be
                called?
            </p>
            <Input
                ref={input}
                value={name}
                onChange={event => setName(event.target.value)}
                onPressEnter={() => onStart(name)}
                aria-label="Chain run name"
                data-testid="chain-run-name"
            />
        </Modal>
    );
};
