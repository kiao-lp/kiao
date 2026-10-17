import type { Feature, Option, MoscowLevel } from './featmat-model';
import { supportLevel } from './featmat-model';
import { SUPPORT_INFO, MOSCOW_INFO, MAX_SUPPORT_SCORE, MAX_CELL_SCORE } from './featmat-constants';

// ── Scoring ──────────────────────────────────────────────────────────

export function computeCellScore(weight: number, supportScore: number): number {
    return weight * (MAX_SUPPORT_SCORE - supportScore);
}

export function cellBackground(cellScore: number): string {
    const alpha = (cellScore / MAX_CELL_SCORE) * 0.4;
    return `rgba(220, 80, 80, ${alpha.toFixed(3)})`;
}

export function computeOptionScore(
    option: Option,
    features: Feature[],
    moscow: Record<string, MoscowLevel>,
): number {
    let score = 0;
    for (const f of features) {
        const weight = MOSCOW_INFO[moscow[f.id] ?? 'could'].weight;
        const level = supportLevel(option.support[f.id]);
        const supportScore = level ? SUPPORT_INFO[level].score : 0;
        score += weight * supportScore;
    }
    return score;
}
