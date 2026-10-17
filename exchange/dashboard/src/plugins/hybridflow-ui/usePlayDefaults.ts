import { useMemo } from 'react';
import { useChatOptions } from '@cms-kit/capabilities';
import { useAgents } from './Agents-ctx';
import { BYPASS_PERMISSION, PlayDefaults } from './flowNodeType';

/**
 * What the **store** answers about a card nobody has been asked about yet: its first agent, and
 * the permission mode a card made on the board opens with.
 *
 * The agent is read off the managed agents rather than written down, because it is the store's to
 * say: a card typed AI opens on the first of them, and on nothing where none is filed yet — which
 * is a card wearing the incomplete mark rather than claiming an engine the service would refuse.
 * `bypassPermissions` is offered only where that agent's platform says it has it; a platform that
 * does not leaves the mode unsaid, which is a card asking for one rather than a card claiming a
 * mode its engine never heard of.
 *
 * Both ends of the editor take it: the board makes its new cards with it
 * ([newFlowNodeSettings](./flowNodeType.ts)), and the panel types a card AI with it (`typeChanges`, which
 * reads the agent and leaves the mode alone — see {@link PlayDefaults.permission}).
 */
export const usePlayDefaults = (): PlayDefaults => {
    const { agents } = useAgents();
    const { optionsFor } = useChatOptions();
    const first = agents[0];
    const agent = first?.id ?? '';
    const offersBypass = !!first
        && optionsFor(first.platform).permissionModes.some(mode => mode.value === BYPASS_PERMISSION);
    return useMemo(
        () => ({ agent, permission: offersBypass ? BYPASS_PERMISSION : '' }),
        [agent, offersBypass],
    );
};
