import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { type ActionDescriptor } from 'kiao-worker';
import { useWorkerClient } from 'src/core/files/service/ui';
import { useRefreshFileList } from '../core/CurrentFileList-ctx';
import { type ContextMenuItemDescriptor } from '../context-menu/ContextMenuRegistry';
import { useContextMenuItems } from '../context-menu/useContextMenuItems';
import { actionApplies } from './appliesTo';
import { type ActionParamsPrompt } from './ActionParamsModal-cmp';

const DEFAULT_GROUP = '6-actions';

export interface ServerActions {
    prompt: ActionParamsPrompt | null;
    confirmPrompt: (params: Record<string, unknown>) => void;
    cancelPrompt: () => void;
}

/** Fetches descriptors once and evaluates applicability locally. No registry or unreachable server registers nothing. */
export const useServerActions = (): ServerActions => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const [actions, setActions] = useState<ActionDescriptor[]>([]);
    const [prompt, setPrompt] = useState<ActionParamsPrompt | null>(null);

    useEffect(() => {
        let cancelled = false;
        client.listActions()
            .then(found => { if (!cancelled) setActions(found); })
            .catch(() => { /* No registry: keep built-in entries only. */ });
        return () => { cancelled = true; };
    }, [client]);

    const execute = useCallback(async (
        action: ActionDescriptor,
        path: string,
        params: Record<string, unknown>,
    ) => {
        const running = message.loading(`${action.label}…`, 0);
        try {
            const result = await client.runAction(action.id, path, params);
            running();
            if (result.ok) {
                message.success(result.message || `${action.label} finished`);
            } else {
                message.error(result.message || `${action.label} failed`);
            }
            if (result.changedPaths.length > 0) refreshFileList();
        } catch (error) {
            running();
            message.error(`${action.label} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, [client, refreshFileList]);

    const items = useMemo((): ContextMenuItemDescriptor[] => actions.map(action => ({
        id: `action:${action.id}`,
        label: action.label,
        group: action.group || DEFAULT_GROUP,
        order: action.order,
        // An action runs on one file; a multi-selection has no single subject to act on.
        enabledWhen: ctx => !ctx.isEmptyArea
            && ctx.paths.length === 1
            && !!ctx.pointedFile
            && actionApplies(action.appliesTo, ctx.pointedFile),
        execute: ctx => {
            const path = ctx.pointedFile?.path;
            if (!path) return;
            if (action.params && action.params.length > 0) {
                setPrompt({ action, path });
                return;
            }
            void execute(action, path, {});
        },
    })), [actions, execute]);

    useContextMenuItems('server-actions', items, [items]);

    const confirmPrompt = useCallback((params: Record<string, unknown>) => {
        if (!prompt) return;
        setPrompt(null);
        void execute(prompt.action, prompt.path, params);
    }, [prompt, execute]);

    return { prompt, confirmPrompt, cancelPrompt: () => setPrompt(null) };
};
