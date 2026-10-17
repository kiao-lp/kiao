import React, { useMemo, useState } from 'react';
import { Alert, Button, Modal, Spin, Switch, Tag } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { DeleteOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Toolbox, ToolboxComponent } from 'kiao-worker';
import { PluginCatalogueEntry } from '../core/assembly';
import { useToolbox } from './useToolbox';
import { usePlugins } from './usePlugins';
import { KindIcon } from './itemKinds';
import { matchesFilter, NO_FILTER, ToolboxFilter, ToolboxFilterValue } from './ToolboxFilter';
import styles from './Toolbox.module.css';

/** Runtimes before servers: the order the panel showed when it still had section titles. */
const KIND_ORDER: Record<ToolboxComponent['kind'], number> = { runtime: 0, mcp: 1 };

/**
 * The configuration panel: what is installed on the machine worker runs on, which MCP
 * servers a Claude turn is handed, and what this store opens its files with.
 *
 * It reads as a package manager because that is what it is — rows, each with one control and enough
 * small print to decide with. **One list**, though: the three kinds it holds differ in where they
 * live and who installs them, and that difference is ours rather than the reader's, so it is said by
 * an icon per row and a chip per kind in the filter bar instead of by cutting the panel in three.
 * What it deliberately does *not* offer is a way to type a name: everything on offer is in a
 * catalogue — compiled into the service binary for runtimes and servers, built into the assembly for
 * plugins — and a row is the only way to name one.
 */
export const ToolboxPanel: React.FC = () => {
    const { toolbox, loading, job, busy, error, refresh, install, uninstall, setRegistered } = useToolbox();
    const plugins = usePlugins();
    const [filter, setFilter] = useState<ToolboxFilterValue>(NO_FILTER);

    const components = useMemo(() => (toolbox?.components ?? [])
        .filter(c => matchesFilter(filter, c.kind, c.title, c.role, c.id))
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
        [toolbox, filter]);
    const pluginRows = useMemo(
        () => plugins.catalogue.filter(e => matchesFilter(filter, 'plugin', e.title, e.description, e.id)),
        [plugins.catalogue, filter]);

    if (loading) {
        return <div className={styles.center}><Spin /></div>;
    }
    if (error) {
        return (
            <div className={styles.panel}>
                <Alert type="error" showIcon title="The configuration could not be read" description={error} />
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>Try again</Button>
            </div>
        );
    }
    if (!toolbox) return null;

    // The sentence nobody would guess, kept where the servers it is about are: a turn is held to
    // exactly the servers switched on here, so one registered with the CLI itself stops arriving.
    const sayStrict = toolbox.strict && components.some(c => c.kind === 'mcp');

    return (
        <div className={styles.panel} data-testid="toolbox-panel">
            <div className={styles.header}>
                <span className={styles.title}>Configuration</span>
                <Tooltip title="Re-read">
                    <Button type="text" size="small" icon={<ReloadOutlined />} aria-label="Re-read" onClick={() => void refresh()} />
                </Tooltip>
            </div>

            {!toolbox.enabled && (
                <Alert
                    type="info"
                    showIcon
                    title="This deployment installs nothing"
                    description="Set KIAO_WORKER_TOOLBOX_PATH to a directory the service may write to, and these rows become installable."
                />
            )}

            {plugins.missing.length > 0 && (
                <Alert
                    type="warning"
                    showIcon
                    title="Named, but not in this build"
                    description={`This store asks for ${plugins.missing.join(', ')}, which this Dashboard was not assembled with.`}
                />
            )}

            {plugins.error && (
                <Alert type="error" showIcon title="The choice could not be saved" description={plugins.error} />
            )}

            {plugins.dirty && (
                <div className={styles.notice} data-testid="plugins-reload-notice">
                    Saved. The page has to be reloaded for it to take effect.{' '}
                    <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => window.location.reload()}
                        data-testid="plugins-reload"
                    >
                        Reload
                    </Button>
                </div>
            )}

            {sayStrict && (
                <div className={styles.notice}>
                    A turn is handed exactly the servers switched on here — servers registered
                    with the <code>claude</code> command itself are not added to them.
                </div>
            )}

            <ToolboxFilter value={filter} onChange={setFilter} />

            <div className={styles.list}>
                {components.map(component => (
                    <ComponentRow
                        key={component.id}
                        component={component}
                        toolbox={toolbox}
                        busy={busy}
                        onInstall={install}
                        onUninstall={uninstall}
                        onRegister={setRegistered}
                    />
                ))}

                {pluginRows.map(entry => (
                    <PluginRow
                        key={entry.id}
                        entry={entry}
                        checked={plugins.enabled.includes(entry.id)}
                        busy={plugins.saving}
                        onToggle={plugins.toggle}
                    />
                ))}

                {components.length === 0 && pluginRows.length === 0 && (
                    <div className={styles.empty} data-testid="toolbox-empty">Nothing here matches.</div>
                )}
            </div>

            {job && <JobLog job={job} />}
        </div>
    );
};

