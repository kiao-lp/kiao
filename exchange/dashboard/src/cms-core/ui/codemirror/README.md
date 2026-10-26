# Text comparison

`TextComparison` is available from `@cms-core`. It compares two strings without loading or saving
files. Both panes default to read-only; enable editing independently and keep the corresponding
string current in its change callback.

```tsx
const comparison = useRef<TextComparisonHandle>(null);
const [modified, setModified] = useState('Updated text');
const [navigation, setNavigation] = useState({ index: -1, count: 0 });

<TextComparison
    ref={comparison}
    original="Original text"
    modified={modified}
    modifiedReadOnly={false}
    onModifiedChange={setModified}
    onNavigationChange={setNavigation}
/>
```

`previousChange()` and `nextChange()` on the ref cycle through changes. F7 and Shift+F7 do the
same while focus is inside the comparison. Navigation reports a zero-based `index`, or `-1`
before a jump and after text changes, and the current `count`.

Labels and accessible pane names can be supplied separately. `extensions` adds CodeMirror
extensions, such as syntax highlighting, to both panes. Text, editability, extensions and the
Dashboard theme update in place; external text updates do not call the edit callbacks.

CodeMirror MergeView highlights changed characters, aligns unchanged lines (including wrapped
lines), and gives both panes one vertical scroller. The Git viewer owns its requests, drafts,
save action and toolbar separately.
