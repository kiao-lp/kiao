import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Button, Spin, message } from 'antd';
import { SaveOutlined, ReloadOutlined, ArrowUpOutlined, ArrowDownOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useNavigation } from '../files/navigation/NavigationModel';
import { TextComparison, type TextComparisonHandle, type TextComparisonNavigation } from '../ui/codemirror/TextComparison';
import { useWorkerClient } from '../files/service/ui';
import { Tooltip } from '../ui/Tooltip';
import { useGitDiff } from './GitDiff-ctx';
import './GitDiffView.css';

/** HEAD and the editable working tree, with Git loading, drafts and explicit saving. */
export const GitDiffBody: React.FC = () => {
    const { diffTarget, closeDiff, requestRefresh, refreshToken, readDraft, storeDraft, clearDraft } = useGitDiff();
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

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadedOriginal, setLoadedOriginal] = useState('');
    const [loadedModified, setLoadedModified] = useState('');
    const [modified, setModified] = useState('');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [langExt, setLangExt] = useState<Extension[]>([]);

    const comparison = useRef<TextComparisonHandle>(null);
    const [navigation, setNavigation] = useState<TextComparisonNavigation>({ index: -1, count: 0 });

    const load = useCallback(async () => {
        if (!path) return;
        setLoading(true);
        setError(null);
        try {
            const [original, working] = await Promise.all([
                workerClient.gitOriginal(path, folder).catch(() => ''),
                workerClient.gitWorking(path, folder).catch(() => ''),
            ]);
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
            setError(e?.message ?? 'Failed to load diff');
        } finally {
            setLoading(false);
        }
    }, [workerClient, path, folder, readDraft]);

    useEffect(() => {
        load();
        // refreshToken: reload when an external git action (stage/revert/commit) changed the tree.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        setModified(val);
        // Compared rather than assumed: typing back to what was loaded is clean again, and the
        // draft above the layout follows it — kept while there is something to restore, dropped
        // the moment there is not.
        const changed = val !== loadedModified;
        setDirty(changed);
        if (changed) storeDraft(loadedModified, val);
        else clearDraft();
    }, [loadedModified, storeDraft, clearDraft]);

    const save = useCallback(async () => {
        if (!dirty || saving) return;
        setSaving(true);
        try {
            const r = await workerClient.gitSave(path, modified, folder);
            if (!r.ok) {
                message.error(r.output || 'Save failed');
                return;
            }
            setLoadedModified(modified);
            setDirty(false);
            clearDraft();
            requestRefresh();
            message.success('Saved');
        } catch (e: any) {
            message.error(`Save failed: ${e?.message ?? e}`);
        } finally {
            setSaving(false);
        }
    }, [dirty, saving, workerClient, path, folder, modified, requestRefresh, clearDraft]);

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
                    <Tooltip title="Previous change (Shift+F7)">
                        <Button
                            size="small"
                            icon={<ArrowUpOutlined />}
                            onClick={() => step(-1)}
                            disabled={loading || !navigation.count}
                            aria-label="Previous change"
                        />
                    </Tooltip>
                    <span className="git-diff-hunk-counter">
                        {navigation.count
                            ? `${navigation.index >= 0 ? navigation.index + 1 : '–'} / ${navigation.count}`
                            : 'no change'}
                    </span>
                    <Tooltip title="Next change (F7)">
                        <Button
                            size="small"
                            icon={<ArrowDownOutlined />}
                            onClick={() => step(1)}
                            disabled={loading || !navigation.count}
                            aria-label="Next change"
                        />
                    </Tooltip>
                </div>

                <div className="git-diff-actions">
                    <Tooltip title="Open file">
                        <Button
                            size="small"
                            icon={<FolderOpenOutlined />}
                            onClick={openFile}
                            disabled={!path}
                            aria-label="Open file"
                        />
                    </Tooltip>
                    <Button size="small" icon={<ReloadOutlined />} onClick={load} disabled={loading || saving}>
                        Reload
                    </Button>
                    <Button
                        size="small"
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={save}
                        loading={saving}
                        disabled={!dirty}
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
                    modifiedReadOnly={false}
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
