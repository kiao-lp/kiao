import { useMemo } from 'react';
import { useChatOptions } from '@cms-kit/capabilities';
import { useAgents } from './Agents-ctx';
import { BYPASS_PERMISSION, PlayDefaults } from './flowNodeType';

/** What the store answers about a card nobody has been asked about yet: its first agent,. */
export const usePlayDefaults = (): PlayDefaults => {
    const { agents } = useAgents();
    const { optionsFor } = useChatOptions();
    const first = agents.find(agent => !agent.archived && agent.published);
    const agent = first?.id ?? '';
    const offersBypass = !!first
        && optionsFor(first.published!.platform).permissionModes.some(mode => mode.value === BYPASS_PERMISSION);
    return useMemo(
        () => ({ agent, permission: offersBypass ? BYPASS_PERMISSION : '' }),
        [agent, offersBypass],
    );
};
