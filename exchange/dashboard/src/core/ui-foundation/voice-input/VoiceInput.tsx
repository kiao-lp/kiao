import React from 'react';
import { Input, type InputProps, type InputRef } from 'antd';
import { VoiceInputButton } from './VoiceInputButton';
import { useVoiceField } from './useVoiceField';
import './VoiceInput.css';

export type VoiceInputProps = InputProps;

export const VoiceInput = React.forwardRef<InputRef, VoiceInputProps>(function VoiceInput(
    { value, defaultValue, onChange, suffix, ...props }, ref,
) {
    const field = useVoiceField({ value, defaultValue, onChange });

    return (
        <VoiceInputButton
            value={field.text}
            onChange={field.dictate}
            disabled={props.readOnly || props.disabled}
            inline
        >
            {button => (
                <Input
                    {...props}
                    ref={ref}
                    value={field.value}
                    onChange={field.onChange}
                    suffix={button ? <span className="voice-input-suffix">{suffix}{button}</span> : suffix}
                />
            )}
        </VoiceInputButton>
    );
});
