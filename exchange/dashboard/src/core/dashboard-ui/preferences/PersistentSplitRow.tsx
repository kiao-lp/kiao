import React from 'react';
import { SplitRow as SplitRowView, type SplitRowProps as SplitRowViewProps, type PartWeights } from '../../ui-foundation/layout';
import { useGlobalViewState } from '../../view-state/index';

export interface SplitRowProps extends Omit<SplitRowViewProps, 'id' | 'weights' | 'onWeightsChange'> {
    id: string;
}

export const SplitRow: React.FC<SplitRowProps> = ({ id, ...props }) => {
    const [weights, setWeights] = useGlobalViewState<PartWeights>(`split:${id}`, {});
    return <SplitRowView {...props} id={id} weights={weights} onWeightsChange={setWeights} />;
};
