import { ReactNode } from "react";
import { FileDto } from "src/cms-core/files/service";
import type { ToolBarTab } from "../tool-bars/ToolBars-ctx";
import type { DashboardConfig } from "../config/DashboardConfig-ctx";
import { AppRouteDeclaration } from '../app-routes';


export type FileLabelCmp = React.FC<{ file: FileDto }>;
export type MainViewCmp = React.FC;

export interface FileTypeConfig {

    fileLabelCmp: FileLabelCmp;
    mainView: MainViewCmp;
    withGlobalProvider?: (node: ReactNode) => ReactNode;
}

export interface FileBasedPlugin {
    fileConfigFor: (file: FileDto) => FileTypeConfig | null;
    markdownRenderers?: Record<string, LinkRenderer>;
    /**
     * Suffixes are fixed during rename; the longest matching suffix wins between claimants.
     * fileConfigFor remains the matcher and may claim files without a declared suffix.
     */
    fileExtensions?: string[];
    /** Consider only after all specific claimants pass; longest suffix wins among fallbacks. */
    fallback?: boolean;
    /**
     * App-wide cross-plugin values, absent when no provider is loaded; never import another plugin.
     * Names and types belong to @cms-kit/capabilities, not cms-core.
     * Duplicate names retain all providers in assembly order; consumers decide how to use them.
     * Hooks are safe only because the registry is fixed before the first render for the app's life.
     */
    capabilities?: Record<string, unknown>;
}

export interface ToolBarDeclaration extends ToolBarTab {
    /** Omit the tab when runtime configuration disables it. */
    isEnabled?: (config: DashboardConfig) => boolean;
}

/**
 * Exported as plugin from each plugin's index.tsx. CreationProvider wrappers register creation
 * commands and preserve children. toolBars register in plugin order; hosts choose placement.
 * isEnabled gates all contributions. Plugins without file types return null from fileConfigFor.
 */
export interface CmsPlugin extends FileBasedPlugin {
    /** Stable, unique id; also the React key. */
    id: string;
    /** URL prefixes rendered instead of store documents and excluded from file-path resolution. */
    appRoutes?: AppRouteDeclaration[];
    CreationProvider?: React.FC<{ children?: ReactNode }>;
    /** App-lifetime providers, composed in plugin-list order, outermost first; survive view navigation. */
    providers?: React.FC<{ children?: ReactNode }>[];
    toolBars?: ToolBarDeclaration[];
    isEnabled?: (config: DashboardConfig) => boolean;
}

export type LinkRenderer = React.FC<{ id: string, title: string, isLink?: boolean }>;
