import React, { useEffect, useState } from 'react';
import { Button, Modal } from 'antd';

export type UnzipChoice = 'no' | 'yes' | 'yes-delete';

export interface UnzipModalProps {
    /** Imported archives, or null. */
    zips: string[] | null;
    /** Destination folder. */
    target: string;
    /** True while extraction runs. */
    busy?: boolean;
    onAnswer: (choice: UnzipChoice) => void;
}

/** Asks whether to extract imported archives. Not dismissible by Escape or outside click; closing answers No. */
export const UnzipModal: React.FC<UnzipModalProps> = ({ zips, target, busy, onAnswer }) => {
    const [pressed, setPressed] = useState<UnzipChoice | null>(null);

    useEffect(() => {
        setPressed(null);
    }, [zips]);

    if (!zips) return null;

    const names = zips.map(zip => zip.slice(zip.lastIndexOf('/') + 1));
    const where = target || 'the store';
    const plural = names.length > 1;

    const answer = (choice: UnzipChoice) => {
        setPressed(choice);
        onAnswer(choice);
    };

    return (
        <Modal
            open
            title={plural ? `Unzip ${names.length} archives?` : `Unzip ${names[0]}?`}
            maskClosable={false}
            keyboard={false}
            onCancel={() => answer('no')}
            destroyOnHidden
            footer={[
                <Button key="no" onClick={() => answer('no')} disabled={busy} data-testid="unzip-no">
                    No
                </Button>,
                <Button
                    key="yes"
                    loading={busy && pressed === 'yes'}
                    disabled={busy}
                    onClick={() => answer('yes')}
                    data-testid="unzip-yes"
                >
                    Yes
                </Button>,
                <Button
                    key="yes-delete"
                    type="primary"
                    loading={busy && pressed === 'yes-delete'}
                    disabled={busy}
                    onClick={() => answer('yes-delete')}
                    data-testid="unzip-yes-delete"
                >
                    {plural ? 'Yes, and delete the archives' : 'Yes, and delete the archive'}
                </Button>,
            ]}
        >
            {plural ? (
                <p data-testid="unzip-names">
                    Extract the contents of {names.length} archives into {where}?
                </p>
            ) : (
                <p data-testid="unzip-names">
                    Extract the contents of <b>{names[0]}</b> into {where}?
                </p>
            )}
            {plural && (
                <ul>
                    {names.map(name => <li key={name}>{name}</li>)}
                </ul>
            )}
            <p>The folders inside are kept as they are, and files that already exist are overwritten.</p>
        </Modal>
    );
};
