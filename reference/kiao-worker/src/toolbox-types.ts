// Toolbox wire types; field names must match internal/toolbox/install/dto.go. Requests name only compiled catalogue ids.

/** Runtimes include agent CLIs and service tools; only MCP servers and agent CLIs can be registered. */
export type ToolboxKind = 'runtime' | 'mcp';

/**
 * installed: service-owned, removable; present: externally owned, not removable.
 * available: installable; blocked: unmet precondition in reason; unavailable: no recipe.
 * missing: ledger install absent from disk; reinstall repairs it.
 * unresponsive: installed but fails the MCP handshake; reason holds diagnostics, reinstall probes again.
 */
export type ToolboxState =
    'installed' | 'present' | 'available' | 'blocked' | 'unavailable' | 'missing' | 'unresponsive';

export interface ToolboxComponent {
    id: string;
    kind: ToolboxKind;
    /** Agent-tab id (e.g. "claude", "codex"); enables registration for this runtime. Absent otherwise. */
    agent?: string;
    title: string;
    role: string;

    /** Resolved platform channel (e.g. "uv", "npm"); absent when unavailable. */
    channel?: string;

    state: ToolboxState;
    /** State explanation, displayed verbatim. */
    reason?: string;

    requires?: string[];
    /** Uninstalled dependencies to name in the install confirmation. */
    missingRequires?: string[];

    version?: string;
    installedAt?: string;

    /** Offered to turns independently of installation; external agent CLIs default on. Other runtimes ignore this. */
    registered: boolean;
    /** Number of declared tools; toolBytes measures definition bytes sent with every request. */
    tools?: number;
    toolBytes?: number;
    /** Last successful or failed probe; absent if never probed. */
    probedAt?: string;
}

/** GET /toolbox and POST /toolbox/registration response. */
export interface Toolbox {
    /** False without an install prefix; catalogue is then read-only. */
    enabled: boolean;
    /** Recipe platform: "debian", "alpine" or "generic". */
    platform: string;
    prefix?: string;
    /** A registered server restricts turns to these servers, overriding the CLI configuration; disclose in the panel. */
    strict: boolean;

    components: ToolboxComponent[];
    /** Current or last finished job; at most one runs at a time. */
    job?: ToolboxJob;
}

export type ToolboxJobState = 'running' | 'done' | 'failed';

/** Install/uninstall return 202; poll GET /toolbox/jobs/{id} while running for the growing log. */
export interface ToolboxJob {
    id: string;
    op: 'install' | 'uninstall';
    ids: string[];
    state: ToolboxJobState;
    log: string;
    error?: string;
    startedAt: string;
    endedAt?: string;
}

/** Install/uninstall/registration body; only registration reads enabled. */
export interface ToolboxRequest {
    ids: string[];
    enabled?: boolean;
}
