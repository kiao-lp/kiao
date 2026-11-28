import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '../ui-foundation/toolbar/IconButton';
import type { Extension } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Button, Spin, message } from 'antd';
import { SaveOutlined, ReloadOutlined, ArrowUpOutlined, ArrowDownOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useNavigation } from '../files/navigation/NavigationModel';
import { TextComparison, type TextComparisonHandle, type TextComparisonNavigation } from '../ui-foundation/code-editor/TextComparison';
import { useWorkerClient } from '../files/service/ui';
import { useGitDiff } from './GitDiff-ctx';
import './GitDiffView.css';

/** HEAD and the editable working tree, with Git loading, drafts and explicit saving. */
export const GitDiffBody: React.FC = () => {
    const { diffTarget, closeDiff, requestRefresh, refreshToken, readDraft, storeDraft, clearDraft, savingFiles, runSave } = useGitDiff();
    const workerClient = useWorkerClient();
    const nav = useNavigation();

    const path = diffTarget?.path ?? '';
    // The repository the row was opened from — every read and the save go to that one, so the diff
    // keeps showing the file it was opened on even once the browser has moved to another folder.
    const folder = diffTarget?.folder ?? '';
    // Where that repository sits in the store, so the working-tree file can be opened in the
    // browser: the repo-relative path joined onto its root is the store path.
    const root = diffTarget?.root ?? '';
    const storePath = root ? `${root.replace(/\/+$/, '')}/${path}` : path;
    const saving = savingFiles.has(storePath);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadedOriginal, setLoadedOriginal] = useState('');
    const [loadedModified, setLoadedModified] = useState('');
    const [modified, setModified] = useState('');
    const [dirty, setDirty] = useState(false);
    const latestRead = useRef(0);
    const latestTarget = useRef(diffTarget);
    latestTarget.current = diffTarget;
    const [langExt, setLangExt] = useState<Extension[]>([]);

    const comparison = useRef<TextComparisonHandle>(null);
    const [navigation, setNavigation] = useState<TextComparisonNavigation>({ index: -1, count: 0 });

    const load = useCallback(async () => {
        if (!path) return;
        const read = ++latestRead.current;
        setLoading(true);
        setError(null);
        try {
            const [original, working] = await Promise.all([
                workerClient.gitOriginal(path, folder).catch(() => ''),
                workerClient.gitWorking(path, folder).catch(() => ''),
            ]);
            if (read !== latestRead.current || diffTarget !== latestTarget.current) return;
            setLoadedOriginal(original);
            setLoadedModified(working);
            // What was typed before the panel was remounted — a document or a board navigated to
            // with the diff open — comes back, unless the tree moved under it meanwhile.
            const restored = readDraft(working);
            if (restored !== null) {
                setModified(restored);
                setDirty(true);
            } else {
                setModified(working);
                setDirty(false);
            }
        } catch (e: any) {
            if (read === latestRead.current) setError(e?.message ?? 'Failed to load diff');
        } finally {
            if (read === latestRead.current) setLoading(false);
        }
    }, [workerClient, diffTarget, path, folder, readDraft]);

    useEffect(() => {
        void load();
        return () => { latestRead.current++; };
    }, [load, refreshToken]);

    // Resolve a CodeMirror language for syntax highlighting from the file name.
    useEffect(() => {
        let cancelled = false;
        const desc = LanguageDescription.matchFilename(languages, path.split('/').pop() || path);
        if (!desc) {
            setLangExt([]);
            return;
        }
        desc.load().then(support => {
            if (!cancelled) setLangExt([support]);
        }).catch(() => {
            if (!cancelled) setLangExt([]);
        });
        return () => { cancelled = true; };
    }, [path]);

    const step = useCallback((direction: 1 | -1) => {
        if (direction === 1) comparison.current?.nextChange();
        else comparison.current?.previousChange();
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.key !== 'F7' || event.ctrlKey || event.altKey || event.metaKey) return;
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [step]);

    const onChange = useCallback((val: string) => {
        if (saving) return;
        setModified(val);
        // Compared rather than assumed: typing back to what was loaded is clean again, and the
        // draft above the layout follows it — kept while there is something to restore, dropped
        // the moment there is not.
        const changed = val !== loadedModified;
        setDirty(changed);
        if (changed) storeDraft(loadedModified, val);
        else clearDraft();
    }, [saving, loadedModified, storeDraft, clearDraft]);

    const save = useCallback(async () => {
        if (!diffTarget || !dirty || loading) return;
        await runSave(storePath, async () => {
            try {
                const r = await workerClient.gitSave(path, modified, folder);
                if (!r.ok) {
                    message.error(r.output || 'Save failed');
                    return;
                }
                if (diffTarget === latestTarget.current) {
                    setLoadedModified(modified);
                    setDirty(false);
                }
                clearDraft({ target: diffTarget, text: modified });
                requestRefresh();
                message.success('Saved');
            } catch (e: any) {
                message.error(`Save failed: ${e?.message ?? e}`);
            }
        });
    }, [diffTarget, dirty, loading, runSave, storePath, workerClient, path, folder, modified, requestRefresh, clearDraft]);

    // The working-tree file, opened in place. Closing is abandoning like the floating cross:
    // navigating alone would leave the diff covering the file just opened.
    const openFile = useCallback(() => {
        if (!path) return;
        nav.open(storePath);
        closeDiff();
    }, [nav, storePath, path, closeDiff]);

    return (
        <div className="git-diff-view">
            <div className="git-diff-header">
                <span className="git-diff-path" title={path}>{path}</span>
                <div className="git-diff-nav">
                    <IconButton
                        label="Previous change"
                        type="default"
                        icon={<ArrowUpOutlined />}
                        onClick={() => step(-1)}
                        disabled={loading || !navigation.count}
                    />
                    <span className="git-diff-hunk-counter">
                        {navigation.count
                            ? `${navigation.index >= 0 ? navigation.index + 1 : '–'} / ${navigation.count}`
                            : 'no change'}
                    </span>
                    <IconButton
                        label="Next change"
                        type="default"
                        icon={<ArrowDownOutlined />}
                        onClick={() => step(1)}
                        disabled={loading || !navigation.count}
                    />
                </div>

                <div className="git-diff-actions">
                    <IconButton
                        label="Open file"
                        type="default"
                        icon={<FolderOpenOutlined />}
                        onClick={openFile}
                        disabled={!path}
                    />
                    <Button size="small" icon={<ReloadOutlined />} onClick={load} disabled={loading || saving}
                        loading={loading} aria-label="Reload" aria-busy={loading}>
                        Reload
                    </Button>
                    <Button
                        size="small"
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={save}
                        loading={saving}
                        disabled={!dirty || loading || saving}
                        aria-label="Save" aria-busy={saving}
                    >
                        Save
                    </Button>
                </div>
            </div>

            {error ? (
                <div className="git-diff-error">{error}</div>
            ) : loading ? (
                <div className="git-diff-loading"><Spin /></div>
            ) : (
                <TextComparison
                    ref={comparison}
                    original={loadedOriginal}
                    modified={modified}
                    modifiedReadOnly={saving}
                    onModifiedChange={onChange}
                    extensions={langExt}
                    originalLabel="HEAD (original)"
                    modifiedLabel={<>Working tree {dirty && <span className="git-diff-dirty">●</span>}</>}
                    originalAriaLabel="Head pane"
                    modifiedAriaLabel="Working tree pane"
                    onNavigationChange={setNavigation}
                />
            )}
        </div>
    );
};

export { GitDiffStackPanel, GIT_DIFF_PANEL_ID } from './GitDiffStackPanel';
