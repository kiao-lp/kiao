import React from 'react';
import { IconButton, ReorderableList, moveInArray } from '@kiao-dashboard-core';
import { Button, Input, Select } from 'antd';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import type { BoardContent, FlowNode } from '../boardContent';
import type { GatewayRoute } from '../service/types';
import styles from '../Hybridflow.module.css';

interface Props {
    node: FlowNode;
    content: BoardContent;
    onChange: (routes: GatewayRoute[]) => void;
    readOnly: boolean;
}

export const ExclusiveGatewayRoutes: React.FC<Props> = ({ node, content, onChange, readOnly }) => {
    const routes = node.routes ?? [];
    const successors = node.onSuccess.flowNodes.flatMap(id => {
        const target = content.flowNodes.find(candidate => candidate.id === id && !candidate.archived);
        return target ? [{ value: id, label: target.title || 'Untitled' }] : [];
    });

    const edit = (index: number, patch: Partial<GatewayRoute>) =>
        onChange(routes.map((route, i) => i === index ? { ...route, ...patch } : route));

    return (
        <section aria-label="Routes" className={styles.gatewayRoutes}>
            <div className={styles.gatewayRouteHelp}>
                {node.onSuccess.flowNodes.length === 1 && routes.length === 0 ? 'Each arrival follows the linked successor.' :
                    successors.length === 0 && routes.length === 0 ? 'Link successors to add routes.' : (
                    <>Use <code>input</code> for the incoming JSON. The first true condition chooses the successor.</>
                )}
            </div>
            <ReorderableList
                items={routes}
                disabled={readOnly}
                className={styles.gatewayRouteList}
                rowProps={{ className: styles.gatewayRoute }}
                handleLabel={(_, index) => `Reorder route ${index + 1}`}
                onMove={(from, to) => onChange(moveInArray(routes, from, to))}
            >
                {(route, index, handle) => <>
                    {handle}
                    <div className={styles.gatewayRouteFields}>
                        <Input.TextArea
                            size="small"
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            aria-label={`Route ${index + 1} CEL condition`}
                            placeholder="input.approved == true"
                            value={route.condition}
                            readOnly={readOnly}
                            onChange={event => edit(index, { condition: event.target.value })}
                        />
                        <Select
                            size="small"
                            aria-label={`Route ${index + 1} successor`}
                            value={route.flowNode}
                            labelRender={({ label }) => label ?? 'Unavailable successor'}
                            options={successors}
                            disabled={readOnly}
                            onChange={flowNode => edit(index, { flowNode })}
                        />
                    </div>
                    <IconButton
                        label={`Remove route ${index + 1}`}
                        icon={<CloseOutlined />}
                        disabled={readOnly}
                        onClick={() => onChange(routes.filter((_, i) => i !== index))}
                    />
                </>}
            </ReorderableList>
            <Button
                size="small"
                icon={<PlusOutlined />}
                disabled={readOnly || successors.length === 0}
                onClick={() => onChange([...routes, { condition: '', flowNode: successors[0].value }])}
            >
                Add route
            </Button>
        </section>
    );
};
