/**
 * Feature support: `ootb` works natively with no setup; `configuration` needs settings, no code (pretty easy to get);
 * `customization` needs code, plugins or integration (pretty hard to get);
 * `not-supported` is unavailable or hard, very hard or impossible to achieve.
 */
export type SupportLevel = 'ootb' | 'configuration' | 'customization' | 'not-supported';
export type MoscowLevel = 'must' | 'should' | 'could' | 'wont';

export interface Feature {
    id: string;
    label: string;
    description?: string;
}

/** Object entries can explain the level with a markdown comment. */
export type SupportEntry = SupportLevel | { level: SupportLevel; comment?: string };

export function supportLevel(entry: SupportEntry | undefined): SupportLevel | undefined {
    if (entry == null) return undefined;
    return typeof entry === 'string' ? entry : entry.level;
}

export function supportComment(entry: SupportEntry | undefined): string | undefined {
    if (entry == null || typeof entry === 'string') return undefined;
    return entry.comment;
}

export interface Option {
    id: string;
    label: string;
    support: Record<string, SupportEntry>;
}

/** Named MoSCoW preset stored in JSON; editing its weights switches the UI to "Custom". */
export interface RequirementList {
    id: string;
    label: string;
    description?: string;
    /** Feature IDs to MoSCoW levels; omitted IDs default to 'could'. */
    weights: Partial<Record<string, MoscowLevel>>;
}

export interface FeatMatrixProps {
    features: Feature[];
    options: Option[];
    requirements?: RequirementList[];
    /** SVG export callback; defaults to browser download when omitted. */
    onExportSvg?: (svg: string) => void;
    /** Reports a MoSCoW change within a requirement list. */
    onRequirementChange?: (reqId: string, featureId: string, level: MoscowLevel) => void;
}
