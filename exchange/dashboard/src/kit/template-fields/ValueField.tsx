import React, { createContext, useCallback, useContext } from 'react';
import { AutoComplete, Input, Select } from 'antd';
import { storeLinkOf } from 'kiao-worker/utils';
import { extractName, useFileDrop, VoiceTextArea } from '@cms-core';

import { FILE_TYPE, isBuiltInType, kbElExprParse, KiaoElHeap, KiaoElObject, ParsedExpression, TEXT_TYPE, getObjectsForType, getAllObjects, kiaoFieldOf } from '@cms-kit/template-lang';
import { useConfigValues } from './ConfigValues-ctx';

export const HeapContext = createContext<[KiaoElHeap, React.Dispatch<React.SetStateAction<KiaoElHeap>>]>(undefined as any);
export const useHeap = () => {
    const heap = useContext(HeapContext);
    return heap;
};

const useGetValue = () => {
    const [heap] = useHeap();

    return useCallback((parsed: ParsedExpression): string | null => {
        if (!heap[parsed.key])
            return null;

        const val = kiaoFieldOf(heap[parsed.key], parsed.field);
        // Only return string values (ignore internal metadata like __pinned)
        return typeof val === 'string' ? val : null;
    }, [heap]);
};

const useSetValue = () => {
    const [, setHeap] = useHeap();
    const { objects } = useConfigValues();

    return useCallback((parsed: ParsedExpression, value: string) => {
        // A built-in field is never a lookup: what is typed into it is the value, and a store's own
        // objects have no say in it. Any other type — a named one, or none at all — is looked up,
        // and a hit brings the whole object into the heap so that `type.field` can read the rest
        // of it out.
        const filteredObjects = isBuiltInType(parsed.type)
            ? []
            : parsed.type
                ? getObjectsForType(objects, parsed.type)
                : getAllObjects(objects);

        const typeObject = filteredObjects.find(obj => kiaoFieldOf(obj, parsed.field) === value);

        if (typeObject) {
            // Copied with its grouped fields: the heap entry owns its `object` rather than
            // sharing the provider's.
            const copy: KiaoElObject = typeObject.object
                ? { ...typeObject, object: { ...typeObject.object } }
                : { ...typeObject };
            setHeap(heap => ({ ...heap, [parsed.key]: copy }));
            return;
        }

        setHeap(heap => {
            const currentObject = heap[parsed.key] || { type: "temporary", value: "" };
            return {
                ...heap, [parsed.key]: {
                    ...currentObject,
                    [parsed.field]: value
                }
            };
        });
    }, [setHeap, objects]);
};

/**
 * What a dropped file writes: the object a `file` variable is answered with, whichever of its
 * fields the expression asked for. It replaces the entry rather than editing one field of it —
 * a path and a name that came from two different files would be an answer to nothing.
 */
const useSetFile = () => {
    const [, setHeap] = useHeap();

    return useCallback((parsed: ParsedExpression, path: string) => {
        const stored = storeLinkOf(path);
        setHeap(heap => ({
            ...heap,
            [parsed.key]: { type: FILE_TYPE, value: stored, name: extractName(path) || stored },
        }));
    }, [setHeap]);
};

const getText = (item: KiaoElObject, field: string) => {
    if (field === "value")
        return item.value;
    else {
        return `${kiaoFieldOf(item, field)} in ${item.value}`;
    }
}

/**
 * Text input for free-form text
 */
const TextInput: React.FC<{ parsed: ParsedExpression }> = ({ parsed }) => {
    const value = useGetValue()(parsed) || "";
    const setValue = useSetValue();

    const handleInputChange = (
        event: React.ChangeEvent<HTMLTextAreaElement>
    ) => setValue(parsed, event.target.value);

    return (
        <VoiceTextArea
            value={value}
            onChange={handleInputChange}
            placeholder={parsed.defaultValue || "Type something..."}
            style={{ width: '100%' }}
            autoSize={{ minRows: 1 }}
        />
    );
};

/**
 * The path of a file of the store, **dropped in from the navigation tree**: ${var:file}
 *
 * A path is a thing the store already knows how to point at, and typing one out is the slowest way
 * of naming it — so the box takes what is dragged onto it out of the file tree or the file browser,
 * exactly as the board's working-folder box does (both are `useFileDrop`). It stays an
 * ordinary text box: a path can still be typed, pasted or corrected by hand, and a drop is only
 * the quick way in.
 *
 * The drop fills **the whole object**, so one dropped file answers more than one question:
 * `${doc:file}` is its path from the store root, `${doc:file.name}` the file's name alone. The
 * path is written plainly, with a leading slash and nothing escaped — it is as likely to end up in
 * a sentence handed to an agent as inside a markdown link, and only the second of those would want
 * the escaping.
 *
 * A folder dropped on it is taken as what it is, its own path: a variable asking for something of
 * the store is not the place to decide that a folder was a mistake.
 */
