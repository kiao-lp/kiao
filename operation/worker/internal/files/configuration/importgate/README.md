# The import gate — what makes a passage of a document light up

Every file in this folder is one **category** of sensitive information, and every category holds a
list of **matchers**: regular expressions run over the text of a document while an upload is being
reviewed. What they find is highlighted in the reader, coloured by how bad it would be, and the
navigator over it steps from one finding to the next.

They run over **every text being imported** — the conversion of a PDF, a mail or a spreadsheet, and
also the `.md`, `.csv`, `.json` and `.txt` files that need no conversion to be read. A Markdown
document is shown as a document rather than as its source; the matchers still read the source, which
is the file that will land in the store.

Beside the two step buttons is a third, which **obfuscates** the finding the navigator is on: it
becomes `[...]` in the file that gets imported. Redacting a `.md` or a `.txt` edits the file itself;
redacting a PDF's index edits the index, and the PDF still holds the passage — *Import as text*,
which imports the index in the document's place, is the answer when it must not.

The gate reads nothing but this folder. A file dropped in here is in force at the next upload; a
file deleted from here is gone, and nothing puts it back.

## One file, one category

```json
{
  "category": "secrets",
  "label": "Credentials, keys and certificates",
  "description": "Why this category is worth a reader's attention.",
  "criticality": "critical",
  "matchers": [
    {
      "label": "Private key block",
      "pattern": "-----BEGIN (?:RSA )?PRIVATE KEY-----",
      "caseSensitive": true,
      "criticality": "critical",
      "hint": "Shown beside the finding in the navigator."
    }
  ]
}
```

| Field | Where | Meaning |
|---|---|---|
| `category` | file | Its identity. Defaults to the file name. |
| `label` | file | What the category is called in the navigator. |
| `description` | file | Free text, for whoever edits this file. Never displayed. |
| `criticality` | file, matcher | `critical`, `high`, `medium` or `low`. A matcher inherits the file's. |
| `enabled` | file, matcher | `false` switches it off without deleting it. Default `true`. |
| `label` | matcher | What the finding is called. Required. |
| `pattern` | matcher | A JavaScript regular expression, as source. Required. |
| `caseSensitive` | matcher | Default `false` — the pattern is matched case-insensitively. |
| `hint` | matcher | One line on what to do about it, shown with the finding. |

`pattern` is JSON, so every backslash is doubled: `\bSIRET\b` is written `"\\bSIRET\\b"`.

## Criticality is a judgement about consequence

- **critical** — acting on it cannot wait, and importing the file is rarely the right answer: a
  live credential, a state classification marking, health data.
- **high** — confidential, and a real disclosure if it lands somewhere shared: personal
  identifiers, salaries, internal network addresses.
- **medium** — sensitive in context. Worth a look before importing.
- **low** — worth pointing at, not worth stopping for.

The level travels with the *matcher*, not the category, so a category can carry findings of
several levels — `identity` treats an email address as medium and a social security number as
critical.

## These matchers are heuristics

They are tuned to **find rather than to be right**: a review the reader dismisses in two seconds
costs nothing, and a secret nobody was shown costs a rotation. Expect false positives, and expect
the gate to miss things — a scanned page nobody could convert has no text to search, and a matcher
only knows the shapes it was given.

The categories bundled with KIAO are a starting point. Narrow one that is too noisy for your
documents, switch it off with `"enabled": false`, or drop a file of your own beside them.
