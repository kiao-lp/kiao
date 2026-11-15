# Prompt

## Root

### textTemplate

```text
${title}

${instructions}
```

## Title

### defaultText

```text

```

### textTemplate

```text
## ${commitType:"fix"|"feat"|"refactor"|"chore"}(${scope:KiaoComponent}): ${message:text}
```

## Instructions

### defaultText

```text

```

### textTemplate

```text


In ${scope:KiaoComponent.path}, ${main:text}
${hotReloading}
${migrationScript}
${testInstructions}
${commit}
```

## Hot reloading

### defaultText

```text

```

### textTemplate

```text

Because there is hot-reloading, the changes you'll do will automatically be refelect.
```

## Migration script

### defaultText

```text

```

### textTemplate

```text

Also create a migration script copying migrations/migration-template.js to fix the existing documents. This is a one-shot script that will convert them all and I will run it manually before testing.
```

## Test instructions

### defaultText

```text

```

### textTemplate

```text

Tests from your part should include (among others you might consider useful):

${compilationTests}
${e2eTests}
```

## E2e tests

### defaultText

```text

```

### textTemplate

```text
- running the E2E tests and check that they all pass.
```

## Compilation tests

### defaultText

```text

```

### textTemplate

```text
- ensure that all involved projects compile.
```

## Commit

### defaultText

```text

```

### textTemplate

```text

If everything is OK, create a commit using the title of this prompt (after "## ")
```
