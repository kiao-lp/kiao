// Capabilities pass through manifests, not imports. The registry is fixed before first render.
// Missing providers are normal; accessors return no-ops.

import React from 'react';
import { usePluginCapabilities } from '@kiao-dashboard-core';

export interface TagsCapability {
    /** Store colours, grey for unknown labels. */
    TagChips: React.FC<{ labels?: string[]; className?: string }>;
    /** Typed labels immediately join the store's list. */
    TagPicker: React.FC<{
        value: string[];
        onChange: (next: string[]) => void;
        className?: string;
        'aria-label'?: string;
        'data-testid'?: string;
    }>;
}

/** Register new names here and in the provider manifest. */
export interface Capabilities {
    'tags.ui': TagsCapability;
}

const NO_PROVIDERS: never[] = [];

/** All providers in assembly order; empty if none. */
export const useCapability = <K extends keyof Capabilities>(name: K): Capabilities[K][] =>
    (usePluginCapabilities()[name] as Capabilities[K][] | undefined) ?? NO_PROVIDERS;

const NoTags: React.FC<any> = () => null;
const ABSENT_TAGS: TagsCapability = { TagChips: NoTags, TagPicker: NoTags };

/** First provider in assembly order; both components render nothing if absent. */
export const useTagsUi = (): TagsCapability => useCapability('tags.ui')[0] ?? ABSENT_TAGS;

/** Gates surfaces consisting entirely of tags, such as the board filter row. */
export const useTagsAvailable = (): boolean => useCapability('tags.ui').length > 0;
