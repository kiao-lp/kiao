import React, { type ComponentProps } from 'react';
import { useAgents } from '../agentic-resources/Agents-ctx';
import { AgentMatrixDialog } from '../agentic-resources/components/AgentMatrixDialog';

type Props = Omit<ComponentProps<typeof AgentMatrixDialog>, 'agents' | 'agentsLoading' | 'error' | 'requireCommit'>;

export const ChatAgentDialog: React.FC<Props> = props => {
    const { agents, loading, error } = useAgents();
    return <AgentMatrixDialog {...props} agents={agents} agentsLoading={loading} error={error} requireCommit />;
};
