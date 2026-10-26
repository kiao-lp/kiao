import { useCallback, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { useWorkerClient } from '../service/ui';
import { useRefreshFileList } from '../core/CurrentFileList-ctx';
import { usePluginListContext } from '../../core/PluginList-ctx';
import { setClipboard } from '../../lib/clipboard';
import { parseTextFiles, pasteTextFiles, readTextFiles, serializeTextFiles } from './textFilesClipboard';

export const useTextFilesClipboard = () => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const { knownExtensions } = usePluginListContext();
    const [hasTextFiles, setHasTextFiles] = useState(false);
    const readVersion = useRef(0);

    const refreshTextFiles = useCallback(async () => {
        const version = ++readVersion.current;
        setHasTextFiles(false);
        try {
            const parsed = parseTextFiles(await navigator.clipboard.readText());
            if (version === readVersion.current) setHasTextFiles(parsed !== null);
        } catch {
            // A denied clipboard read offers no paste action.
        }
    }, []);

    const copyTextFiles = useCallback(async (paths: string[]) => {
        try {
            const copied = await readTextFiles(client, paths);
            await setClipboard(serializeTextFiles(copied));
            ++readVersion.current;
            setHasTextFiles(true);
            message.success(copied.length === 1 ? 'Text file copied!' : `${copied.length} text files copied!`);
        } catch {
            message.error('Could not copy text files. Check that they contain UTF-8 text and allow clipboard access.');
        }
    }, [client]);

    const pasteClipboardTextFiles = useCallback(async (targetFolder: string) => {
        const key = 'paste-text-files';
        ++readVersion.current;
        setHasTextFiles(false);
        try {
            const parsed = parseTextFiles(await navigator.clipboard.readText());
            setHasTextFiles(parsed !== null);
            if (!parsed) {
                message.error('The clipboard does not contain Kiao text files.');
                return;
            }
            message.loading({ key, content: 'Pasting text files…', duration: 0 });
            const count = await pasteTextFiles(client, parsed, targetFolder, knownExtensions);
            message.success({ key, content: count === 1 ? 'Text file pasted!' : `${count} text files pasted!` });
        } catch {
            message.error({ key, content: 'Could not paste text files. Check the folder and allow clipboard access.' });
        } finally {
            refreshFileList();
        }
    }, [client, knownExtensions, refreshFileList]);

    return useMemo(() => ({
        hasTextFiles,
        refreshTextFiles,
        copyTextFiles,
        pasteTextFiles: pasteClipboardTextFiles,
    }), [hasTextFiles, refreshTextFiles, copyTextFiles, pasteClipboardTextFiles]);
};
