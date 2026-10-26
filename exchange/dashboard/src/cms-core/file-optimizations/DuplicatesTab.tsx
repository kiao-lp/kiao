import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Empty, Modal, Radio, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MergeCellsOutlined } from '@ant-design/icons';
import type { DuplicateGroup, FileDto } from 'kiao-worker';
import { Tooltip } from '../ui/Tooltip';
import { useNavigation } from '../files/navigation/NavigationModel';
import {
    choiceOf,
    chosenConsolidations,
    Consolidation,
    ConsolidationOutcome,
    folderLabel,
    folderOf,
    formatSize,
    KeepChoice,
    nameOf,
    plannedWasted,
    removedBy,
    staysPut,
    targetOf,
    totalWasted,
} from './duplicatesModel';
import styles from './FileOptimizations.module.css';

/** One group's rows, keyed by path so the radios survive a re-scan that returns the same files. */
interface CopyRow {
    key: string;
    file: FileDto;
}

const rowsOf = (group: DuplicateGroup): CopyRow[] => group.files.map(f => ({ key: f.path, file: f }));

const groupsWord = (n: number): string => n === 1 ? 'group' : 'groups';

/** The half a group is still waiting on — one of them, once the group has answered the other itself. */
const stillToChoose = (choice: KeepChoice): string => {
    if (choice.folder === undefined) return choice.name ? 'Choose a location' : 'Choose a location and a name';
    return 'Choose a name';
};

interface GroupTableProps {
    group: DuplicateGroup;
    choice: KeepChoice;
    onChoose: (choice: KeepChoice) => void;
    busy: boolean;
}

/**
 * One tuple of identical files, with a radio for the location and a radio for the name on every row
 * bearing them.
 *
 * The two radios are **independent groups over distinct values**, not over rows: two copies in the
 * same folder are one location, so choosing it on either lights both, and the same goes for a name
 * two copies share. That is not a display trick — it is what the choice means, and a reader who sees
 * one radio move two rows has learnt something true about their store.
 *
 * A group answers, it does not act: the one button is above, over every group answered. What stays
 * here is the path this group would come down to, because that is what its own two radios decide
 * and it must be readable next to them rather than only in the confirmation.
 */
const GroupTable: React.FC<GroupTableProps> = ({ group, choice, onChoose, busy }) => {
    const nav = useNavigation();
    const target = targetOf(choice);

    const columns: ColumnsType<CopyRow> = [
        {
            title: 'Keep this location',
            key: 'location',
            width: 150,
            align: 'center',
            render: (_: unknown, row) => (
                <Radio
                    checked={choice.folder === folderOf(row.file.path)}
                    disabled={busy}
                    onChange={() => onChoose({ ...choice, folder: folderOf(row.file.path) })}
                    aria-label={`Keep the location ${folderLabel(folderOf(row.file.path))}`}
                />
            ),
        },
        {
            title: 'Folder',
            key: 'folder',
            render: (_: unknown, row) => (
                <span className={styles.path}>{folderLabel(folderOf(row.file.path))}</span>
            ),
        },
        {
            title: 'Keep this name',
            key: 'nameChoice',
            width: 130,
            align: 'center',
            render: (_: unknown, row) => (
                <Radio
                    checked={choice.name === nameOf(row.file.path)}
                    disabled={busy}
                    onChange={() => onChoose({ ...choice, name: nameOf(row.file.path) })}
                    aria-label={`Keep the name ${nameOf(row.file.path)}`}
                />
            ),
        },
        {
            title: 'Name',
            key: 'name',
            render: (_: unknown, row) => (
                <Tooltip title="Open in a new tab">
                    <a onClick={() => nav.openInNewTab(row.file.path)}>{nameOf(row.file.path)}</a>
                </Tooltip>
            ),
        },
        {
            title: 'Modified',
            key: 'modified',
            width: 170,
            render: (_: unknown, row) => (
                <span className={styles.dim}>{new Date(row.file.lastModified).toLocaleString()}</span>
            ),
        },
    ];

    return (
        <div className={styles.group} data-testid="duplicate-group">
            <div className={styles.groupHead}>
                <span className={styles.groupTitle}>
                    {group.files.length} identical copies of {formatSize(group.size)}
                </span>
                <Tag color="gold">{formatSize(group.wasted)} to give back</Tag>
                <span className={styles.spacer} />
                {/* What this group is answered with, spelled out where it was answered: the one path
                    that remains. A group that is in the plan is one whose outcome the reader can
                    read here without opening anything. */}
                {target
                    ? <span className={styles.target} data-testid="keep-target">→ /{target}</span>
                    : <span className={styles.dim} data-testid="keep-unchosen">{stillToChoose(choice)}</span>}
            </div>
            <Table<CopyRow>
                size="small"
                rowKey="key"
                columns={columns}
                dataSource={rowsOf(group)}
                pagination={false}
            />
        </div>
    );
};

export interface DuplicatesTabProps {
    duplicates: DuplicateGroup[];
    scanned: number;
    truncated: boolean;
    keepOnlyOne: (plan: Consolidation[]) => Promise<ConsolidationOutcome[]>;
}

