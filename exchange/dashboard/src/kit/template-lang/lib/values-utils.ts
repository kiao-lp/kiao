import { KiaoElObject } from './kiao-expr-lang';

/**
 * Get unique type names from provided objects
 */
export const getRegisteredTypes = (objects: KiaoElObject[]): string[] => {
    const types = new Set<string>();
    objects.forEach(obj => types.add(obj.type));
    return Array.from(types);
};

/**
 * Get objects for a specific type
 */
export const getObjectsForType = (objects: KiaoElObject[], type: string): KiaoElObject[] => {
    return objects.filter(obj => obj.type === type);
};

/**
 * Get all objects (for untyped lookups)
 */
export const getAllObjects = (objects: KiaoElObject[]): KiaoElObject[] => {
    return objects;
};
