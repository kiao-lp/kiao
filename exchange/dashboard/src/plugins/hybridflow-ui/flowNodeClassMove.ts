/**
 * Create on the receiving board before deleting from the source. Class ids are global;
 * mint new ones and remap only chains within the moved set, retaining transition modes.
 * The store clears incoming links and unlinks instances when the originals are deleted.
 */

import { newId } from './boardContent';
import { FlowNodeClass } from './flowNodeClass';

/** Preserve class data and versions; reset placement for the receiving canvas. */
export const prepareMovedFlowNodeClasses = (classes: FlowNodeClass[]): FlowNodeClass[] => {
    if (classes.length === 0) return [];
    const minted = new Map(classes.map(one => [one.id, newId()]));
    const moving = new Set(classes.map(one => one.id));
    return classes.map(one => {
        const target = one.onSuccess.flowNode;
        const kept = target && moving.has(target) ? minted.get(target) ?? '' : '';
        return {
            ...one,
            id: minted.get(one.id) ?? one.id,
            spot: null,
            onSuccess: { ...one.onSuccess, flowNode: kept },
            // Workflow classes identify regions of the source board; arrive ungrouped.
            workflowClass: '',
        };
    });
};