/** One plugin of this build: what it opens, and whether this store loads it. */
const PluginRow: React.FC<{
    entry: PluginCatalogueEntry;
    checked: boolean;
    busy: boolean;
    onToggle: (id: string, on: boolean) => Promise<void>;
}> = ({ entry, checked, busy, onToggle }) => (
    <div className={styles.row} data-testid={`plugin-row-${entry.id}`}>
        <div className={styles.rowHead}>
            <KindIcon kind="plugin" />
            <span className={styles.rowName} title={entry.id}>{entry.title}</span>
            {/* No tooltip on the switch, and not for want of a sentence to put in one: the row
                already says what the plugin is, and the icon beside it says what a plugin is. */}
            <Switch
                size="small"
                checked={checked}
                disabled={busy}
                aria-label={entry.title}
                onChange={value => void onToggle(entry.id, value)}
            />
        </div>
        <div className={styles.rowRole}>{entry.description}</div>
    </div>
);

/** One catalogue entry: what it is, where it stands, and the one thing to do about it. */
const ComponentRow: React.FC<{
    component: ToolboxComponent;
    toolbox: Toolbox;
    busy: boolean;
    onInstall: (ids: string[]) => Promise<void>;
    onUninstall: (ids: string[]) => Promise<void>;
    onRegister: (id: string, enabled: boolean) => Promise<void>;
}> = ({ component, toolbox, busy, onInstall, onUninstall, onRegister }) => {
    const [confirming, setConfirming] = useState(false);

    const titleOf = (id: string) =>
        toolbox.components.find(c => c.id === id)?.title ?? id;

    // The closure is resolved from the catalogue the panel already holds, so the confirmation names
    // what the install will actually do before a single request is sent.
    const missing = component.missingRequires ?? [];

    const startInstall = () => {
        if (missing.length === 0) {
            void onInstall([component.id]);
            return;
        }
        setConfirming(true);
    };

    // A row that does not answer is repaired the same way a missing one is: by installing it
    // again. What it deliberately does not get is the switch — handing a turn a server known not
    // to start is exactly what the handshake check exists to prevent, and the service refuses it.
    const broken = component.state === 'missing' || component.state === 'unresponsive';
    const canInstall = toolbox.enabled && !busy && (component.state === 'available' || broken);
    const canUninstall = toolbox.enabled && !busy
        && (component.state === 'installed' || component.state === 'unresponsive')
        && component.channel !== 'bundled' && component.channel !== 'remote';
    // An MCP server is switched on once it is on the machine. An agent's CLI carries the same
    // switch for a different reason: the row for one this panel did not install — an image's own,
    // or one that was on the machine first — has no uninstall to offer, and withdrawing the agent
    // from the tab is the control that is always available.
    const isAgent = Boolean(component.agent);
    const canRegister = (component.kind === 'mcp' || isAgent)
        && (component.state === 'installed' || component.state === 'present');

    return (
        <div className={styles.row} data-testid={`toolbox-row-${component.id}`}>
            <div className={styles.rowHead}>
                <KindIcon kind={component.kind} />
                <span className={styles.rowName} title={component.id}>{component.title}</span>
                <StateTag component={component} />
                {canRegister && (
                    <Tooltip title={agentSwitchTitle(isAgent, component.registered)}>
                        <Switch
                            size="small"
                            checked={component.registered}
                            disabled={busy}
                            onChange={value => void onRegister(component.id, value)}
                        />
                    </Tooltip>
                )}
                {canInstall && (
                    <Tooltip title={broken ? 'Install it again' : 'Install'}>
                        <Button type="text" size="small" icon={<DownloadOutlined />} onClick={startInstall} />
                    </Tooltip>
                )}
                {canUninstall && (
                    <Tooltip title="Uninstall">
                        <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => void onUninstall([component.id])}
                        />
                    </Tooltip>
                )}
            </div>

            <div className={styles.rowRole}>{component.role}</div>

            <div className={styles.rowMeta}>
                {component.channel && <span>{component.channel}</span>}
                {component.version && <span>{component.version}</span>}
                {/* What this server costs on every single request a turn makes — the one number
                    nothing else in DCMS would ever tell anyone. */}
                {component.tools ? (
                    <span>{component.tools} tools · {Math.round((component.toolBytes ?? 0) / 1024)} kB per request</span>
                ) : null}
            </div>

            {component.reason && <div className={styles.rowReason}>{component.reason}</div>}

            <Modal
                open={confirming}
                title={`Install ${component.title}`}
                okText="Install"
                onOk={() => { setConfirming(false); void onInstall([component.id]); }}
                onCancel={() => setConfirming(false)}
            >
                <p>
                    {component.title} needs {missing.map(titleOf).join(', ')}, which
                    {missing.length === 1 ? ' is' : ' are'} not installed yet.
                    Install {missing.length === 1 ? 'it' : 'them'} too?
                </p>
            </Modal>
        </div>
    );
};

