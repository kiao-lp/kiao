---
name: featmat
description: This skill should be used when the user asks to "create a feature matrix", "compare options", "create an .fmat.json file", "edit a feature matrix", "add a feature to the matrix", "add an option to the comparison", "write featmat", "edit featmat", or works with .fmat.json files, feature comparison matrices, or MoSCoW-weighted option scoring.
---

# FeatMat — Feature Matrix for Weighted Option Comparison

FeatMat is a structured JSON format for comparing options (tools, products, approaches) against a set of features with support-level scoring and optional MoSCoW weighting. Files use the `.fmat.json` extension.

## File Format

A `.fmat.json` file is a JSON object with two required arrays (`features`, `options`) and one optional array (`requirements`).

```json
{
  "features": [ ... ],
  "options": [ ... ],
  "requirements": [ ... ]
}
```

### Feature Object

```json
{
  "id": "feature_id",
  "label": "Human-readable name",
  "description": "Optional explanation of what this feature means"
}
```

- **id** (required): Snake_case unique identifier, used as keys in option `support` maps
- **label** (required): Short display name
- **description** (optional): Tooltip/explanation text

### Option Object

```json
{
  "id": "option_id",
  "label": "Option Name",
  "support": {
    "feature_id_1": "ootb",
    "feature_id_2": { "level": "configuration", "comment": "Requires the **Pro** plan" },
    "feature_id_3": "not-supported"
  }
}
```

- **id** (required): Unique identifier for the option
- **label** (required): Display name
- **support** (required): Map from feature IDs to support entries

### Support Entries

Each value in the `support` map is either a bare support-level string or an object with an optional markdown comment:

| Form | Example |
|------|---------|
| Bare string | `"ootb"` |
| Object | `{ "level": "ootb", "comment": "Since v2.0" }` |

Both forms are interchangeable — use the object form when you want to explain **why** a particular level was chosen or **how** to get the feature. The comment is rendered as a markdown tooltip when hovering over the cell in the Dashboard preview and in exported SVGs. Supported markdown syntax: **bold**, *italic*, `inline code`, lists, links, and headings.

### Support Levels

Every entry in the `support` map must be one of these four values:

| Value | Label | Emoji | Score | Also means… |
|-------|-------|-------|-------|-------------|
| `"ootb"` | Out of the Box | ✅ | 3 | Works natively, no setup required |
| `"configuration"` | Configuration | 🔧 | 2 | Requires settings/config but no code; or "pretty easy to get" |
| `"customization"` | Customization | 🔨 | 1 | Requires code, plugins, or integration work; or "pretty hard to get" |
| `"not-supported"` | Not Supported | ❌ | 0 | Feature is unavailable; or hard, very hard, or impossible to get |

The four levels form a spectrum from "zero effort" to "not worth it". Use `"configuration"` when the feature is straightforward to unlock even if it technically involves more than a config file. Use `"customization"` when real engineering effort is required. Use `"not-supported"` when achieving the feature is a non-starter regardless of effort.

### Support Map Completeness

Every option's `support` map should contain an entry for **every** feature ID. Missing entries are treated as score 0 (not supported) by the scoring engine.

### Requirement List Object

```json
{
  "id": "renting",
  "label": "Renting",
  "description": "Optional one-line context shown in the UI",
  "weights": {
    "feature_id_1": "must",
    "feature_id_2": "should",
    "feature_id_3": "wont"
  }
}
```

- **id** (required): Snake_case unique identifier
- **label** (required): Display name shown in the requirements dropdown
- **description** (optional): Brief context shown next to the selector
- **weights** (required): Partial map of feature IDs to MoSCoW levels — omitted feature IDs default to `'could'`

When `requirements` is present, the UI shows a dropdown at the top of the matrix. Selecting a preset populates all MoSCoW weights from that requirement list. The user can still edit individual weights afterward, which automatically switches to "Custom" mode. The first requirement in the array is selected by default.

Use requirement lists when the same set of features needs to be evaluated under different contexts or personas — e.g., renting vs. buying, individual vs. enterprise, MVP vs. full rollout.

## Scoring System

The UI supports optional MoSCoW prioritization per feature. Users assign weights interactively, or select a predefined requirement list. Ad-hoc weights are **not stored in the JSON file**; predefined lists are stored in the `requirements` array.

