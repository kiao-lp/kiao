/**
 * Injects a skinparam theme block into a PlantUML diagram source.
 * The block is inserted right after the @start... line.
 */
export function injectPlantUMLTheme(source: string, skinparams: string): string {
    const startMatch = source.match(/^(@start\w+[^\n]*)/m);
    if (!startMatch) return skinparams + '\n' + source;
    const idx = source.indexOf(startMatch[0]) + startMatch[0].length;
    return source.slice(0, idx) + '\n' + skinparams + '\n' + source.slice(idx);
}
