import { Modal } from 'antd';
import { PushConfirmationRequired } from '../Client';

export async function confirmAgentPush(operation: (confirmation?: string) => Promise<unknown>): Promise<void> {
    try {
        await operation();
    } catch (cause) {
        if (!(cause instanceof PushConfirmationRequired)) throw cause;
        const { dependencies, token } = cause.confirmation;
        const confirmed = await new Promise<boolean>(resolve => Modal.confirm({
            title: 'Push an agent that requires Kiao?',
            content: <>
                <p>This agent requires Kiao to use these dependencies. Their repositories have no Git remote.</p>
                <ul>{dependencies.map(name => <li key={name}>{name}</li>)}</ul>
            </>,
            okText: 'Push to Git',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        }));
        if (confirmed) await operation(token);
    }
}
