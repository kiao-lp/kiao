import React, { MouseEvent } from 'react';
import { Button } from 'antd';
import { AudioOutlined } from '@ant-design/icons';
import { useVoiceInput as useVoiceInputContext } from './VoiceInputContext';
import { useVoiceInputHook } from './useVoiceInputHook';

export interface VoiceInputButtonProps {
    /** What the box being dictated into holds; speech is appended to it. */
    value?: string;
    onChange: (next: string) => void;
    /** The field takes no dictation, so there is no microphone to press. */
    disabled?: boolean;
}

/**
 * The microphone for a box that cannot carry one of its own — a plain `<textarea>` in a row of
 * controls. Dictation lands in the box without taking its focus. Nothing renders where the
 * browser has no speech recognition.
 */
export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
    value, onChange, disabled,
}) => {
    const { language } = useVoiceInputContext();
    const { showMic, listening, toggleListening } = useVoiceInputHook(
        event => onChange(event.target.value), value, language, !disabled);

    if (!showMic) return null;

    // The box keeps its caret and its focus: the click dictates without ending what was being typed.
    const keepFocus = (event: MouseEvent) => event.preventDefault();

    return (
        <Button
            size="small"
            type={listening ? 'primary' : 'default'}
            icon={<AudioOutlined />}
            aria-label="Voice Input"
            aria-pressed={listening}
            onMouseDown={keepFocus}
            onMouseUp={keepFocus}
            onClick={toggleListening}
        />
    );
};
