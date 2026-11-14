/**
 * Moving classes to another board of this store: created there first, taken off here after.
 * In that order, and only in that order.
 */

import { useCallback, useRef } from 'react';
import { message } from 'antd';
import { flowNodeClassesNamed } from './boardOps';
import { newFlowNodeClassDto } from './boardWrites';
import { prepareMovedFlowNodeClasses } from './flowNodeClassMove';
import { FlowNodeClass } from './flowNodeClass';
import { useHybridflow } from './Hybridflow-ctx';
import { useHybridflowClient } from './service';
import { errorText } from './useFlowNodeRemoval';
import { MoveTarget } from './useFlowNodeMove';

/** What a toast calls the classes a move took: named by title while there is one, counted after. */
const naming = (classes: FlowNodeClass[]): string =>
    (classes.length === 1 ? `“${classes[0].title || 'Untitled'}”` : `${classes.length} classes`);

export const useFlowNodeClassMove = (): ((classIds: string[], target: MoveTarget) => Promise<boolean>) => {
    const { content, handle, removeFlowNodeClasses } = useHybridflow();
    const client = useHybridflowClient();

    const held = useRef(content);
    held.current = content;
    const source = useRef(handle);
    source.current = handle;
    const service = useRef(client);
    service.current = client;
    const takeOff = useRef(removeFlowNodeClasses);
    takeOff.current = removeFlowNodeClasses;

    return useCallback(async (classIds: string[], target: MoveTarget) => {
        const board = held.current;
        const from = source.current;
        const store = service.current;
        if (!board || !from || !store) return false;
        if (!target || !target.slug || target.slug === from) return false;
        const classes = flowNodeClassesNamed(board, classIds);
        if (classes.length === 0) return false;
        const moved = prepareMovedFlowNodeClasses(classes);
        try {
            for (const one of moved) {
                const dto = newFlowNodeClassDto(one);
                const creating = {
                    ...dto,
                    ...(one.versions[0]?.status === 'published' ? { published: true } : {}),
                    ...(dto.onSuccess
                        ? { onSuccess: { ...dto.onSuccess, flowNode: undefined } }
                        : {}),
                };
                const made = await store.createFlowNodeClass(target.slug, creating);
                for (const version of one.versions.slice(1)) {
                    const filed = await store.createClassVersion(target.slug, made.id, {
                        body: version.body || undefined,
                        criteria: version.criteria.length
                            ? version.criteria.map(criterion => ({ ...criterion }))
                            : undefined,
                        template: version.template || undefined,
                        agent: version.agent || undefined,
                    });
                    if (version.status === 'published') {
                        await store.patchClassVersion(
                            target.slug, made.id, filed.id, { status: 'published' });
                    }
                }
            }
            for (const one of moved) {
                if (one.onSuccess.flowNode) {
                    await store.chainFlowNodeClass(target.slug, one.id, one.onSuccess.flowNode);
                }
            }
        } catch (error) {
            message.error(`The classes could not be moved: ${errorText(error)}`);
            return false;
        }
        takeOff.current?.(classes.map(one => one.id));
        message.success(`Moved ${naming(classes)} to “${target.name || target.slug}”.`);
        return true;
    }, []);
};
