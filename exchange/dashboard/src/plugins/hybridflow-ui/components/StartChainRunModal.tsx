import React, { useEffect, useRef, useState } from 'react';
import { Input, InputRef, Modal } from 'antd';

/** What a run is called, asked for at the moment it starts. **Several play at once**, and a run is. */
export interface StartChainRunModalProps {

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

    useEffect(() => {
        if (flowNode !== null) setName(startedNow());
    }, [flowNode]);

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
