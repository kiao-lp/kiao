export const MAX_PASSES = 2_147_483_647;
export const LIMITER_BRANCHES = ['Passes left', 'No passes left'] as const;

export const isPassCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PASSES;

export const readLimiter = ({ maxPasses, remainingPasses }: { maxPasses?: unknown; remainingPasses?: unknown }) => {
    const maximum = isPassCount(maxPasses) ? maxPasses : 1;
    return {
        maxPasses: maximum,
        remainingPasses: isPassCount(remainingPasses) ? Math.min(remainingPasses, maximum) : maximum,
    };
};
