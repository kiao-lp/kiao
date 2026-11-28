export const workflowDeletion = (name: string) => ({
    title: `Delete the workflow “${name || 'Untitled'}”?`,
    description: 'The flow nodes stay on the board as ungrouped elements.',
    confirmText: 'Delete workflow',
});
