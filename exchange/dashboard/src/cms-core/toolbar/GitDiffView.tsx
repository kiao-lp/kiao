import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, Extension } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { Button, Spin, message } from 'antd';
import { SaveOutlined, ReloadOutlined, ArrowUpOutlined, ArrowDownOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useCentralStack } from '../core/CentralStack-ctx';
import { useNavigation } from '../files/navigation/NavigationModel';
import { editorScrollDelta, editorTopLine } from '../ui/codemirror/editorScroll';
import { useWorkerClient } from '../files/service/ui';
import { Tooltip } from '../ui/Tooltip';
import { useGitDiff, useGitDiffOptional } from './GitDiff-ctx';
import { computeDiff, mapDiffLine, HunkSide } from './gitDiffLines';
import './GitDiffView.css';

const lineHighlighter = (lines: Set<number>, className: string): Extension => {
    const build = (view: EditorView): DecorationSet => {
        const builder = new RangeSetBuilder<Decoration>();
        const total = view.state.doc.lines;
        for (let n = 1; n <= total; n++) {
            if (lines.has(n)) {
                const line = view.state.doc.line(n);
                builder.add(line.from, line.from, Decoration.line({ attributes: { class: className } }));
            }
        }
        return builder.finish();
    };
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            constructor(view: EditorView) {
                this.decorations = build(view);
            }
            update(u: ViewUpdate) {
                if (u.docChanged || u.viewportChanged) {
                    this.decorations = build(u.view);
                }
            }
        },
        { decorations: v => v.decorations },
    );
};

/** Lines a change covers on one side — empty when the change is all on the other side. */
const hunkLines = (side: HunkSide): Set<number> => {
    const lines = new Set<number>();
    for (let n = 0; n < side.count; n++) lines.add(side.start + n);
    return lines;
};

const NO_LINES: Set<number> = new Set();

// Jumping to a change leaves this many lines above it, so it arrives with the
// code it follows rather than glued to the top edge.
const HUNK_CONTEXT_LINES = 3;

// ── Component ────────────────────────────────────────────────────────────────

const baseTheme = EditorView.theme({
    '&': { height: '100%', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'monospace', overflow: 'auto' },
});

/** The diff's entry on the central area's stack. */
export const GIT_DIFF_PANEL_ID = 'git-diff';

