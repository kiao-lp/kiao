/** Categories in `kiao-user-config/import-gate/*.json`. No built-in list. */

/** Consequence, not confidence. Worst first; decides colour and overlap winner. */
export type Criticality = 'critical' | 'high' | 'medium' | 'low';

/** Worst first; also navigator display order. */
export const CRITICALITIES: readonly Criticality[] = ['critical', 'high', 'medium', 'low'];

export const criticalityRank = (level: Criticality): number => CRITICALITIES.indexOf(level);

const isCriticality = (value: unknown): value is Criticality =>
    typeof value === 'string' && (CRITICALITIES as readonly string[]).includes(value);

export interface GateMatcher {
    /** Unique gate-wide; also the React key. */
    id: string;
    /** `category` field, or file name when absent. */
    category: string;
    categoryLabel: string;
    label: string;
    criticality: Criticality;
    /** Action hint, or `''`. */
    hint: string;
    /** Always global so {@link ./scan} walks every occurrence. */
    regex: RegExp;
}

/** Unicode mode first; fallback without `u` for hand-written patterns. */
const compilePattern = (pattern: string, caseSensitive: boolean): RegExp | null => {
    const flags = caseSensitive ? 'g' : 'gi';
    try {
        return new RegExp(pattern, flags + 'u');
    } catch {
        try {
            return new RegExp(pattern, flags);
        } catch {
            return null;
        }
    }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const isEnabled = (raw: Record<string, unknown>): boolean => raw.enabled !== false;

/** Never throws; invalid rules are dropped with a warning. */
export const parseCategory = (fileName: string, raw: unknown): GateMatcher[] => {
    const doc = asRecord(raw);
    if (!doc) {
        console.warn(`[import-gate] ${fileName} is not a category document`);
        return [];
    }
    if (!isEnabled(doc)) return [];

    const category = asString(doc.category) || fileName.replace(/\.json$/i, '');
    const categoryLabel = asString(doc.label) || category;
    const fallbackLevel = isCriticality(doc.criticality) ? doc.criticality : 'medium';
    const declared = Array.isArray(doc.matchers) ? doc.matchers : [];

    const matchers: GateMatcher[] = [];
    declared.forEach((entry, index) => {
        const rule = asRecord(entry);
        if (!rule || !isEnabled(rule)) return;
        const label = asString(rule.label);
        const pattern = asString(rule.pattern);
        if (!label || !pattern) {
            console.warn(`[import-gate] ${fileName}: matcher ${index} has no label or no pattern`);
            return;
        }
        const regex = compilePattern(pattern, rule.caseSensitive === true);
        if (!regex) {
            console.warn(`[import-gate] ${fileName}: ${label} is not a regular expression`);
            return;
        }
        matchers.push({
            id: `${category}/${index}`,
            category,
            categoryLabel,
            label,
            criticality: isCriticality(rule.criticality) ? rule.criticality : fallbackLevel,
            hint: asString(rule.hint),
            regex,
        });
    });
    return matchers;
};

export const sortMatchers = (matchers: GateMatcher[]): GateMatcher[] =>
    [...matchers].sort((a, b) =>
        criticalityRank(a.criticality) - criticalityRank(b.criticality)
        || a.categoryLabel.localeCompare(b.categoryLabel)
        || a.label.localeCompare(b.label));
