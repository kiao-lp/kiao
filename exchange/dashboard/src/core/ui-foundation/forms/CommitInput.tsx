import React, { useEffect, useRef, useState } from 'react';
import { Input, type InputProps, type InputRef } from 'antd';

interface CommitInputProps extends Omit<InputProps, 'value' | 'defaultValue' | 'onChange' | 'onPressEnter' | 'onKeyDown'> {
    value: string;
    /** Supply this when the caller owns the draft, for example to show live validation. */
    onDraftChange?: (value: string) => void;
    onCommit: (value: string) => void;
    onCancel?: () => void;
    blurOnEnter?: boolean;
    /** Keep a local draft when the saved value changes during typing. */
    preserveDraft?: boolean;
}

/** Edits a single line, committing on Enter or blur. The caller validates and saves the value. */
export const CommitInput = React.forwardRef<InputRef, CommitInputProps>(function CommitInput({
    value, onDraftChange, onCommit, onCancel, blurOnEnter, preserveDraft, onFocus, onBlur, ...props
}, ref) {
    const [draft, setDraft] = useState<string>();
    const settled = useRef(false);
    useEffect(() => {
        if (!preserveDraft) setDraft(undefined);
    }, [value, preserveDraft]);

    const finish = (input: HTMLInputElement, action = onCommit) => {
        if (settled.current || input.readOnly || input.matches(':disabled')) return;
        // A commit or cancellation can itself trigger blur, even before the caller rerenders.
        settled.current = true;
        setDraft(undefined);
        action(input.value);
    };

    return <Input
        size="small"
        {...props}
        ref={ref}
        value={draft ?? value}
        onFocus={event => {
            settled.current = false;
            onFocus?.(event);
        }}
        onChange={event => {
            settled.current = false;
            (onDraftChange ?? setDraft)(event.target.value);
        }}
        onBlur={event => {
            finish(event.currentTarget);
            onBlur?.(event);
        }}
        onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                finish(event.currentTarget);
                if (blurOnEnter) event.currentTarget.blur();
            } else if (event.key === 'Escape' && onCancel) {
                event.preventDefault();
                finish(event.currentTarget, () => onCancel());
            }
        }}
    />;
});
