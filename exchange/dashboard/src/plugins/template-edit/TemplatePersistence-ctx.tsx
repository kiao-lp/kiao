import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createSimpleContext } from 'react-concise';
import { useWorkerClient } from '@cms-core';
import { TemplateCollectionV0, parseTempMd, serializeTempMd } from '@cms-kit/template-lang';
import { message } from 'antd';
import debounce from 'lodash.debounce';

export type TemplatePersistenceProps = {
    templateId: string;
};

/** How long a burst of edits — typing in a field — is coalesced before it is written. The same
 *  delay the other editors of this CMS save at. */
const AUTOSAVE_DELAY_MS = 1000;

const useValueProvider = ({ templateId }: TemplatePersistenceProps) => {
    const [template, setTemplateState] = useState<TemplateCollectionV0 | null>(null);
    const client = useWorkerClient();

    useEffect(() => {
        if (!templateId) return;
        let cancelled = false;

        async function load() {
            try {
                const text = await client.getFileText(templateId);
                if (!cancelled) {
                    setTemplateState(parseTempMd(text));
                }
            } catch (e) {
                console.error('Failed to load template:', e);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [templateId, client]);

    // The path comes in as an argument rather than from the closure, so a write still pending
    // when another template is opened lands on the file it was made in.
    const saveTemplate = useMemo(
        () => debounce((path: string, tmpl: TemplateCollectionV0) => {
            client.update(path, serializeTempMd(tmpl)).catch(err => {
                console.error('Failed to save template', err);
                message.error(`Failed to save template: ${err?.message ?? err}`);
            });
        }, AUTOSAVE_DELAY_MS),
        [client],
    );

    // A debounced save that never fires loses the last second of typing. Flush it when the
    // provider goes away and when another template is opened: lodash invokes the debounced
    // function with the *last* call's arguments, which are the outgoing file's path and
    // content — so this writes the template being left, not the one being opened.
    useEffect(() => () => { saveTemplate.flush(); }, [templateId, saveTemplate]);

    // Same for closing/reloading the tab, which unmounts nothing.
    useEffect(() => {
        const flush = () => { saveTemplate.flush(); };
        window.addEventListener('beforeunload', flush);
        return () => window.removeEventListener('beforeunload', flush);
    }, [saveTemplate]);

    /** Every edit goes through here, and the file follows it — there is no Save button. Loading
     *  bypasses it, so opening a template does not write it straight back. */
    const setTemplate = useCallback((value: React.SetStateAction<TemplateCollectionV0 | null>) => {
        setTemplateState(prev => {
            const next = typeof value === 'function' ? value(prev) : value;
            if (next && templateId) saveTemplate(templateId, next);
            return next;
        });
    }, [templateId, saveTemplate]);

    const flush = useCallback(() => { saveTemplate.flush(); }, [saveTemplate]);

    return useMemo(
        () => ({ template, setTemplate, flush }),
        [template, setTemplate, flush]
    );
};

const defaultValue = {
    template: null as TemplateCollectionV0 | null,
    setTemplate: (() => { }) as React.Dispatch<React.SetStateAction<TemplateCollectionV0 | null>>,
    flush: (() => { }) as () => void
};

const hookBasedContext = createSimpleContext(useValueProvider, defaultValue);

export const TemplatePersistenceProvider = hookBasedContext.Provider;
export const useTemplatePersistenceContext = () => hookBasedContext.useContext();