### MoSCoW Weights

| Level | Label | Short | Weight |
|-------|-------|-------|--------|
| `"must"` | Must have | M | 8 |
| `"should"` | Should have | S | 4 |
| `"could"` | Could have | C | 2 |
| `"wont"` | Won't have | W | 0 |

### Score Computation

- **Cell score** = `moscow_weight * support_score`
- **Option total** = sum of cell scores across all features
- Higher scores are better (maximum per cell = 8 × 3 = 24 for a "must have" feature with "ootb" support)

### Background Highlighting

The UI highlights cells where points are being **lost** (gap from maximum). The background formula computes a red-tinted opacity based on `weight * (MAX_SUPPORT_SCORE - supportScore)`, making "must have" features with low support levels visually prominent.

## Complete Example

```json
{
  "features": [
    { "id": "arch_diagram",    "label": "Architecture diagrams",  "description": "Visual component/relation diagrams" },
    { "id": "live_preview",    "label": "Live preview",           "description": "Real-time rendering as you edit" },
    { "id": "file_format",     "label": "Plain-text file format", "description": "Human-readable, VCS-friendly" },
    { "id": "vscode_editor",   "label": "VS Code custom editor",  "description": "Dedicated editor with dual view" },
    { "id": "template_engine", "label": "Template engine",        "description": "Variable substitution and instantiation" }
  ],
  "options": [
    {
      "id": "tool_a",
      "label": "Tool A",
      "support": {
        "arch_diagram":    "ootb",
        "live_preview":    "ootb",
        "file_format":     "ootb",
        "vscode_editor":   "ootb",
        "template_engine": "ootb"
      }
    },
    {
      "id": "tool_b",
      "label": "Tool B",
      "support": {
        "arch_diagram":    "ootb",
        "live_preview":    { "level": "configuration", "comment": "Requires enabling the `preview` flag in **settings.json**" },
        "file_format":     "customization",
        "vscode_editor":   "not-supported",
        "template_engine": "not-supported"
      }
    }
  ],
  "requirements": [
    {
      "id": "solo_dev",
      "label": "Solo developer",
      "description": "Personal projects, no team needed",
      "weights": {
        "arch_diagram":    "must",
        "live_preview":    "must",
        "file_format":     "should",
        "vscode_editor":   "should",
        "template_engine": "could"
      }
    },
    {
      "id": "team",
      "label": "Team",
      "description": "Multiple contributors, VCS-centric workflow",
      "weights": {
        "arch_diagram":    "must",
        "live_preview":    "should",
        "file_format":     "must",
        "vscode_editor":   "could",
        "template_engine": "must"
      }
    }
  ]
}
```

## Editing Guidelines

### Creating a New `.fmat.json` File

1. Identify the features (criteria) to compare against — use snake_case IDs
2. Identify the options (candidates) being compared
3. For each option, assess support level for every feature
4. Include descriptions for features that aren't self-explanatory
5. Ensure every option's `support` map covers all feature IDs

### Modifying an Existing `.fmat.json` File

1. **Adding a feature**: Add the feature object to the `features` array, then add a support entry for this feature ID in **every** existing option's `support` map
2. **Adding an option**: Add the option object to the `options` array with a `support` map covering **all** existing feature IDs
3. **Changing a support level**: Update the value in the option's `support` map — must be one of `"ootb"`, `"configuration"`, `"customization"`, or `"not-supported"`. Use the object form `{ "level": "...", "comment": "..." }` when a justification or explanation is useful
4. **Removing a feature**: Remove from `features` array and remove corresponding entries from all options' `support` maps
5. **Removing an option**: Remove the entire option object from the `options` array

### Common Mistakes to Avoid

- **Using support values other than the four defined levels** — only `"ootb"`, `"configuration"`, `"customization"`, and `"not-supported"` are valid
- **Incomplete support maps** — every option must have entries for every feature
- **Storing ad-hoc MoSCoW weights in the file** — interactive weights are runtime-only; use `requirements` if you want to persist named weight presets
- **Using camelCase for feature IDs** — use snake_case for consistency
- **Duplicate feature or option IDs** — all IDs must be unique within their array
