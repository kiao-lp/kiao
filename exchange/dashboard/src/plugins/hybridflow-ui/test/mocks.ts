import type { FlowNodeClassAt } from '../boardOps';
import { mockFunctions } from 'src/test/mocks';

/** The context boundary only: board operations and the provider keep their own real tests. */
export const createBoardMock = () => ({
    content: null as any,
    handle: 'major',
    loading: false,
    selected: null as string | null,
    selectedFlowNode: null as any,
    selectedClass: null as FlowNodeClassAt | null,
    selectedWorkflow: null,
    openingId: 1,
    marked: [] as string[],
    working: null as string | null,
    titleCaret: null as string | null,
    ...mockFunctions(
        'select', 'toggleMark', 'clearMarks', 'setMarked', 'setExpanded', 'setWorking',
        'openBoard', 'closeBoard', 'reloadBoard', 'chainFlowNode', 'placeFlowNodes',
        'moveSpots', 'addFlowNode', 'cloneFlowNode', 'selectWorkflow', 'createWorkflow',
        'createWorkflowClass', 'removeWorkflows', 'removeWorkflowClasses',
        'editFlowNode', 'removeFlowNode', 'setFlowNodeStatus', 'takeTitleCaret',
        'instantiateFlowNodeClass', 'instantiateWorkflowClass', 'editFlowNodeClass',
        'removeFlowNodeClasses', 'createClassVersion', 'editClassVersion',
        'publishClassVersion', 'deleteClassVersion',
    ),
});
