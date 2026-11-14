import { describe, it, expect } from 'vitest';
import {
    AGENT_HELP, EFFORT_HELP, PERMISSION_HELP, FOLDER_HELP, RUNNER_HELP, SCHEDULE_HELP,
    STATUS_HELP, UNLINK_HELP, NEXT_HELP, BRANCHES_HELP, TRANSITION_HELP,
    COMPACT_HELP, TRANSITION_BROKEN, COMPLEXITY_HELP, VALUE_TYPE_HELP,
} from './plugins/hybridflow-ui/components/FlowNodeControls';
import {
    HARNESS_HELP, INSTRUCTIONS_HELP, DELETE_HELP,
} from './plugins/hybridflow-ui/components/AgentEditorPanel';
import {
    SEEN_HELP, DELETE_HELP as RUNNER_DELETE_HELP, ITS_ME_HELP, ENV_PINNED_HELP,
} from './plugins/hybridflow-ui/components/RunnersPanel';
import {
    CHAIN_HELP, GATEWAY_CHAIN_HELP, BROKEN_NOTE, INVALID_HELP, MARK_HELP,
} from './plugins/hybridflow-ui/components/FlowNodeCard';
import { TAGS_HELP } from './plugins/tags/TagPicker';
import { RENAME_HELP } from './plugins/tags/TagsPanel';
import { HELP as FLOW_NODE_TEMPLATE_HELP } from './plugins/hybridflow-ui/components/FlowNodeTemplateMenu';
import { PERMISSION_MODE_HELP } from './plugins/chat/ChatConversationPane';
import { SYNTAX_HELP as FILE_SEARCH_SYNTAX_HELP } from './core/files/browser/FileSearchInput';
import { SYNTAX_HELP as TEMPLATE_SYNTAX_HELP } from './kit/template-fields/TemplateCollectionEditor';
import { KIND_META } from './core/toolbox/itemKinds';

const STRINGS = {
    AGENT_HELP, EFFORT_HELP, PERMISSION_HELP, FOLDER_HELP, RUNNER_HELP, SCHEDULE_HELP,
    STATUS_HELP, UNLINK_HELP, NEXT_HELP, BRANCHES_HELP, TRANSITION_HELP,
    COMPACT_HELP, TRANSITION_BROKEN, COMPLEXITY_HELP, VALUE_TYPE_HELP,
    HARNESS_HELP, INSTRUCTIONS_HELP, DELETE_HELP,
    SEEN_HELP, RUNNER_DELETE_HELP, ITS_ME_HELP, ENV_PINNED_HELP,
    CHAIN_HELP, GATEWAY_CHAIN_HELP, BROKEN_NOTE, INVALID_HELP,
    TAGS_HELP, RENAME_HELP, FLOW_NODE_TEMPLATE_HELP,
    FILE_SEARCH_SYNTAX_HELP, TEMPLATE_SYNTAX_HELP,
    ...PERMISSION_MODE_HELP,
    ...MARK_HELP,
    ...Object.fromEntries(Object.entries(KIND_META).map(([kind, meta]) => [kind, meta.hint])),
};

describe('tooltip descriptions use at most 16 words (decision 00038)', () => {
    for (const [name, text] of Object.entries(STRINGS)) {
        it(name, () => {
            const count = text.split(/\s+/).filter(Boolean).length;
            expect(count, `${name}: ${text}`).toBeGreaterThanOrEqual(1);
            expect(count, `${name} is ${count} words: ${text}`).toBeLessThanOrEqual(16);
        });
    }
});
