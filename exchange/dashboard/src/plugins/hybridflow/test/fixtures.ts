import { newFlowNode, type BoardContent, type FlowNode } from '../boardContent';

/** A board with the given nodes, with a new set of collections for every call. */
export const boardOf = (flowNodes: FlowNode[]): BoardContent => ({
    flowNodes, flowNodeClasses: [], workflows: [], workflowClasses: [],
});

export const boardNamed = (...titles: string[]) => boardOf(titles.map(title => newFlowNode(title)));
