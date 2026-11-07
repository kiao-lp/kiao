import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentProfileSecret, AgentProfilesDocument, AgentProfilesState } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';
import { TOOLBOX_CHANGED_EVENT } from './events';
import { editableProfiles, errorText, profileDraftProblem } from './profileEditing';

export const useAgentProfiles = () => {
    const client = useWorkerClient();
    const [state, setState] = useState<AgentProfilesState | null>(null);
    const [doc, setDoc] = useState<AgentProfilesDocument | null>(null);
    const [secrets, setSecrets] = useState<AgentProfileSecret[]>([]);
    const [error, setError] = useState('');
    const [saveError, setSaveError] = useState('');
    const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
    const pending = useRef<AgentProfilesDocument | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const generation = useRef(0);
    const chain = useRef<Promise<boolean>>(Promise.resolve(true));
    const active = useRef(true);

    const write = useCallback((next: AgentProfilesDocument): Promise<boolean> => {
        const problem = profileDraftProblem(next);
        if (problem) {
            if (active.current) { setSaveError(problem); setSaveState('error'); }
            return Promise.resolve(false);
        }
        const turn = generation.current;
        if (pending.current === next) pending.current = null;
        if (active.current) { setSaveState('saving'); setSaveError(''); }
        chain.current = chain.current.catch(() => false).then(async () => {
            try {
                const result = await client.putAgentProfiles(next);
                if (active.current && turn === generation.current) { setState(result); setSaveState('saved'); setSaveError(''); }
                window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
                return true;
            } catch (cause) {
                if (turn === generation.current) {
                    pending.current = next;
                    if (active.current) { setSaveError(errorText(cause)); setSaveState('error'); }
                }
                return false;
            }
        });
        return chain.current;
    }, [client]);

    const refresh = useCallback(async () => {
        const [result, keys] = await Promise.all([client.getAgentProfiles(), client.getAgentProfileSecrets()]);
        if (active.current) { setState(result); setSecrets(keys); setError(''); }
    }, [client]);

    useEffect(() => {
        active.current = true;
        const reload = () => { void refresh().catch(cause => { if (active.current) setError(errorText(cause)); }); };
        window.addEventListener(TOOLBOX_CHANGED_EVENT, reload);
        client.getAgentProfiles().then(result => {
            if (active.current) { setState(result); setDoc(editableProfiles(result)); }
        }).catch(cause => { if (active.current) setError(errorText(cause)); });
        reload();
        return () => {
            active.current = false;
            window.removeEventListener(TOOLBOX_CHANGED_EVENT, reload);
            clearTimeout(timer.current);
            if (pending.current && !profileDraftProblem(pending.current)) void write(pending.current);
        };
    }, [client, refresh, write]);

    const change = (next: AgentProfilesDocument) => {
        generation.current++;
        setDoc(next); pending.current = next;
        clearTimeout(timer.current);
        const problem = profileDraftProblem(next);
        setSaveError(problem); setSaveState(problem ? 'error' : 'pending');
        if (!problem) timer.current = setTimeout(() => { if (pending.current) void write(pending.current); }, 800);
    };

    const flush = async () => {
        clearTimeout(timer.current);
        return pending.current ? write(pending.current) : chain.current;
    };

    return { client, state, doc, secrets, error, saveError, saveState, change, flush, refresh };
};
