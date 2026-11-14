/**
 * Kiao Expression Language
 *
 * Syntax: ${key:typeSpec=defaultValue}
 *
 * Where typeSpec can be:
 * - A type name: "text", "file", "AwsRegion", etc.
 * - A type name with field: "type.field"
 * - An inline enum: "value1"|"value2"|"value3"
 *
 * Examples:
 * - ${name}                     // simple variable
 * - ${name:text}                // text input
 * - ${doc:file}                 // a file of the store, dropped in from the tree
 * - ${doc:file.name}            // that file's name alone
 * - ${region:AwsRegion}         // type lookup → dropdown
 * - ${region:AwsRegion.code}    // type with field
 * - ${type:"feat"|"fix"|"chore"} // inline enum → dropdown
 * - ${name:text=John}           // text with default
 * - ${level:"a"|"b"|"c"=b}      // enum with default
 */

/**
 * The three types the app draws a field for out of itself: free text, the list an inline enum
 * carries, and a file of the store. Every other name is a **lookup** against the value providers a
 * store declares, so these are the ones that are never looked up — which is the whole of what
 * "built-in" means here.
 */
export const TEXT_TYPE = 'text';
export const ENUM_TYPE = 'enum';
export const FILE_TYPE = 'file';

export const isBuiltInType = (type: string | undefined): boolean =>
    type === TEXT_TYPE || type === ENUM_TYPE || type === FILE_TYPE;

/** The custom fields of a value, grouped under `object`. */
export type KiaoElFields = Record<string, string | boolean | number | undefined>;

export interface KiaoElObject {
    type: string;
    value: string;
    /**
     * The custom fields, grouped. `kiao-user-config/values/*.json` files are written in this
     * shape — `{ type, value, object: { ...fields } }` — so the two reserved keys never mix with
     * the fields a template reads. A file written before the grouping still reads: field lookup
     * falls back to the root (see `kiaoFieldOf`).
     */
    object?: KiaoElFields;
    [key: string]: string | boolean | number | KiaoElFields | undefined;
    /** Optional: indicates if this value is pinned for browser persistence */
    __pinned?: boolean;
    /** Optional: timestamp when value was pinned */
    __pinnedAt?: number;
}

/**
 * Read one field of a value object, wherever it is held.
 *
 * The placeholder says `${key:Type.field}` and nothing else: whether the file holds `field`
 * beside `type` and `value` (the shape before grouping) or under `object` (the shape since)
 * is not part of the access. The root wins where both hold it — a typed answer shadowing a
 * configured one. `object` itself is not a field and reads as nothing.
 */
export const kiaoFieldOf = (obj: KiaoElObject, field: string): string | boolean | number | undefined => {
    if (field === 'object') return undefined;
    const direct = obj[field];
    if (direct !== undefined) return typeof direct === 'object' ? undefined : direct;
    const nested = obj.object;
    if (nested !== undefined && typeof nested === 'object') return nested[field];
    return undefined;
};

export interface KiaoElHeap { [key: string]: KiaoElObject }

export interface ParsedExpression {
    key: string;
    type: string | undefined;
    field: string;
    defaultValue: string | undefined;
    enumValues: string[] | undefined;
    raw: string;
}

/**
 * Extract all ${...} expressions from text
 */
export const extractKbElExpr = (text: string): string[] => {
    const matches = text.match(/\${(.*?)}/g);
    return matches ? matches.map(match => match.slice(2, -1)) : [];
}

/**
 * Check if a typeSpec looks like an inline enum: "a"|"b"|"c"
 */
const isInlineEnum = (typeSpec: string): boolean => {
    return typeSpec.includes('|') && typeSpec.includes('"');
}

/**
 * Parse inline enum values: "feat"|"fix"|"chore" → ["feat", "fix", "chore"]
 */
const parseInlineEnum = (typeSpec: string): string[] => {
    const matches = typeSpec.match(/"([^"]*)"/g);
    return matches ? matches.map(m => m.slice(1, -1)) : [];
}

/**
 * Parse a single expression string into its components.
 *
 * Format: key:typeSpec=defaultValue
 *
 * @param kbElExpr - The expression without ${ }
 * @returns Parsed expression object
 */
export const kbElExprParse = (kbElExpr: string): ParsedExpression => {
    // Split off default value first (handle = in the expression)
    const eqIndex = kbElExpr.lastIndexOf('=');
    let mainPart: string;
    let defaultValue: string | undefined;

    if (eqIndex !== -1) {
        mainPart = kbElExpr.slice(0, eqIndex);
        defaultValue = kbElExpr.slice(eqIndex + 1);
    } else {
        mainPart = kbElExpr;
        defaultValue = undefined;
    }

    // Split key from typeSpec
    const colonIndex = mainPart.indexOf(':');
    let key: string;
    let typeSpec: string | undefined;

    if (colonIndex !== -1) {
        key = mainPart.slice(0, colonIndex);
        typeSpec = mainPart.slice(colonIndex + 1);
    } else {
        key = mainPart;
        typeSpec = undefined;
    }

    // Parse typeSpec
    let type: string | undefined;
    let field: string = "value";
    let enumValues: string[] | undefined;

    if (typeSpec) {
        if (isInlineEnum(typeSpec)) {
            // Inline enum: "a"|"b"|"c"
            enumValues = parseInlineEnum(typeSpec);
            type = ENUM_TYPE;
        } else {
            // Type name, possibly with field: type.field
            const dotIndex = typeSpec.indexOf('.');
            if (dotIndex !== -1) {
                type = typeSpec.slice(0, dotIndex);
                field = typeSpec.slice(dotIndex + 1);
            } else {
                type = typeSpec;
            }
        }
    }

    return { key, type, field, defaultValue, enumValues, raw: kbElExpr };
}

/**
 * Parse with defaults applied - convenience wrapper
 */
export const kbElExprParseWithDefault = (kbElExpr: string, defaultField: string = "value"): [string, string | undefined, string] => {
    const parsed = kbElExprParse(kbElExpr);
    return [parsed.key, parsed.type, parsed.field || defaultField];
}

/**
 * Substitute all expressions in text using values from the heap.
 * Loops until no more substitutions can be made.
 */
export const kbElInstantiateText = (heap: KiaoElHeap, text: string): string => {
    let loop = true;

    while (loop) {
        loop = false;

        const kbElExprs = extractKbElExpr(text);
        for (const kbElExpr of kbElExprs) {
            const parsed = kbElExprParse(kbElExpr);
            const object = heap[parsed.key];

            if (object !== undefined && object !== null) {
                const value = kiaoFieldOf(object, parsed.field || "value");
                if (value !== undefined && value !== null && typeof value === 'string') {
                    text = text.replaceAll("${" + kbElExpr + "}", value);
                    loop = true;
                }
            }
        }
    }

    return text;
}
