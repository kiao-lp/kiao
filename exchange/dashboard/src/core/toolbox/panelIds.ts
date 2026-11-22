export const TOOLBOX_TAB_ID = 'toolbox';
export const HARNESS_PROFILES_TAB_ID = 'harness-profiles';

export const harnessPanelId = (harness: string): string =>
    harness === 'pi' ? HARNESS_PROFILES_TAB_ID : `harness-models-${harness}`;
