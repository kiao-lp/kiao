
export type { FileDto } from './files/service';
export type { FileLabelCmp, MainViewCmp, FileBasedPlugin, CmsPlugin, ToolBarDeclaration, ToolsMenuItemDeclaration } from './extensibility/FileBasedPlugin';
export { lazyComponent } from './ui-foundation/react/lazyComponent';

export { extractFileNameFn, extractName, parentPath } from './files/service';
export { Clipboard } from './ui-foundation';
export { markInternalNavigation, internalReload } from './navigation/internal-navigation';
// Store internal links bare; resolve against the app mount point for display.
// Use these helpers whenever writing or rendering document links.
export { toStoredLink, resolveInternalLink, internalPathOf, storedLinkOf } from './navigation/internal-links';

// Reusable UI lives in ui-foundation; Dashboard preference adapters live in dashboard-ui.
export { VoiceInput, VoiceTextArea } from './ui-foundation/voice-input';
export type { VoiceInputProps, VoiceTextAreaProps } from './ui-foundation/voice-input';
export { useVoiceInput } from './ui-foundation/voice-input/VoiceInputContext';
export { VoiceInputPreferences as VoiceInputProvider } from './dashboard-ui/preferences/VoiceInputPreferences';
export { CodeMirrorTextEditor } from './ui-foundation/code-editor/LazyCodeMirrorTextEditor';
export { TextComparison } from './ui-foundation/code-editor/LazyTextComparison';
export type { TextComparisonProps, TextComparisonHandle, TextComparisonNavigation } from './ui-foundation/code-editor/TextComparison';
export { editorScrollDelta, editorTopLine } from './ui-foundation/code-editor/editorScroll';
export { LanguageFlag, LanguageFlag as KiaoFlag } from './ui-foundation/language/LanguageFlag';
// All app tooltips use this wrapper for viewport placement and pointer-stillness timing.
export { Tooltip, TOOLTIP_STILL_SECONDS } from './ui-foundation/feedback/Tooltip';
export type { AppTooltipProps } from './ui-foundation/feedback/Tooltip';
// Custom surfaces must follow the page-wide theme.
export { useTheme } from './ui-foundation/theme/ThemeContext';
export type { Theme } from './ui-foundation/theme/ThemeContext';


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

export { usePluginHotkeys } from './hotkeys/usePluginHotkeys';
export type { HotkeyDescriptor, CommandContext } from './hotkeys/HotkeyRegistry';
export { useSelectionContext, useIsSelected, useElementSelection, Selectable } from './ui-foundation/interactions/selection';
export { useSingleTargetElement, useCleanSelectionAndPointing } from './ui-foundation/interactions/selectionTarget';
// Spread zoomable onto elements to enable Ctrl-click zoom and the top-banner slider.
export { useZoomTarget, useZoomTargetOptional, zoomable, MIN_ZOOM, MAX_ZOOM } from './ui-foundation/zoom';
// Use for all context menus, including plugin menus, to keep them in the viewport.
export { KEEP_MENU_IN_VIEWPORT } from './ui-foundation/interactions/menuPlacement';
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
export { usePluginCapabilities } from './extensibility/PluginList-ctx';

export * from './markdown';
export { ConfiguredMarkdown } from './markdown/ConfiguredMarkdown';

export { LayoutContent } from './dashboard-ui/layout/LayoutContent';
// Dialog container covering only the document area.
export { useDocumentArea } from './dashboard-ui/documents/DocumentArea-ctx';
// Panels overlay their host tab without blocking chrome; confirmations remain modals.
export { CentralStackProvider, CentralStackView, useCentralStack } from './dashboard-ui/documents/CentralStack-ctx';
export type { CentralPanel } from './dashboard-ui/documents/CentralStack-ctx';
export { TopBanner } from './dashboard-ui/top-banner/TopBanner';

// Plugins declare toolBars; users choose placement per document via the Show menu.
// showTab reveals a panel, or the document itself via DOCUMENT_TAB_ID.
export { useToolBars, useToolBarsOptional } from './dashboard-ui/toolbars/ToolBars-ctx';
export type { ToolBarTab } from './dashboard-ui/toolbars/ToolBars-ctx';
export type { BarId, BarSide, BarSpec } from './dashboard-ui/toolbars/barsModel';
export { CENTER_BAR_ID, CENTER_2_BAR_ID } from './dashboard-ui/toolbars/barsModel';
export { DOCUMENT_TAB_ID } from './dashboard-ui/documents/DocumentContent-ctx';
export { SECONDARY_DOCUMENT_TAB_ID, useSecondaryDocument } from './dashboard-ui/documents/secondary';
export type { SecondaryDocumentValue } from './dashboard-ui/documents/secondary';

export { SplitRow } from './dashboard-ui/preferences/PersistentSplitRow';
export type { SplitRowProps } from './dashboard-ui/preferences/PersistentSplitRow';
export type { SplitPart } from './ui-foundation/layout';

// Non-store pages claim a URL prefix; the plugin owns everything beneath it.
export { useAppRoute, useAppRoutes, matchAppRoute } from './app-routes';
export type { AppRouteDeclaration, AppRouteMatch } from './app-routes';

export {
    ErrorBoundary, InProgressFeedback, LanguageSelect, ConfirmModal, KeyValueMapEditor,
    FormField, VerticalBar, AsyncImage, ImagePreview, PageNavigation, HighlightedText, UnicodeKeyboard,
    CopyButton, CopyHtmlButton, CopySvgButton,
    CodeMirrorCodeEditor, CodeMirrorJsonEditor, jsonSchemaExtensions,
    JSON_SCHEMA_DRAFT_2020_12, JSON_SCHEMA_META_SCHEMA,
    ReorderHandle, useReorderable, moveInArray, indexForSlot, slotAt,
    ROW_CLASS_DRAGGING, ROW_CLASS_DROP_BEFORE, ROW_CLASS_DROP_AFTER,
    useStickToBottom, useMouseOverViewport, languages, LANGUAGE_NAMES,
    ZoomControl, useZoom, StyleInjector, ToolbarButton,
    IconCopy, IconPaste, IconCopyFile, IconPasteFile, IconRefresh, IconDownload,
    IconZoomIn, IconZoomOut, IconCheck, IconFitToContent, IconNormalize,
    IconPicture, IconFile, IconSun, IconMoon, IconPlay,
} from './ui-foundation';
export type {
    CodeMirrorCodeEditorRef, CodeMirrorCodeEditorProps,
    CodeMirrorJsonEditorRef, CodeMirrorJsonEditorProps, JsonSchema,
    Reorderable, ReorderableOptions, ReorderHandleProps, ReorderRowProps,
    StickToBottom, UseZoomOptions, StyleInjectorProps, ToolbarButtonProps,
} from './ui-foundation';