/** What the switch means, which is not the same sentence for a server and for an agent. */
const agentSwitchTitle = (isAgent: boolean, registered: boolean): string => {
    if (isAgent) return registered ? 'Offered in the Conversations tab' : 'Not offered in the Conversations tab';
    return registered ? 'Handed to every turn' : 'Not handed to turns';
};

/** The badge that says where a row stands, and nothing more than that. */
const StateTag: React.FC<{ component: ToolboxComponent }> = ({ component }) => {
    switch (component.state) {
        case 'installed':
            return <Tag color="green">installed</Tag>;
        case 'present':
            return <Tag color="blue">on this machine</Tag>;
        case 'available':
            return null;
        case 'blocked':
            return <Tag color="orange">blocked</Tag>;
        case 'missing':
            return <Tag color="red">missing</Tag>;
        // Installed and dead. Said in the row rather than only in the job log, because the log
        // belongs to one install and this is the state the row is in from then on.
        case 'unresponsive':
            return <Tag color="red">does not answer</Tag>;
        case 'unavailable':
        default:
            return <Tag>not here</Tag>;
    }
};

/** The install, as it runs: what it is doing, and everything the tools have said so far. */
const JobLog: React.FC<{ job: NonNullable<Toolbox['job']> }> = ({ job }) => (
    <>
        <div className={styles.logHead}>
            {job.state === 'running' && <Spin size="small" />}
            <span>
                {job.op === 'install' ? 'Installing' : 'Removing'} {job.ids.join(', ')}
                {job.state === 'done' && ' — done'}
                {job.state === 'failed' && ' — failed'}
            </span>
        </div>
        {job.error && <Alert type="error" showIcon title={job.error} />}
        <pre className={styles.log} data-testid="toolbox-job-log">{job.log}</pre>
    </>
);
