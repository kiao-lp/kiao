/**
 * Moving classes to another board of this store: created there first, taken off here after.
 *
 * **In that order, and only in that order.** The classes leave this board once the receiving
 * board holds them: a create that fails says so and the classes stay where they are, because
 * classes that left the board for a board that never received them are the one outcome this
 * feature exists to prevent. What goes out first is every class with every version beneath it
 * — a move of six is one gesture, the way a paste of six is.
 *
 * The classes travel as what they are ([flowNodeClassMove.ts](./flowNodeClassMove.ts)): new
 * ids, no place, the chains among them kept — and the permission mode and the pinning kept
 * with them, both being things of this store that mean the same on the board they land on. No
 * question is asked about a flow node this board is left with nothing referencing: an
 * instantiated flow node keeps what it says, and only its link to the version it was made from
 * goes with the board.
 *
 * Three calls per class, in this order: the class itself with its first version's words
 * beside it, one call per further version, and the chain once every class is filed — a class
 * is created naming no chain because the class it names may not be filed yet, and the chain
 * call is what says it afterwards. The transition mode travels on the create, the chain beside
 * it being the only half that waits.
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

    // The board as it stands when the menu item is pressed, not as it stood when the menu opened.
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
                // Filed naming no chain: the class after it may not be on the receiving board
                // yet, and a create naming a class that is not there is refused. The mode and
                // the compaction travel on the create; the chain is drawn once all are filed.
                const dto = newFlowNodeClassDto(one);
                const creating = {
                    ...dto,
                    ...(one.versions[0]?.status === 'published' ? { published: true } : {}),
                    ...(dto.onSuccess
                        ? { onSuccess: { ...dto.onSuccess, flowNode: undefined } }
                        : {}),
                };
                const made = await store.createFlowNodeClass(target.slug, creating);
                // Every further version beneath it, in succession order, frozen where the
                // source was: a new version is filed a draft, and published straight after.
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
