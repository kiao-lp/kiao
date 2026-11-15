import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Radio, Typography } from 'antd';
import type { EditableBlock } from '@kiao-dashboard-core';
import { parseArchDiaSources } from '@kiao-dashboard-kit/archdia';

export interface ArchDiaExtractModalProps {
    block: EditableBlock | null;
    onCancel: () => void;
    onConfirm: (source: string) => void;
}

/** Extracts one diagram source verbatim; layout and descriptions are dropped. With several diagrams the user picks one. */
export const ArchDiaExtractModal: React.FC<ArchDiaExtractModalProps> = ({ block, onCancel, onConfirm }) => {
    const [index, setIndex] = useState(0);

    const diagrams = useMemo(() => (block ? parseArchDiaSources(block.code) : []), [block]);
    const chosen = diagrams[index];

    // Reset per block; the previous index may be out of range.
    useEffect(() => {
        if (block) setIndex(0);
    }, [block]);

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
                            // Override the document `pre` colour for this preview.
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
