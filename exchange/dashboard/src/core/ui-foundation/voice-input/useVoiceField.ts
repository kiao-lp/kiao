import { useState, type ChangeEvent, type ChangeEventHandler } from 'react';
import type { InputProps } from 'antd';

export function useVoiceField<T extends HTMLInputElement | HTMLTextAreaElement>({
    value, defaultValue, onChange,
}: {
    value?: InputProps['value'];
    defaultValue?: InputProps['defaultValue'];
    onChange?: ChangeEventHandler<T>;
}) {
    const [draft, setDraft] = useState(defaultValue);
    const fieldValue = value === undefined ? draft : value;
    const change = (event: ChangeEvent<T>) => {
        if (value === undefined) setDraft(event.target.value);
        onChange?.(event);
    };

    return {
        value: fieldValue,
        text: String(fieldValue ?? ''),
        onChange: change,
        dictate: (next: string) => {
            // The field API exposes the value through its existing change handler.
            const target = { value: next };
            change({ target, currentTarget: target } as ChangeEvent<T>);
        },
    };
}
