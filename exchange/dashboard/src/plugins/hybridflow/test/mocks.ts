import { mockFunctions } from 'src/test/mocks';

/** The context boundary only: board operations and the provider keep their own real tests. */
export const createBoardMock = () => ({
    content: null as any,
    handle: 'major',
    loading: false,
    selected: null as string | null,
    selectedFlowNode: null as any,
    selectedWorkflow: null as string | null,
    openingId: 1,
    marked: [] as string[],
    working: null as string | null,
    titleCaret: null as string | null,
    ...mockFunctions(
        'select', 'openTask', 'toggleMark', 'clearMarks', 'setMarked', 'setWorking',
        'openBoard', 'closeBoard', 'reloadBoard', 'chainFlowNode', 'placeFlowNodes',
        'moveSpots', 'addFlowNode', 'cloneFlowNode', 'selectWorkflow', 'createWorkflow', 'removeWorkflows',
        'editFlowNode', 'removeFlowNode', 'setFlowNodeStatus', 'takeTitleCaret',
    ),
});
