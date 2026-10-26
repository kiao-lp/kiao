import type { SupportLevel, MoscowLevel } from './featmat-model';

// ── Constants ────────────────────────────────────────────────────────

export const SUPPORT_INFO: Record<SupportLevel, { label: string; emoji: string; score: number }> = {
    'ootb':          { label: 'Out of the Box',    emoji: '\u2705', score: 3 },
    'configuration': { label: 'Configuration',     emoji: '\uD83D\uDD27', score: 2 },
    'customization': { label: 'Customization',     emoji: '\uD83D\uDD28', score: 1 },
    'not-supported': { label: 'Not Supported',     emoji: '\u274C', score: 0 },
};

export const MOSCOW_INFO: Record<MoscowLevel, { label: string; short: string; weight: number }> = {
    'must':   { label: 'Must',   short: 'M', weight: 8 },
    'should': { label: 'Should', short: 'S', weight: 4 },
    'could':  { label: 'Could',  short: 'C', weight: 2 },
    'wont':   { label: "Won't",  short: 'W', weight: 0 },
};

export const MOSCOW_LEVELS: MoscowLevel[] = ['must', 'should', 'could', 'wont'];

export const MAX_SUPPORT_SCORE = 3;
export const MAX_CELL_SCORE = MOSCOW_INFO['must'].weight * MAX_SUPPORT_SCORE; // 24

export const HELP_MARKDOWN = `Set the **priority** for each feature to see which tools best fit your use case.

## How it works

1. Set the **priority** (MoSCoW) for each feature using the dropdown in the Priority column
2. Tools are automatically **scored and reordered** — best match first
3. Features are sorted by priority — Must-haves appear at the top

### Scoring

Each feature contributes \`moscow_weight × support_score\` to a tool's total:

| MoSCoW | Weight | Support Level  | Score |
|--------|--------|----------------|-------|
| Must   | 8      | Out of the Box | 3     |
| Should | 4      | Configuration  | 2     |
| Could  | 2      | Customization  | 1     |
| Won't  | 0      | Not Supported  | 0     |
`;
