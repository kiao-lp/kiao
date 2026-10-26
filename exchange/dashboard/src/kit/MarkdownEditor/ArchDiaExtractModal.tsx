import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Radio, Typography } from 'antd';
import type { EditableBlock } from '@cms-core';
import { parseArchDiaSources } from '@cms-kit/archdia';

export interface ArchDiaExtractModalProps {
    /** The archdia block being extracted from; `null` keeps the dialog closed. */
    block: EditableBlock | null;
    onCancel: () => void;
    /** Called with the diagram to put in the block's place. */
    onConfirm: (source: string) => void;
}

/**
 * Taking a diagram back out of an archdia block.
 *
 * The counterpart of the edit button, which wraps a plain diagram *into* archdia.
 * Nothing is translated here: an archdia block already holds its diagram as
 * PlantUML, and extracting is lifting that source out of the sections around it.
 * What is left behind — the layout, the descriptions — has no place in a plain
 * diagram block, so the reader confirms before the block is replaced.
 *
 * archdia holds several diagrams when it has several layers, and only one of them
 * can be the extracted block, so which one is asked rather than guessed.
 */
export const ArchDiaExtractModal: React.FC<ArchDiaExtractModalProps> = ({ block, onCancel, onConfirm }) => {
    const [index, setIndex] = useState(0);

    const diagrams = useMemo(() => (block ? parseArchDiaSources(block.code) : []), [block]);
    const chosen = diagrams[index];

    // Each block is offered from the top: the previous block's choice says
    // nothing about this one, which may not even hold as many diagrams.
    useEffect(() => {
        if (block) setIndex(0);
    }, [block]);

    // A layer is named by whatever its block gives it; failing that, by its rank.
    const options = diagrams.map((diagram, i) => ({
        value: i,
        label: diagram.name || diagram.id || `Diagram ${i + 1}`,
    }));

    return (
        <Modal
            title="Extract diagram"
            open={block !== null}
            onOk={() => chosen && onConfirm(chosen.source)}
            onCancel={onCancel}
            okText="Extract"
            okButtonProps={{ disabled: !chosen }}
            width={720}
            destroyOnHidden
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Alert
                    type="warning"
                    showIcon
                    title="The archdia block is replaced by the diagram it holds."
                    description={
                        'Its layout and descriptions are archdia\'s own and stay behind'
                        + (diagrams.length > 1 ? ', along with the diagrams that are not the one chosen.' : '.')
                    }
                />

                {diagrams.length > 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Typography.Text strong>Which diagram</Typography.Text>
                        <Radio.Group
                            value={index}
                            onChange={(e) => setIndex(e.target.value)}
                            options={options}
                            data-testid="archdia-extract-diagram"
                        />
                    </div>
                )}

                {chosen ? (
                    <pre
                        className="archdia-extract-preview"
                        style={{
                            margin: 0,
                            padding: 12,
                            maxHeight: '40vh',
                            overflow: 'auto',
                            fontSize: 12,
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            backgroundColor: 'var(--bg)',
                            // Plain text: this is what will be written, not a
                            // code sample the document's `pre` colour should own.
                            color: 'var(--text)',
                        }}
                    >
                        {chosen.source}
                    </pre>
                ) : (
                    <Alert type="error" showIcon title="This block holds no diagram to extract." />
                )}
            </div>
        </Modal>
    );
};
