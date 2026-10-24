/**
 * The import gate: what a store considers sensitive, and how badly.
 *
 * A **category** is one file of `kiao-user-config/import-gate/` — `secrets.json`, `hr.json`, one
 * of your own — holding a list of **matchers**, each a regular expression and a criticality. The
 * gate has no built-in list: everything it knows comes out of that folder, which worker
 * seeds with a working catalogue the first time it starts on a store. That is what makes a
 * category editable, switchable off, and committed with the store it belongs to.
 *
 * This module is the format and nothing else — parsing it, and what a criticality *is*. Running the
 * matchers over a text is {@link ./scan}, and drawing the result is {@link ./GatedTextView}.
 */

/**
 * How bad it would be. Four levels, ordered worst first, because the order is used: it decides the
 * colour a finding is painted in, and which of two overlapping findings survives.
 *
 * The scale is about **consequence**, not confidence. A matcher that fires often and means little
 * is `low`; one that rarely fires and means a credential is out is `critical`.
 */
export type Criticality = 'critical' | 'high' | 'medium' | 'low';

/** The levels, worst first. Also the display order of the counts in the navigator. */
export const CRITICALITIES: readonly Criticality[] = ['critical', 'high', 'medium', 'low'];

/** 0 is the worst. Sorting by this puts a leaked key above a postcode. */
export const criticalityRank = (level: Criticality): number => CRITICALITIES.indexOf(level);

const isCriticality = (value: unknown): value is Criticality =>
    typeof value === 'string' && (CRITICALITIES as readonly string[]).includes(value);

/** One rule, compiled and ready to run. */
export interface GateMatcher {
    /** Unique across the whole gate: the category and the matcher's place in it. Also its React key. */
    id: string;
    /** The category's id — the `category` field, or the file name when it has none. */
    category: string;
    /** What the category is called where a finding is named. */
    categoryLabel: string;
    /** What this rule is called. */
    label: string;
    criticality: Criticality;
    /** One line on what to do about it, or `''`. */
    hint: string;
    /** Always global, so {@link ./scan} can walk every occurrence. */
    regex: RegExp;
}

/**
 * Builds the regular expression, preferring Unicode mode.
 *
 * `u` is what makes `\p{Script=Greek}` and an astral character work, and it also rejects a handful
 * of patterns that are legal without it — a stray `{`, an unnecessary escape. A store's own
 * matchers are hand-written, so the strict pass is tried first and the lenient one catches what it
 * refuses; a pattern that compiles under neither is not a pattern.
 */
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

/** `enabled` is opt-out: everything is on unless a document says `false`. */
const isEnabled = (raw: Record<string, unknown>): boolean => raw.enabled !== false;

/**
 * Reads one category document into the matchers it declares.
 *
 * **Nothing here throws and nothing here is all-or-nothing.** These files are edited by hand, in a
 * store that is also being used, and a typo in the ninth matcher must not take the other eight —
 * still less the seven other categories — out of the gate. A rule that cannot be understood is
 * dropped with a line in the console, which is the only place it could usefully be reported: the
 * person who will fix it is the person who wrote it.
 *
 * @param fileName the document's own name, used as the category id when it declares none.
 */
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

/** The gate's own order: worst first, then by category and rule, so a list of it reads sensibly. */
export const sortMatchers = (matchers: GateMatcher[]): GateMatcher[] =>
    [...matchers].sort((a, b) =>
        criticalityRank(a.criticality) - criticalityRank(b.criticality)
        || a.categoryLabel.localeCompare(b.categoryLabel)
        || a.label.localeCompare(b.label));
