import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from 'src/test/render';
import { VoiceInputProvider } from './VoiceInputContext';
import { VoiceInputButton } from './VoiceInputButton';
import { VoiceInput } from './VoiceInput';
import { VoiceTextArea } from './VoiceTextArea';

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

const startDictation = async (mic = button()) => {
    await act(async () => {
        fireEvent.click(mic);
        speech.listening = true;
    });
};

const dictate = async (onChange: (next: string) => void, value = '') => {
    const view = render(
        <VoiceInputProvider language="en-US">
            <VoiceInputButton value={value} onChange={onChange} />
        </VoiceInputProvider>,
    );
    await startDictation();
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
        await dictate(() => {});
        expect(speech.startListening).toHaveBeenCalledWith({ continuous: true, language: 'en-US' });
        expect(button()).toHaveAttribute('aria-pressed', 'true');

        await act(async () => { fireEvent.click(button()); });
        expect(speech.stopListening).toHaveBeenCalledTimes(1);
    });

    it('writes what was said onto what the box already holds', async () => {
        const onChange = vi.fn();
        const { rerender } = await dictate(onChange, 'Hello');
        speech.transcript = 'there';
        rerender(
            <VoiceInputProvider language="en-US">
                <VoiceInputButton value="Hello" onChange={onChange} />
            </VoiceInputProvider>,
        );
        expect(onChange).toHaveBeenLastCalledWith('Hello there');
    });

    it('leaves the box its caret and its focus', () => {
        render(
            <VoiceInputProvider language="en-US">
                <VoiceInputButton onChange={() => {}} />
            </VoiceInputProvider>,
        );
        expect(fireEvent.mouseDown(button())).toBe(false);
        expect(fireEvent.mouseUp(button())).toBe(false);
    });

    it('keeps dictating when another field unmounts and stops when its field becomes read-only', async () => {
        const onChange = vi.fn();
        const form = (includeOther: boolean, readOnly = false) => (
            <VoiceInputProvider language="en-US">
                <VoiceInput aria-label="Name" value="Hello" onChange={onChange} readOnly={readOnly} />
                {includeOther && <VoiceTextArea aria-label="Notes" />}
            </VoiceInputProvider>
        );
        const { rerender } = render(form(true));
        const [mic, other] = screen.getAllByRole('button', { name: 'Voice Input' });
        await startDictation(mic);

        speech.transcript = 'there';
        rerender(form(true));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(other).toBeDisabled();
        rerender(form(false));
        expect(speech.stopListening).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenCalledTimes(1);
        rerender(form(false, true));
        expect(speech.stopListening).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Voice Input' })).toBeNull();
    });

    it.each([VoiceInput, VoiceTextArea])('adapts dictation to the field change handler', async Field => {
        const onChange = vi.fn();
        const form = () => (
            <VoiceInputProvider language="en-US">
                <Field aria-label="Text" defaultValue="Hello" onChange={onChange} />
            </VoiceInputProvider>
        );
        const { rerender } = render(form());
        await startDictation();
        speech.transcript = 'comma world';
        rerender(form());
        expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('Hello, world');
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
            target: { value: 'Hello, world' },
            currentTarget: { value: 'Hello, world' },
        }));
    });
});
