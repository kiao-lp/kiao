import React from 'react';
import { KiaoElObject } from '@cms-kit/template-lang';

/**
 * Props passed to input components
 */
export interface InputProps {
    kbElExpr: string;
    defaultValue?: string;
    enumValues?: string[];
}

/**
 * Definition for a type in the registry
 */
export interface TypeDefinition {
    name: string;
    inputComponent: React.FC<InputProps>;
    dataSource?: () => KiaoElObject[];
}

// Re-export for backward compatibility
export { useConfigValues } from '@cms-kit/template-fields';
export { getRegisteredTypes, getObjectsForType, getAllObjects } from '@cms-kit/template-lang';
