import type { ReactNode } from 'react';
import type { WorkerClient } from 'kiao-worker';
import type { FileDto } from '../files/service';

export interface SideDocumentContext {
    /** The open document beside this pane. */
    hostFile: FileDto;
    /** Store path derived by pathFor. */
    path: string;
}

/**
 * Declared by the side-document plugin; hosts accept any declaration via SideDocumentRow
 * and SideDocumentToggles, without importing that plugin.
 */
export interface SideDocumentDeclaration {
    /** Stable, unique id; React key and persisted pane state key. */
    id: string;
    title: string;
    icon: ReactNode;
    /** Derive from the host path so both move/rename together; null means no side document. */
    pathFor: (hostFile: FileDto) => string | null;
    /** Called only for paths not yet in the store; may write unconditionally. */
    create: (path: string, client: WorkerClient) => Promise<void>;
    /** Receives its own scrolling box. */
    render: (context: SideDocumentContext) => ReactNode;
}
