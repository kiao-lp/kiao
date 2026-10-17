import React from 'react';
import { BoundCommand as Command } from '../commands/CommandRegistry-ctx';
import { useFirstCommandOfEachGroup, useNonGroupedCommands } from '../commands/CommandUtils';
import { useCommandDispatcherContext } from '../commands/CommandDispatcher-ctx';
import { CandidateCmp } from './CandidateCmp';

export const CommandSentence: React.FC = () => {
    const { sentence, candidates } = useCommandDispatcherContext();
    const uniqueCandidates: Command[] = useNonGroupedCommands(candidates);
    const candidateGroups: Command[] = useFirstCommandOfEachGroup(candidates);

    return (
        <>
            <span className="cms-top-banner-sentence">
                {sentence}|
            </span>

            {uniqueCandidates.map(candidate => <CandidateCmp key={candidate.shortcut} candidate={candidate} />)}
            {candidateGroups.map(candidate => <CandidateCmp key={candidate.shortcut} candidate={candidate} />)}
        </>
    );
};
