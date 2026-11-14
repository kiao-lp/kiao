import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Spin } from 'antd';
import { ReloadOutlined, SearchOutlined, SortAscendingOutlined, SortDescendingOutlined } from '@ant-design/icons';
import { resolveInternalLink, useIsCoarsePointer, writeDraggedFiles } from '@kiao-dashboard-core';
import { useDecisions } from './Decisions-ctx';
import { matchesQuery, sortByDate, sortById } from './decisionsFile';
import styles from './Decisions.module.css';

type SortColumn = 'date' | 'id';

export const DecisionsPanel: React.FC = () => {
    const { decisions, decisionsLoading, sourcesLoading, ensureLoaded, reload } = useDecisions();
    const isCoarse = useIsCoarsePointer();
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<{ column: SortColumn; direction: 'asc' | 'desc' }>({ column: 'date', direction: 'desc' });

    const toggleSort = (column: SortColumn) => setSort(current => ({
        column,
        direction: current.column === column && current.direction === 'asc' ? 'desc' : 'asc',
    }));

    useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

    const visible = useMemo(
        () => (sort.column === 'id' ? sortById : sortByDate)(decisions.filter(d => matchesQuery(d, query)), sort.direction),
        [decisions, query, sort],
    );
    const loading = sourcesLoading || decisionsLoading;

    return (
        <div className={styles.panel} data-testid="decisions-panel">
            <div className={styles.toolbar}>
                <Input
                    size="small"
                    className={styles.search}
                    prefix={<SearchOutlined />}
                    placeholder="Filter by tag, status, source…"
                    aria-label="Filter decisions"
                    data-testid="decisions-filter"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    allowClear
                />
                <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined spin={loading} />}
                    aria-label="Read the sources again"
                    onClick={reload}
                />
            </div>
            <div className={styles.body}>
                {loading && decisions.length === 0 && <div className={styles.center}><Spin /></div>}
                {!loading && decisions.length === 0 && (
                    <div className={styles.hint}>No decisions yet. Add a source from the … menu, Decision sources.</div>
                )}
                {!loading && decisions.length > 0 && visible.length === 0 && (
                    <div className={styles.hint}>No decision matches the filter.</div>
                )}
                {visible.length > 0 && (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                {(['date', 'id'] as const).map(column => (
                                    <th
                                        key={column}
                                        aria-sort={sort.column === column ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                                    >
                                        <button
                                            type="button"
                                            className={styles.sortable}
                                            data-testid={`decisions-sort-${column}`}
                                            onClick={() => toggleSort(column)}
                                        >
                                            {column === 'date' ? 'Date' : 'ID'}
                                            {sort.column === column && (sort.direction === 'desc' ? <SortDescendingOutlined /> : <SortAscendingOutlined />)}
                                        </button>
                                    </th>
                                ))}
                                <th>Decision</th>
                                <th>Status</th>
                                <th>Tags</th>
                                <th>Source</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(decision => (
                                <tr
                                    key={decision.path}
                                    data-testid="decision-row"
                                    draggable={!isCoarse}
                                    onDragStart={!isCoarse
                                        ? event => writeDraggedFiles(event.dataTransfer, [{ path: decision.path, isDirectory: false }])
                                        : undefined}
                                >
                                    <td className={styles.nowrap}>{decision.date}</td>
                                    <td className={styles.nowrap}>{decision.id}</td>
                                    <td>
                                        <a className={styles.title} href={resolveInternalLink(`/${decision.path}`)} draggable={false}>
                                            {decision.title}
                                        </a>
                                    </td>
                                    <td className={styles.nowrap}>{decision.status}</td>
                                    <td className={styles.tags}>{decision.tags.join(', ')}</td>
                                    <td className={styles.nowrap}>{decision.sourceName}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};
