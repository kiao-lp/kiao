import { ReactNode } from "react";
import { FileDto } from "src/cms-core/files/service";
import type { ToolBarTab } from "../dashboard-ui/toolbars/ToolBars-ctx";
import type { DashboardConfig } from "../config/DashboardConfig-ctx";
import { AppRouteDeclaration } from '../app-routes';
import type { CentralPanel } from '../dashboard-ui/documents/CentralStack-ctx';


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
    /** Declared suffixes; longest match wins. fileConfigFor may claim without one. */
    fileExtensions?: string[];
    /** Consider only after all specific claimants pass; longest suffix wins among fallbacks. */
    fallback?: boolean;
    /** Cross-plugin values; names/types live in @cms-kit/capabilities. Registry is fixed before first render; duplicates keep assembly order. */
    capabilities?: Record<string, unknown>;
}

export interface ToolBarDeclaration extends ToolBarTab {
    /** Omit the tab when runtime configuration disables it. */
    isEnabled?: (config: DashboardConfig) => boolean;
}

export interface ToolsMenuItemDeclaration {
    id: string;
    label: ReactNode;
    icon?: ReactNode;
    /** Opens over the active central tab. The item id identifies the panel. */
    panel: Omit<CentralPanel, 'id' | 'host'>;
    isEnabled?: (config: DashboardConfig) => boolean;
}

/** Plugin export. File handling is optional; isEnabled gates routes, tabs and tools menu items. */
export interface CmsPlugin extends Partial<FileBasedPlugin> {
    /** Stable, unique id; also the React key. */
    id: string;
    /** URL prefixes rendered instead of store documents and excluded from file-path resolution. */
    appRoutes?: AppRouteDeclaration[];
    CreationProvider?: React.FC<{ children?: ReactNode }>;
    /** App-lifetime providers, composed in plugin-list order, outermost first; survive view navigation. */
    providers?: React.FC<{ children?: ReactNode }>[];
    toolBars?: ToolBarDeclaration[];
    toolsMenuItems?: ToolsMenuItemDeclaration[];
    isEnabled?: (config: DashboardConfig) => boolean;
}

export type LinkRenderer = React.FC<{ id: string, title: string, isLink?: boolean }>;
