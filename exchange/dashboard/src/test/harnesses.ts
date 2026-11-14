import type { HarnessOptionsEntry } from 'kiao-worker';

export const permissionModes = () => [
    { value: 'manual', label: 'Manual' },
    { value: 'manualLive', label: 'Manual Live' },
    { value: 'bypassPermissions', label: 'Bypass permissions' },
];

/** Each caller owns its lists and can change them without changing another suite's catalogue. */
export const harnessOptions = (overrides: Partial<HarnessOptionsEntry> = {}): HarnessOptionsEntry => ({
    value: 'claude', label: 'Claude',
    models: [{ value: 'haiku', label: 'Haiku' }],
    efforts: [{ value: 'low', label: 'Low' }],
    permissionModes: permissionModes(),
    ...overrides,
});