/**
 * The diff of the git panel's target: HEAD on the left, the working tree on the right, the tree's
 * side editable and saved back with its Save button.
 *
 * It is the **content of a panel on the central area's stack** (`GitDiffStackPanel` pushes it),
 * over whatever the area is showing — an open document, a board. It used to take the whole
 * application over instead, which is what hid it behind the boards page: a page won over it, and
 * the diff opened from a board showed nothing until the board was left. On the stack it opens
 * above the board like any other panel, and closing it is back on what it covered.
 */
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

    // The panes must be state rather than refs: CodeMirror builds its view a
    // render after mount, so an effect reading a ref would only ever see null.
    const [headView, setHeadView] = useState<EditorView | null>(null);
    const [workingView, setWorkingView] = useState<EditorView | null>(null);

    // Which change the navigator is on, -1 before the first jump.
    const [hunkIndex, setHunkIndex] = useState(-1);

    // A scroll we caused must never be taken for the user's, which would bounce
    // the panes back and forth. Shared by the sync below and the navigator, so a
    // jump that moves both panes does not read as two user scrolls.
    const programmatic = useRef({ head: false, working: false });

    const scrollPaneToLine = useCallback((view: EditorView, line: number, pane: 'head' | 'working') => {
        const delta = editorScrollDelta(view, line);
        if (Math.abs(delta) < 1) return;
        const before = view.scrollDOM.scrollTop;
        programmatic.current[pane] = true;
        view.scrollDOM.scrollTop = before + delta;
        // A scroll clamped to the end fires no event, which would otherwise leave
        // the guard set and swallow the user's next scroll.
        if (view.scrollDOM.scrollTop === before) programmatic.current[pane] = false;
    }, []);

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

    // Diff marks are frozen against the loaded content (not recomputed while typing,
    // which would reset the editor); they refresh on (re)load and after save.
    const marks = useMemo(
        () => computeDiff(loadedOriginal, loadedModified),
        [loadedOriginal, loadedModified],
    );

    const hunks = marks.hunks;
    const currentHunk = hunkIndex >= 0 ? hunks[hunkIndex] : undefined;

    // The change the navigator stopped on is outlined on top of the plain
    // added/removed shading, so a jump lands somewhere visibly distinct.
    const leftExtensions = useMemo<Extension[]>(
        () => [
            ...langExt,
            EditorView.lineWrapping,
            baseTheme,
            lineHighlighter(marks.removed, 'cm-diff-removed-line'),
            lineHighlighter(currentHunk ? hunkLines(currentHunk.original) : NO_LINES, 'cm-diff-current-line'),
        ],
        [langExt, marks.removed, currentHunk],
    );
    const rightExtensions = useMemo<Extension[]>(
        () => [
            ...langExt,
            EditorView.lineWrapping,
            baseTheme,
            lineHighlighter(marks.added, 'cm-diff-added-line'),
            lineHighlighter(currentHunk ? hunkLines(currentHunk.modified) : NO_LINES, 'cm-diff-current-line'),
        ],
        [langExt, marks.added, currentHunk],
    );

    // Vertical scroll sync between the two panes. Matching pixel offsets would
    // drift apart as soon as the file has an edit: the sides then hold different
    // line counts, and wrapping gives equal lines unequal heights. Scrolling by
    // diff-aligned lines instead keeps the same code opposite itself.
    useEffect(() => {
        const head = headView;
        const working = workingView;
        if (!head || !working) return;

        const opposite = (line: number, side: 'original' | 'modified') =>
            mapDiffLine(marks.anchors, line, side, head.state.doc.lines, working.state.doc.lines);

        const onHeadScroll = () => {
            if (programmatic.current.head) {
                programmatic.current.head = false;
                return;
            }
            scrollPaneToLine(working, opposite(editorTopLine(head), 'original'), 'working');
        };

        const onWorkingScroll = () => {
            if (programmatic.current.working) {
                programmatic.current.working = false;
                return;
            }
            scrollPaneToLine(head, opposite(editorTopLine(working), 'modified'), 'head');
        };

        head.scrollDOM.addEventListener('scroll', onHeadScroll, { passive: true });
        working.scrollDOM.addEventListener('scroll', onWorkingScroll, { passive: true });
        return () => {
            head.scrollDOM.removeEventListener('scroll', onHeadScroll);
            working.scrollDOM.removeEventListener('scroll', onWorkingScroll);
        };
    }, [headView, workingView, marks, scrollPaneToLine]);

    // A reload or a save recomputes the changes, so the navigator starts over
    // rather than pointing at a change that may no longer exist.
    useEffect(() => setHunkIndex(-1), [marks]);

    const goToHunk = useCallback((index: number) => {
        if (!hunks.length) return;
        // Stepping past either end wraps around, so the changes can be cycled.
        const target = ((index % hunks.length) + hunks.length) % hunks.length;
        setHunkIndex(target);
        const hunk = hunks[target];
        const top = (side: HunkSide) => Math.max(1, side.start - HUNK_CONTEXT_LINES);
        // Both panes are driven here rather than letting the scroll sync follow:
        // each side lands on its own copy of the change, whatever its length.
        if (headView) scrollPaneToLine(headView, top(hunk.original), 'head');
        if (workingView) scrollPaneToLine(workingView, top(hunk.modified), 'working');
    }, [hunks, headView, workingView, scrollPaneToLine]);

    const step = useCallback((direction: 1 | -1) => {
        if (!hunks.length) return;
        // From nowhere, forward means the first change and backward the last.
        goToHunk(hunkIndex < 0 ? (direction > 0 ? 0 : hunks.length - 1) : hunkIndex + direction);
    }, [goToHunk, hunkIndex, hunks.length]);

    // F7 / Shift+F7 as in the IDEs, only while the diff panel is mounted.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'F7' || event.ctrlKey || event.altKey || event.metaKey) return;
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
                            disabled={loading || !hunks.length}
                            aria-label="Previous change"
                        />
                    </Tooltip>
                    <span className="git-diff-hunk-counter">
                        {hunks.length
                            ? `${hunkIndex >= 0 ? hunkIndex + 1 : '–'} / ${hunks.length}`
                            : 'no change'}
                    </span>
                    <Tooltip title="Next change (F7)">
                        <Button
                            size="small"
                            icon={<ArrowDownOutlined />}
                            onClick={() => step(1)}
                            disabled={loading || !hunks.length}
                            aria-label="Next change"
                        />
                    </Tooltip>
                </div>

                {/* No close of its own: the stack's floating cross dismisses the panel, through
                    `onClose` below. The row is padded past it (GitDiffView.css), like any panel
                    header the cross floats over. */}
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
                <div className="git-diff-panes">
                    <div className="git-diff-pane">
                        <div className="git-diff-pane-label">HEAD (original)</div>
                        <div className="git-diff-editor">
                            <CodeMirror
                                onCreateEditor={setHeadView}
                                value={loadedOriginal}
                                extensions={leftExtensions}
                                theme={vscodeDark}
                                readOnly
                                height="100%"
                                style={{ height: '100%' }}
                                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                            />
                        </div>
                    </div>
                    <div className="git-diff-pane">
                        <div className="git-diff-pane-label">
                            Working tree {dirty && <span className="git-diff-dirty">●</span>}
                        </div>
                        <div className="git-diff-editor">
                            <CodeMirror
                                onCreateEditor={setWorkingView}
                                value={modified}
                                onChange={onChange}
                                extensions={rightExtensions}
                                theme={vscodeDark}
                                height="100%"
                                style={{ height: '100%' }}
                                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/**
 * The diff's panel on the central area's stack, following the git panel's target: a target opens
 * it over whatever the area is showing, and it closes back onto that. Rendered by `LayoutContent`
 * itself, so it answers in every view — an open document, a board, the boards list.
 *
 * The target outlives the panel: navigating to another document or board brings up a new area, and
 * its follower pushes the panel again — which is why, unlike the flow node editor, this one has no
 * unmount cleanup closing it. What was typed in the working-tree pane outlives it too, in the
 * draft above the layout (GitDiff-ctx). Only the floating cross — through `onClose` — clears the
 * target, and closing is abandoning.
 */
export const GitDiffStackPanel: React.FC = () => {
    const gitDiff = useGitDiffOptional();
    const { push, close } = useCentralStack();

    const diffTarget = gitDiff?.diffTarget ?? null;
    const closeDiff = gitDiff?.closeDiff;

    useEffect(() => {
        if (!diffTarget || !closeDiff) {
            close(GIT_DIFF_PANEL_ID);
            return;
        }
        push({
            id: GIT_DIFF_PANEL_ID,
            // No title: the diff's own header row — path, hunk navigator, actions — is the header.
            label: `Diff of ${diffTarget.path}`,
            closeLabel: 'Close',
            onClose: () => closeDiff(),
            content: <GitDiffBody />,
        });
        // The content reads the target live, so only the target is watched: a keystroke in the
        // working-tree pane must not re-push the panel it is typed in. `push`, `close` and
        // `closeDiff` are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diffTarget]);

    return null;
};
