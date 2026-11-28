import React, { type MouseEvent } from 'react';
import { AudioOutlined } from '@ant-design/icons';
import { ConfigProvider } from 'antd';
import { IconButton } from '../toolbar/IconButton';
import { useVoiceInputHook } from './useVoiceInputHook';

export interface VoiceInputButtonProps {
    value?: string;
    onChange: (next: string) => void;
    disabled?: boolean;
    inline?: boolean;
    /** Place the microphone in a field, with null when dictation is unavailable. */
    children?: (button: React.ReactElement | null) => React.ReactElement;
}

const keepFocus = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
};

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
    value, onChange, disabled, inline, children,
}) => {
    const { componentDisabled } = ConfigProvider.useConfig();
    const { showMic, listening, busy, toggleListening } = useVoiceInputHook(
        value, onChange, !(disabled ?? componentDisabled),
    );
    const button = showMic ? (
        <IconButton
            label="Voice Input"
            type={listening ? 'primary' : inline ? 'text' : 'default'}
            style={inline ? { width: 20, height: 20 } : undefined}
            icon={<AudioOutlined />}
            disabled={busy}
            aria-pressed={listening}
            onMouseDown={keepFocus}
            onMouseUp={keepFocus}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
            }}
            onClick={event => {
                event.stopPropagation();
                void toggleListening();
            }}
        />
    ) : null;

    return children ? children(button) : button;
};
