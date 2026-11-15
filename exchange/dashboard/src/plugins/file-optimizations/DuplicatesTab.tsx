import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Empty, Modal, Radio, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MergeCellsOutlined } from '@ant-design/icons';
import type { DuplicateGroup, FileDto } from 'kiao-worker';
import { Tooltip, useNavigation } from '@kiao-dashboard-core';
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

/** Label for the unchosen half. */
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

/** Location and name radios are independent groups over distinct values. */
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

/** Confirmation body: kept and removed paths per group. */
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

        <p className={styles.dim}>
            The content is identical, so nothing is lost — and every link to one of these paths is
            repointed at the one that is kept.
        </p>
    </div>
);

/** Groups are hash-verified identical bytes. One button runs all fully chosen groups. */
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
            // Per-group refusals are shown by target; other groups still run.
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
