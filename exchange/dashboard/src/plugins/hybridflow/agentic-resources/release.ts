export const releaseBumps = ['major', 'minor', 'patch'] as const;
export type ReleaseBump = typeof releaseBumps[number];

export function nextReleaseVersion(version: string, bump: ReleaseBump): string {
    const parts = version.split('.').map(part => BigInt(part));
    const component = releaseBumps.indexOf(bump);
    parts[component] += 1n;
    parts.fill(0n, component + 1);
    return parts.join('.');
}
