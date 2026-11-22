import React from 'react';
import { DiagramTheme, StyleInjector } from '@kiao-dashboard-kit/diagram-shared';
import { getGraphStyleString } from '../lib/graph-styles';

export interface GraphStyleProps {
    themeVars?: Partial<DiagramTheme>;
}

export const GraphStyle: React.FC<GraphStyleProps> = ({ themeVars }) => (
    <StyleInjector css={getGraphStyleString(themeVars)} />
);
