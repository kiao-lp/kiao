
export type { FileDto } from './files/service';
export type { FileLabelCmp, MainViewCmp, FileBasedPlugin, CmsPlugin, ToolBarDeclaration } from './core/FileBasedPlugin';
export { lazyComponent } from './core/lazyComponent';

export { extractFileNameFn, extractName, parentPath } from './files/service';
export * as Clipboard from './lib/clipboard';
export { markInternalNavigation, internalReload } from './lib/internal-navigation';
// Store internal links bare; resolve against the app mount point for display.
// Use these helpers whenever writing or rendering document links.
export { toStoredLink, resolveInternalLink, internalPathOf, storedLinkOf } from './lib/internal-links';

// Shared widgets used by cms-core itself belong here; other shared widgets belong in the kit.
export { VoiceInput, VoiceTextArea } from './ui/VoiceInput';
export type { VoiceInputProps, VoiceTextAreaProps } from './ui/VoiceInput';
export { VoiceInputProvider, useVoiceInput } from './ui/VoiceInput/VoiceInputContext';
export { CodeMirrorTextEditor } from './ui/codemirror/LazyCodeMirrorTextEditor';
export { TextComparison } from './ui/codemirror/LazyTextComparison';
export type { TextComparisonProps, TextComparisonHandle, TextComparisonNavigation } from './ui/codemirror/TextComparison';
export { editorScrollDelta, editorTopLine } from './ui/codemirror/editorScroll';
export { KiaoFlag } from './ui/components/KiaoFlag';
// All app tooltips use this wrapper for viewport placement and pointer-stillness timing.
export { Tooltip, TOOLTIP_STILL_SECONDS } from './ui/Tooltip';
export type { AppTooltipProps } from './ui/Tooltip';
// Custom surfaces must follow the page-wide theme.
export { useTheme } from '../ThemeContext';
export type { Theme } from '../ThemeContext';


export { useFileBrowsingPersistenceContext } from './files/core/FileBrowsingPersistence-ctx';
// Runtime feature gates, including partial plugin dependencies; also passed to isEnabled.
export { useDashboardConfig } from './config/DashboardConfig-ctx';
export type { DashboardConfig } from './config/DashboardConfig-ctx';
export { useWorkerClient } from './files/service/ui';
export { TOOLBOX_CHANGED_EVENT } from './toolbox/events';
export { useAuthenticatedFileUrl } from './files/service';
// Returns undefined in builds without security.
export { useAuthToken } from './auth/authToken';
export { useRefreshFileList, useCurrentFileListContext } from './files/core/CurrentFileList-ctx';
export { useFileSearchContext } from './files/core/FileSearch-ctx';
// Reads, debounce-saves edits, and follows disk changes using the plugin codec.
export { useDocumentFileSync } from './files/disk-sync/useDocumentFileSync';
export type { DocumentFileSync, DocumentCodec } from './files/disk-sync/useDocumentFileSync';
export { useTextFileSync } from './files/disk-sync/useTextFileSync';
export type { TextFileSync } from './files/disk-sync/useTextFileSync';

// View state persists per file (see view-state/viewStateModel.ts).
export {
    useFileViewState, useFolderViewState, useGlobalViewState,
} from './view-state';
export type { ScopeUpdater } from './view-state';

// WICG text-directive grammar with an app-readable #text= delimiter.
// See text-fragment/textDirective.ts for client-rendering and delimiter constraints.
export { useTextFragment, PassageContextMenu, parseTextFragment, textFragmentOf, linkToPassage } from './text-fragment';
export type { TextFragmentState, PassageContextMenuProps, TextDirective } from './text-fragment';


// Plugins declare menu entries; cms-core renders them.
export { useCreationCommand, useCreationCommandList } from './files/creation/useCreationCommand';
export type { CreationCommandDescriptor, CreationContext } from './files/creation/CreationCommandRegistry';
export { useContextMenuItems } from './files/context-menu/useContextMenuItems';
export type { ContextMenuItemDescriptor, ContextMenuContext, PointedFileInfo } from './files/context-menu/ContextMenuRegistry';
export { useNavigation } from './files/navigation/NavigationModel';
export type { NavigationModelApi } from './files/navigation/NavigationModel';

export { usePluginHotkeys } from './commands/usePluginHotkeys';
export type { HotkeyDescriptor, CommandContext } from './commands/HotkeyRegistry';
export { useSelectionContext, useIsSelected, useElementSelection, Selectable } from './selection';
export { useSingleTargetElement, useCleanSelectionAndPointing } from './selection/pointing';
// Spread zoomable onto elements to enable Ctrl-click zoom and the top-banner slider.
export { useZoomTarget, useZoomTargetOptional, zoomable, MIN_ZOOM, MAX_ZOOM } from './zoom';
// Use for all context menus, including plugin menus, to keep them in the viewport.
export { KEEP_MENU_IN_VIEWPORT } from './files/context-menu/menuPlacement';
export { useRenameTarget } from './files/selection/RenameTarget-ctx';
export { useFileSelection } from './files/selection/SelectionModel-ctx';
// markdownLinkDrop is for CodeMirror; markdownLinkDropHandlers is for textarea.
export { holdsDraggedFiles, markdownLinkOf, markdownLinksOf, readDraggedFiles, writeDraggedFiles } from './files/dnd/dragPaths';
export type { DraggedFile } from './files/dnd/dragPaths';
export { markdownLinkDrop, markdownLinkDropHandlers } from './files/dnd/markdownLinkDrop';
export { useFileDrop } from './files/dnd/useFileDrop';
export type { FileDrop, FileDropProps } from './files/dnd/useFileDrop';
export { RevealInTreeButton } from './files/nav-bar/RevealInTreeButton';
export { useRevealInTree } from './files/nav-bar/RevealInTree-ctx';

// Raw capabilities from loaded manifests. Consumers should use the typed accessors
// in @cms-kit/capabilities; capability names and types belong to the kit.
export { usePluginCapabilities } from './core/PluginList-ctx';

export * from './markdown';
export { ConfiguredMarkdown } from './markdown/ConfiguredMarkdown';

export { LayoutContent } from './core/LayoutContent';
// Dialog container covering only the document area.
export { useDocumentArea } from './core/DocumentArea-ctx';
// Panels overlay the document without blocking chrome; confirmations remain modals.
export { CentralStackProvider, CentralStackView, useCentralStack } from './core/CentralStack-ctx';
export type { CentralPanel } from './core/CentralStack-ctx';
export { TopBanner } from './top-banner/TopBanner';

// Plugins declare toolBars; users choose placement per document via the Show menu.
// showTab reveals a panel, or the document itself via DOCUMENT_TAB_ID.
export { useToolBars } from './tool-bars/ToolBars-ctx';
export type { ToolBarTab } from './tool-bars/ToolBars-ctx';
export type { BarId, BarSide, BarSpec } from './tool-bars/barsModel';
export { DOCUMENT_TAB_ID } from './core/DocumentContent-ctx';
export { SECONDARY_DOCUMENT_TAB_ID, useSecondaryDocument } from './secondary-document';
export type { SecondaryDocumentValue } from './secondary-document';

export { SplitRow } from './split';
export type { SplitRowProps, SplitPart } from './split';

// Non-store pages claim a URL prefix; the plugin owns everything beneath it.
export { useAppRoute, useAppRoutes, matchAppRoute } from './app-routes';
export type { AppRouteDeclaration, AppRouteMatch } from './app-routes';
