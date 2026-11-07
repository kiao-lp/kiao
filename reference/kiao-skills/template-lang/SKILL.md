---
name: template-lang
description: This skill should be used when the user asks to "create a template", "modify a .temp.md file", "add a sub-template", "add a variable", "write template-lang", "edit template-lang", or works with .temp.md files, archtools template engine, Kiao Expression Language (KEL), or template instantiation.
---

# TemplateLang — Template Engine with Expression Language

TemplateLang is a markdown-based template format that supports variable substitution, optional sections (sub-templates), and type-aware expressions. Files use the `.temp.md` extension.

## File Format

A `.temp.md` file is a structured markdown document using headings to define templates:

- **H1** (`#`): Template collection name (required, exactly one)
- **Text between H1 and first H2**: Index/description text (optional)
- **H2** (`##`): Template sections — either Root or sub-templates
- **H3** (`###`): Template content blocks within each H2 section

### Minimal Structure

```markdown
# Template Name

## Root

### textTemplate

```text
Template content with ${variables}
```​
```

### Full Structure with Sub-Templates

```markdown
# Template Name

Optional description text here.

## Root

### textTemplate

```text
${sectionA}${sectionB}
Main content using ${someVar:text}
```​

## Section A

### defaultText

```text
Default content when disabled
```​

### textTemplate

```text
Content when Section A is enabled: ${detail:text}
```​

## Section B

### textTemplate

```text
Always-included section content
```​
```

## Root Template

The `## Root` section is required and contains the main template body under `### textTemplate`. This is the entry point for instantiation — all sub-templates are referenced from here via `${subTemplateId}` expressions.

## Sub-Templates

Every `## Section` (other than `## Root`) defines a sub-template. Sub-templates have:

- **ID**: Derived from the heading using camelCase conversion (`"Hot reloading"` becomes `hotReloading`)
- **textTemplate** (required): Content used when the sub-template is enabled
- **defaultText** (optional): Fallback content when the sub-template is disabled

### Enabled/Disabled Logic

- If a sub-template has a `defaultText` section, it is **optional** — the user can enable or disable it. When disabled, `defaultText` is used instead.
- If a sub-template has **no** `defaultText` section, it is **always enabled** — its `textTemplate` is always included.

### ID Conversion Rules

Heading titles are converted to camelCase IDs:
- `"Hot reloading"` → `hotReloading`
- `"Migration script"` → `migrationScript`
- `"E2e tests"` → `e2eTests`
- Single words are lowercased: `"Title"` → `title`
- Already camelCase strings are preserved: `"commitType"` → `commitType`

## Kiao Expression Language (KEL)

Template content uses `${...}` expressions for variable substitution.

### Expression Syntax

```
${key:typeSpec=defaultValue}
```

All parts except `key` are optional:
- **key**: Variable name (required)
- **typeSpec**: Type specification (optional)
- **defaultValue**: Default value after `=` (optional)

### Expression Forms

| Form | Example | Behavior |
|------|---------|----------|
| Simple variable | `${name}` | Text input, no type |
| Typed variable | `${name:text}` | Explicit text type |
| File of the store | `${doc:file}` | Text box a file is dropped into from the navigation tree |
| Type with field | `${region:AwsRegion.code}` | Lookup type, specific field |
| Inline enum | `${type:"feat"\|"fix"\|"chore"}` | Dropdown with listed values |
| With default | `${name:text=John}` | Pre-filled default value |
| Enum with default | `${level:"a"\|"b"\|"c"=b}` | Dropdown defaulting to "b" |
| Sub-template ref | `${hotReloading}` | Replaced by sub-template content |

### Type Specifications

- **`text`**: Free-form text input
- **`file`**: A file of the store, named by dragging it out of the navigation tree or the file
  browser onto the box. It stays an ordinary text box — a path can be typed or corrected by hand.
  The drop fills two fields: `${doc:file}` is the path from the store root, with a leading slash
  and nothing escaped, and `${doc:file.name}` is the file's name alone. A dropped folder is taken
  as its own path.
