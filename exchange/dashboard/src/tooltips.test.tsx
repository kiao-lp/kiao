import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
    TYPE_HELP, AGENT_HELP, EFFORT_HELP, PERMISSION_HELP, FOLDER_HELP, SCHEDULE_HELP,
    STATUS_HELP, CHAT_HELP as FLOW_NODE_CHAT_HELP, UNLINK_HELP, NEXT_HELP, TRANSITION_HELP,
    COMPACT_HELP, TRANSITION_BROKEN, TAGS_HELP as FLOW_NODE_TAGS_HELP,
} from './plugins/hybridflow-ui/components/FlowNodeControls';
import {
    NAME_HELP, PLATFORM_HELP, MODEL_HELP, INSTRUCTIONS_HELP, DELETE_HELP,
} from './plugins/hybridflow-ui/components/AgentsPanel';
import {
    MODE_NOTE, CHAIN_HELP, BROKEN_NOTE, MARK_HELP,
    CHAT_HELP as CARD_CHAT_HELP,
} from './plugins/hybridflow-ui/components/FlowNodeCard';
import { TAGS_HELP as PICKER_TAGS_HELP } from './plugins/tags/TagPicker';
import { RENAME_HELP, COLOR_HELP } from './plugins/tags/TagsPanel';
import { HELP as FLOW_NODE_TEMPLATE_HELP } from './plugins/hybridflow-ui/components/FlowNodeTemplateSelect';
import { PERMISSION_MODE_HELP } from './plugins/chat/ChatConversationPane';
import { SYNTAX_HELP as FILE_SEARCH_SYNTAX_HELP } from './cms-core/files/browser/FileSearchInput';
import { SYNTAX_HELP as TEMPLATE_SYNTAX_HELP } from './plugins/template-edit/TemplateEditor';
import { KIND_META } from './cms-core/toolbox/itemKinds';

/**
 * The repository rule (decisions/00053-tooltip-under-30-words.md): a tooltip is clear,
 * concise and under 30 words. Every tooltip text held in a constant is listed
 * here by name. Allow a small margin for wording changes, while catching empty or verbose help.
 *
 * Dynamic values a tooltip carries — a file name, a path, a count — are not
 * counted; only these authored texts are. Single-line literal titles are all
 * short by inspection and need no guard beyond this file's existence.
 */

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** What a rich (JSX) tooltip reads as, once rendered. */
const jsxWords = (node: React.ReactNode): number => {
    const { container, unmount } = render(<>{node}</>);
    const count = words(container.textContent ?? '');
    unmount();
    return count;
};

const STRINGS: [string, string][] = [
    ['FlowNodeControls TYPE_HELP', TYPE_HELP],
    ['FlowNodeControls AGENT_HELP', AGENT_HELP],
    ['FlowNodeControls EFFORT_HELP', EFFORT_HELP],
    ['FlowNodeControls PERMISSION_HELP', PERMISSION_HELP],
    ['FlowNodeControls FOLDER_HELP', FOLDER_HELP],
    ['FlowNodeControls SCHEDULE_HELP', SCHEDULE_HELP],
    ['FlowNodeControls STATUS_HELP', STATUS_HELP],
    ['FlowNodeControls CHAT_HELP', FLOW_NODE_CHAT_HELP],
    ['FlowNodeControls UNLINK_HELP', UNLINK_HELP],
    ['FlowNodeControls NEXT_HELP', NEXT_HELP],
    ['FlowNodeControls TRANSITION_HELP', TRANSITION_HELP],
    ['FlowNodeControls COMPACT_HELP', COMPACT_HELP],
    ['FlowNodeControls TRANSITION_BROKEN', TRANSITION_BROKEN],
    ['FlowNodeControls TAGS_HELP', FLOW_NODE_TAGS_HELP],
    ['AgentsPanel NAME_HELP', NAME_HELP],
    ['AgentsPanel PLATFORM_HELP', PLATFORM_HELP],
    ['AgentsPanel MODEL_HELP', MODEL_HELP],
    ['AgentsPanel INSTRUCTIONS_HELP', INSTRUCTIONS_HELP],
    ['AgentsPanel DELETE_HELP', DELETE_HELP],
    ['FlowNodeCard CHAIN_HELP', CHAIN_HELP],
    ['FlowNodeCard BROKEN_NOTE', BROKEN_NOTE],
    ['FlowNodeCard CHAT_HELP', CARD_CHAT_HELP],
    ['TagPicker TAGS_HELP', PICKER_TAGS_HELP],
    ['TagsPanel RENAME_HELP', RENAME_HELP],
    ['TagsPanel COLOR_HELP', COLOR_HELP],
    ['FlowNodeTemplateSelect HELP', FLOW_NODE_TEMPLATE_HELP],
    ...Object.entries(PERMISSION_MODE_HELP).map(([mode, text]): [string, string] =>
        [`AgentConversationPane PERMISSION_MODE_HELP.${mode}`, text]),
    ...Object.entries(MODE_NOTE).map(([mode, text]): [string, string] =>
        [`FlowNodeCard MODE_NOTE.${mode}`, text]),
    ...Object.entries(MARK_HELP).map(([type, text]): [string, string] =>
        [`FlowNodeCard MARK_HELP.${type}`, text as string]),
    ...Object.entries(KIND_META).map(([kind, meta]): [string, string] =>
        [`itemKinds KIND_META.${kind}.hint`, meta.hint]),
];

const RICH: [string, React.ReactNode][] = [
    ['FileSearchInput SYNTAX_HELP', FILE_SEARCH_SYNTAX_HELP],
    ['TemplateEditor SYNTAX_HELP', TEMPLATE_SYNTAX_HELP],
];

describe('tooltips stay concise (1–35 words, targeting under 30)', () => {
    for (const [name, text] of STRINGS) {
        it(name, () => {
            const count = words(text);
            expect(count, `${name} is ${count} words: ${text}`).toBeGreaterThanOrEqual(1);
            expect(count, `${name} is ${count} words: ${text}`).toBeLessThanOrEqual(35);
        });
    }
    for (const [name, node] of RICH) {
        it(name, () => {
            const count = jsxWords(node);
            expect(count, `${name} is ${count} words`).toBeGreaterThanOrEqual(1);
            expect(count, `${name} is ${count} words`).toBeLessThanOrEqual(35);
        });
    }
});