/** The confirmation's body: every group of the plan, what it keeps and what stops naming a file. */
const PlanReview: React.FC<{ plan: Consolidation[] }> = ({ plan }) => (
    <div className={styles.confirm}>
        <div className={styles.planList}>
            {plan.map(c => (
                <div key={c.hash} className={styles.planItem}>
                    <p>
                        <strong>/{c.target}</strong> is kept
                        {staysPut(c.paths, c.target) ? ', where it already is.' : '.'}
                    </p>
                    <ul>{removedBy(c.paths, c.target).map(p => <li key={p}>/{p}</li>)}</ul>
                </div>
            ))}
        </div>
        {/* The reassurance that is actually true, and the reason a consolidation is a move rather
            than a delete: the content stays, and so do the references. */}
        <p className={styles.dim}>
            The content is identical, so nothing is lost — and every link to one of these paths is
            repointed at the one that is kept.
        </p>
    </div>
);

/**
 * The files this store is holding more than once, biggest waste first.
 *
 * Every group has been **read**, not merely measured: the server groups by size and then hashes the
 * candidates, so what is offered here is the same bytes and not a coincidence of length. That is
 * what makes it defensible to put a destructive button next to, and it is why the button says what
 * it will keep rather than what it will remove.
 *
 * There is **one** such button, above every group, and it runs the whole plan — every group whose
 * location and name were both chosen. Answering is per group because only a reader can say which
 * copy of a group is the good one; acting is not, because a store worth opening this on holds
 * dozens of groups and a button per group asks for dozens of confirmations to do one obvious thing.
 * A group left half-chosen is simply not in the plan and is untouched by the press.
 */
export const DuplicatesTab: React.FC<DuplicatesTabProps> = ({ duplicates, scanned, truncated, keepOnlyOne }) => {
    const [choices, setChoices] = useState<Record<string, KeepChoice>>({});
    const [busy, setBusy] = useState(false);
    const wasted = useMemo(() => totalWasted(duplicates), [duplicates]);
    const plan = useMemo(() => chosenConsolidations(duplicates, choices), [duplicates, choices]);

    const run = useCallback(async (planned: Consolidation[]) => {
        setBusy(true);
        try {
            const outcomes = await keepOnlyOne(planned);
            const done = outcomes.filter(o => !o.error);
            const refused = outcomes.filter(o => o.error);
            const removed = done.reduce((n, o) => n + o.removed.length, 0);
            if (done.length === 1) {
                message.success(`Kept /${done[0].target}, ${removed} copies consolidated`);
            } else if (done.length > 1) {
                message.success(`${done.length} groups consolidated, ${removed} copies gone`);
            }
            // The server refuses with a sentence when the store has moved on under the scan — no
            // longer identical, or the name since taken. It is the only thing the reader can act
            // on, so it is shown, per group and named: the rest of the plan went through, and which
            // groups did not is the whole of what is left to decide.
            if (refused.length > 0) {
                message.error(
                    <span>
                        {refused.length} {groupsWord(refused.length)} refused:
                        <ul className={styles.refusals}>
                            {refused.map(o => <li key={o.target}>/{o.target} — {o.error}</li>)}
                        </ul>
                    </span>,
                );
            }
        } catch (e: any) {
            message.error(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    }, [keepOnlyOne]);

    const confirm = useCallback((planned: Consolidation[]) => {
        Modal.confirm({
            title: planned.length === 1
                ? 'Keep only one copy?'
                : `Keep only one copy in ${planned.length} groups?`,
            width: 560,
            content: <PlanReview plan={planned} />,
            okText: 'Keep only one',
            okButtonProps: { danger: true },
            onOk: () => run(planned),
        });
    }, [run]);

    if (duplicates.length === 0) {
        return (
            <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`No file is stored twice — ${scanned} files read.`}
            />
        );
    }

    return (
        <div className={styles.tab} data-testid="duplicates-tab">
            <div className={styles.tabHead}>
                <span>
                    <strong>{duplicates.length}</strong> {groupsWord(duplicates.length)} of
                    identical files, out of {scanned} read — <strong>{formatSize(wasted)}</strong> to give back.
                </span>
                <span className={styles.spacer} />
                {/* How much of what is on screen the press would act on. Without it, one button over
                    thirty groups is a button whose reach nobody can see. */}
                <span data-testid="plan-summary">
                    {plan.length === 0
                        ? 'No group chosen yet'
                        : `${plan.length} of ${duplicates.length} ${groupsWord(duplicates.length)} chosen — ${formatSize(plannedWasted(plan))}`}
                </span>
                <Button
                    type="primary"
                    size="small"
                    icon={<MergeCellsOutlined />}
                    disabled={plan.length === 0 || busy}
                    loading={busy}
                    onClick={() => confirm(plan)}
                >
                    {plan.length === 0
                        ? 'Keep only one'
                        : `Keep only one in ${plan.length} ${groupsWord(plan.length)}`}
                </Button>
            </div>
            {truncated && (
                <Alert
                    type="info"
                    showIcon
                    title="There is more than this shows"
                    description="The scan stopped at its cap, or at a folder the store declares is not content. Re-scan after consolidating these to see the rest."
                />
            )}
            {duplicates.map(group => (
                <GroupTable
                    key={group.hash}
                    group={group}
                    choice={choiceOf(group, choices)}
                    onChoose={choice => setChoices(prev => ({ ...prev, [group.hash]: choice }))}
                    busy={busy}
                />
            ))}
        </div>
    );
};
