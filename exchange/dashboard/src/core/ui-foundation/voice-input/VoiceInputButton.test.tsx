import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from 'src/test/render';
import { VoiceInputProvider } from './VoiceInputContext';
import { VoiceInputButton } from './VoiceInputButton';

/** The dictation, as the browser would report it, without a browser. */
const speech = vi.hoisted(() => ({
    listening: false,
    transcript: '',
    supported: true,
    microphone: true,
    startListening: vi.fn(() => Promise.resolve()),
    stopListening: vi.fn(() => Promise.resolve()),
    resetTranscript: vi.fn(),
}));

vi.mock('react-speech-recognition', () => ({
    default: {
        startListening: speech.startListening,
        stopListening: speech.stopListening,
    },
    useSpeechRecognition: () => ({
        transcript: speech.transcript,
        listening: speech.listening,
        resetTranscript: speech.resetTranscript,
        browserSupportsSpeechRecognition: speech.supported,
        isMicrophoneAvailable: speech.microphone,
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    speech.listening = false;
    speech.transcript = '';
    speech.supported = true;
    speech.microphone = true;
});

const button = () => screen.getByRole('button', { name: 'Voice Input' });

const dictate = (onChange: (next: string) => void, value = '') => {
    const view = render(
        <VoiceInputProvider language="en-US">
            <VoiceInputButton value={value} onChange={onChange} />
        </VoiceInputProvider>,
    );
    fireEvent.click(button());
    return view;
};

describe('VoiceInputButton', () => {
    it('offers nothing where the browser has no speech recognition', () => {
        speech.supported = false;
        render(
            <VoiceInputProvider language="en-US">
                <VoiceInputButton value="" onChange={() => {}} />
            </VoiceInputProvider>,
        );
        expect(screen.queryByRole('button', { name: 'Voice Input' })).toBeNull();
    });

    it('offers nothing where there is no microphone to hear it', () => {
        speech.microphone = false;
        render(
            <VoiceInputProvider language="en-US">
                <VoiceInputButton value="" onChange={() => {}} />
            </VoiceInputProvider>,
        );
        expect(screen.queryByRole('button', { name: 'Voice Input' })).toBeNull();
    });

    it('offers nothing for a field that takes no dictation', () => {
        render(
            <VoiceInputProvider language="en-US">
                <VoiceInputButton value="" onChange={() => {}} disabled />
            </VoiceInputProvider>,
        );
        expect(screen.queryByRole('button', { name: 'Voice Input' })).toBeNull();
    });

    it('starts listening in the chosen language, and stops when pressed again', async () => {
        const { rerender } = dictate(() => {});
        expect(speech.startListening).toHaveBeenCalledWith({ continuous: true, language: 'en-US' });
        expect(button()).toHaveAttribute('aria-pressed', 'false');

        speech.listening = true;
        rerender(
            <VoiceInputProvider language="en-US">
                <VoiceInputButton value="" onChange={() => {}} />
            </VoiceInputProvider>,
        );
        expect(button()).toHaveAttribute('aria-pressed', 'true');

        await act(async () => { fireEvent.click(button()); });
        expect(speech.stopListening).toHaveBeenCalled();
    });

    it('writes what was said onto what the box already holds', () => {
        const onChange = vi.fn();
        const { rerender } = dictate(onChange, 'Hello');
        speech.transcript = 'there';
        speech.listening = true;
        rerender(
            <VoiceInputProvider language="en-US">
                <VoiceInputButton value="Hello" onChange={onChange} />
            </VoiceInputProvider>,
        );
        expect(onChange).toHaveBeenLastCalledWith('Hello there');
    });

    it('leaves the box its caret and its focus', () => {
        dictate(() => {});
        expect(fireEvent.mouseDown(button())).toBe(false);
        expect(fireEvent.mouseUp(button())).toBe(false);
    });
});
