import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkerClient } from '../../files/service/ui';
import { useTheme } from '../../ui-foundation/theme/ThemeContext';
import { useVoiceInput } from '../../ui-foundation/voice-input/VoiceInputContext';
import { SplitRow } from './PersistentSplitRow';
import { ThemePreferences } from './ThemePreferences';
import { VoiceInputPreferences } from './VoiceInputPreferences';
import { ViewStateProvider } from '../../view-state/ViewState-ctx';
import { VIEW_STATE_DOC } from '../../view-state/viewStateModel';

vi.mock('../../files/service/ui', () => ({ useWorkerClient: vi.fn() }));

const Preferences = () => {
    const { theme, setTheme } = useTheme();
    const { language, setLanguage } = useVoiceInput();
    return <>
        <button onClick={() => setTheme('light')}>{theme}</button>
        <button onClick={() => setLanguage('en-US')}>{language}</button>
        <SplitRow id="example" parts={[{ name: 'left' }, { name: 'right' }]} />
    </>;
};

describe('UI preferences', () => {
    it('restores and writes existing theme, voice and split keys through the reusable widgets', async () => {
        const saved = {
            version: 1, files: {}, folders: {},
            global: { theme: 'dark', voiceLanguage: 'fr-FR', 'split:example': { left: 1.5, right: 0.5 } },
        };
        const saveConfigJson = vi.fn().mockResolvedValue(undefined);
        vi.mocked(useWorkerClient).mockReturnValue({
            getConfigJson: vi.fn().mockResolvedValue(saved), saveConfigJson,
        } as any);
        const { container, unmount } = render(<ViewStateProvider>
            <ThemePreferences><VoiceInputPreferences><Preferences /></VoiceInputPreferences></ThemePreferences>
        </ViewStateProvider>);

        await screen.findByRole('button', { name: 'dark' });
        expect(screen.getByRole('button', { name: 'fr-FR' })).toBeVisible();
        await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
        const left = container.querySelector<HTMLElement>('[data-split-part="left"]')!;
        const right = container.querySelector<HTMLElement>('[data-split-part="right"]')!;
        expect(left.style.flexGrow).toBe('1.5');
        expect(right.style.flexGrow).toBe('0.5');

        fireEvent.click(screen.getByRole('button', { name: 'dark' }));
        fireEvent.click(screen.getByRole('button', { name: 'fr-FR' }));
        left.getBoundingClientRect = () => ({ width: 750 }) as DOMRect;
        right.getBoundingClientRect = () => ({ width: 250 }) as DOMRect;
        const handle = screen.getByRole('separator');
        for (const [type, clientX] of [['pointerdown', 0], ['pointermove', -100], ['pointerup', -100]] as const) {
            const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
            Object.defineProperty(event, 'pointerId', { value: 1 });
            fireEvent(handle, event);
        }
        expect(left.style.flexGrow).toBe('1.3');
        expect(right.style.flexGrow).toBe('0.7');
        await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'));

        act(unmount);
        await waitFor(() => expect(saveConfigJson).toHaveBeenCalledWith(VIEW_STATE_DOC, expect.objectContaining({
            global: { theme: 'light', voiceLanguage: 'en-US', 'split:example': { left: 1.3, right: 0.7 } },
        })));
    });
});