- **`"val1"|"val2"|"val3"`**: Inline enum — rendered as a dropdown. Values are quoted and pipe-separated.
- **Custom type name** (e.g., `AwsRegion`): Lookup against a type registry, rendered as a dropdown
- **Type with field** (e.g., `AwsRegion.code`): Use a specific field from the type object

`text`, `file` and an inline enum are the types the CMS draws itself; every other name is looked up
against the store's value providers.

### Substitution Process

1. Build a heap (key→value map) from user inputs and sub-template states
2. For each enabled sub-template, its `textTemplate` becomes the value; for disabled ones, `defaultText` is used
3. All `${...}` expressions in the root template are replaced with heap values
4. Substitution loops until no more replacements can be made (enabling recursive templates)

## Code Fence Wrapping

Template content inside `### textTemplate` and `### defaultText` sections should be wrapped in markdown code fences:

````markdown
### textTemplate

```text
Template content here
```
````

The parser strips code fences automatically. Any language tag is accepted (`text`, `markdown`, etc.). When serializing, code fences with the `text` language tag are always added.

## Complete Example

```markdown
# Commit Message

A template for generating structured commit messages.

## Root

### textTemplate

```text
${title}${body}${footer}
```​

## Title

### textTemplate

```text
${commitType:"fix"|"feat"|"refactor"|"chore"}(${scope:text}): ${message:text}
```​

## Body

### defaultText

```text

```​

### textTemplate

```text

${description:text}
```​

## Footer

### defaultText

```text

```​

### textTemplate

```text

Co-authored-by: ${author:text}
```​
```

In this example:
- **Title** has no `defaultText`, so it's always included
- **Body** and **Footer** have `defaultText` (empty), so they are optional toggle sections
- `${commitType:"fix"|"feat"|"refactor"|"chore"}` renders as a dropdown
- `${scope:text}` and `${message:text}` render as text inputs

## Editing Guidelines

### Creating a New `.temp.md` File

1. Start with `# Template Name` as the H1 heading
2. Add `## Root` with `### textTemplate` containing the main template body
3. Use `${variableName}` for user inputs and `${subTemplateId}` for optional sections
4. For each optional section, add a `## Section Name` with both `### defaultText` and `### textTemplate`
5. For always-included sections, add `## Section Name` with only `### textTemplate`
6. Wrap all template content in `` ```text `` code fences

### Modifying an Existing `.temp.md` File

1. **Adding a variable**: Insert a `${key:type}` expression in the appropriate template section
2. **Adding a sub-template**: Add a new `## Section Name` with `### textTemplate` (and optionally `### defaultText`). Reference it in the root or parent template with `${sectionId}`
3. **Making a section optional**: Add a `### defaultText` block (can be empty: just `` ```text\n\n``` ``)
4. **Removing a section**: Remove the `## Section` and all its H3 children. Remove the `${sectionId}` reference from the root template
5. **Changing a variable type**: Update the type spec in the `${key:newType}` expression

### Common Mistakes to Avoid

- **Missing `## Root` section** — every template must have a Root section with a textTemplate
- **Referencing a sub-template ID that doesn't match** — the ID is camelCase of the heading, e.g., `"Hot reloading"` → `${hotReloading}`, not `${hot_reloading}` or `${Hot reloading}`
- **Forgetting to reference new sub-templates from Root** — a sub-template not referenced (directly or transitively) from Root will never appear in output
- **Using heading levels other than H1/H2/H3** — H1 is the name, H2 is template sections, H3 is content blocks. Deeper headings inside code fences are fine (they're template content, not structure)
- **Omitting code fences** — while the parser can handle bare content, always use `` ```text `` fences for consistency and to avoid ambiguity with markdown formatting in template content
