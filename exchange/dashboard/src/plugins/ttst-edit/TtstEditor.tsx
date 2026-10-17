import React, { useEffect, useRef, useState } from 'react';
import { Input, Select, message } from 'antd';
import { useWorkerClient, useScrollMemory, useTextFileSync } from '@cms-core';
import { voiceSelectGroups, normalizeVoiceId, readTtstConfig, writeTtstConfig, type TtstConfig } from '@cms-kit/tts';

import './TtstEditor.css';

/**
 * `.ttst.md` editor: the spoken script plus the voice that reads it. The script goes through
 * `useTextFileSync` like any text file — read, debounce-saved and followed on disk; the voice is
 * written straight through to the `.config.json` sidecar.
 */
export const TtstEditor: React.FC<{ path: string }> = ({ path }) => {
    const client = useWorkerClient();
    const { content: script, loading: scriptLoading, onChange: onScriptChange } = useTextFileSync(path);
    const [config, setConfig] = useState<TtstConfig>({});
    const [configLoading, setConfigLoading] = useState(true);
    // The textarea is the scroller; antd exposes the element it wraps.
    const scriptRef = useRef<HTMLTextAreaElement | null>(null);
    useScrollMemory(scriptRef, 'ttst.script');

    useEffect(() => {
        let cancelled = false;
        setConfigLoading(true);
        readTtstConfig(client, path)
            .then((loadedConfig) => {
                if (!cancelled) setConfig(loadedConfig);
            })
            .catch((e) => {
                if (!cancelled) message.error(`Failed to read the config of ${path}: ${e}`);
            })
            .finally(() => {
                if (!cancelled) setConfigLoading(false);
            });
        return () => { cancelled = true; };
    }, [path, client]);

    const loading = scriptLoading || configLoading;

    // Changing the voice invalidates the audio the previous voice produced. The stale digest goes
    // with it, so nothing in the sidecar claims the MP3 beside the script still answers it; the
    // server recomputes both when the script is next read aloud or published.
    const handleVoiceChange = (ttsVoice?: string) => {
        const next: TtstConfig = { ...config, ttsVoice, hash: undefined, audioHash: undefined };
        setConfig(next);
        writeTtstConfig(client, path, next).catch((e) => message.error(`Failed to save voice: ${e}`));
    };

    if (loading) return <div className="ttst-loading">Loading…</div>;

    return (
        <div className="ttst-container">
            <div className="ttst-voice">
                <label htmlFor="ttst-voice-select">Voix :</label>
                <Select
                    id="ttst-voice-select"
                    style={{ width: 280 }}
                    allowClear
                    placeholder="Sélectionnez une voix"
                    options={voiceSelectGroups(config.lang ?? '')}
                    value={normalizeVoiceId(config.ttsVoice)}
                    onChange={handleVoiceChange}
                />
                {config.lang && <span className="ttst-lang">{config.lang}</span>}
            </div>
            <div className="ttst-editor">
                <Input.TextArea
                    ref={node => { scriptRef.current = node?.resizableTextArea?.textArea ?? null; }}
                    className="ttst-textarea"
                    value={script}
                    onChange={(e) => onScriptChange(e.target.value)}
                    placeholder={'Rédigez ici le texte à lire à voix haute...'
                        + '\n\nPour une pause : <break time="10000ms"/>'
                        + '\nPour une question : <mark>Quelle heure est-il ?</mark>'}
                />
            </div>
        </div>
    );
};