const FileInput: React.FC<{ parsed: ParsedExpression }> = ({ parsed }) => {
    const value = useGetValue()(parsed) || "";
    const setValue = useSetValue();
    const setFile = useSetFile();
    const { dropping, dropProps } = useFileDrop(file => setFile(parsed, file.path));

    return (
        <Input
            value={value}
            onChange={event => setValue(parsed, event.target.value)}
            placeholder={parsed.defaultValue || "Drop a file here, or type a path..."}
            style={{
                width: '100%',
                ...(dropping ? { borderColor: 'var(--accent)', background: 'var(--state-pointed-bg)' } : {}),
            }}
            aria-label={`${parsed.key} file`}
            data-testid={`template-file-${parsed.key}`}
            {...dropProps}
        />
    );
};

/**
 * Dropdown for inline enums: ${var:"a"|"b"|"c"}
 */
const EnumInput: React.FC<{ parsed: ParsedExpression }> = ({ parsed }) => {
    const value = useGetValue()(parsed);
    const setValue = useSetValue();

    const options = (parsed.enumValues || []).map(v => ({
        value: v,
        label: v
    }));

    const effectiveValue = value || parsed.defaultValue || (options[0]?.value ?? '');

    return (
        <Select
            options={options}
            value={effectiveValue}
            onChange={(val) => setValue(parsed, val)}
            style={{ width: '100%' }}
            placeholder="Select..."
        />
    );
};

/**
 * Searchable dropdown for registered types (AwsRegion, etc.)
 */
const SearchableDropdownInput: React.FC<{ parsed: ParsedExpression }> = ({ parsed }) => {
    const value = useGetValue()(parsed) || "";
    const setValue = useSetValue();
    const { objects: configObjects } = useConfigValues();

    const objects = parsed.type ? getObjectsForType(configObjects, parsed.type) : getAllObjects(configObjects);

    const options = objects
        .sort((c1, c2) => c1.value.localeCompare(c2.value))
        .map(item => {
            const val = kiaoFieldOf(item, parsed.field);
            const strVal = typeof val === 'string' ? val : String(val);
            return {
                value: strVal,
                label: getText(item, parsed.field)
            };
        });

    return (
        <AutoComplete
            options={options}
            value={value}
            onChange={(val) => setValue(parsed, val)}
            style={{ width: '100%' }}
            placeholder={parsed.defaultValue || "Type or select..."}
            filterOption={(inputValue, option) =>
                option?.value?.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
            }
        />
    );
};

/**
 * Main value field component - selects appropriate input based on expression type
 */
export const ValueField: React.FC<{ kbElExpr: string }> = ({ kbElExpr }) => {
    const parsed = kbElExprParse(kbElExpr);

    // Initialize with default value if present, or first enum value
    const [heap, setHeap] = useHeap();
    React.useEffect(() => {
        if (heap[parsed.key]) return; // Already initialized

        // Determine initial value: explicit default > first enum option
        let initialValue: string | undefined = parsed.defaultValue;
        if (!initialValue && parsed.enumValues && parsed.enumValues.length > 0) {
            initialValue = parsed.enumValues[0];
        }

        if (initialValue) {
            setHeap(prev => ({
                ...prev,
                [parsed.key]: {
                    type: parsed.type || 'temporary',
                    value: initialValue!,
                    [parsed.field]: initialValue!
                }
            }));
        }
    }, [parsed.key, parsed.defaultValue, parsed.enumValues, parsed.type, parsed.field, heap, setHeap]);

    const renderInput = () => {
        // Inline enum: ${var:"a"|"b"|"c"}
        if (parsed.enumValues && parsed.enumValues.length > 0) {
            return <EnumInput parsed={parsed} />;
        }

        // Text type: ${var:text}
        if (parsed.type === TEXT_TYPE) {
            return <TextInput parsed={parsed} />;
        }

        // A file of the store: ${var:file}
        if (parsed.type === FILE_TYPE) {
            return <FileInput parsed={parsed} />;
        }

        // Registered type (AwsRegion, etc.) or untyped
        return <SearchableDropdownInput parsed={parsed} />;
    };

    return (
        <div style={{ marginBottom: '10px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '3px', fontSize: '0.9em' }}>
                <span style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--border)', padding: '2px 5px', borderRadius: '3px' }}>
                    {parsed.key}{parsed.type && parsed.type !== 'enum' ? `:${parsed.type}` : ''}
                </span>
            </div>
            {renderInput()}
        </div>
    );
}
