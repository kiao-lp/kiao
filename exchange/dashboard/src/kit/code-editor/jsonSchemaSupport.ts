import { autocompletion, insertCompletionText, snippet, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import {
    getLanguageService, TextDocument, DiagnosticSeverity, CompletionItemKind, InsertTextFormat,
    type JSONSchema, type JSONDocument,
} from 'vscode-json-languageservice';

export type JsonSchema = JSONSchema | boolean;

export const JSON_SCHEMA_DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
export const JSON_SCHEMA_META_SCHEMA: JsonSchema = { $ref: JSON_SCHEMA_DRAFT_2020_12 };

// LSP snippets escape $, \\ and }; CodeMirror escapes braces and uses ${n} for tab stops.
function codeMirrorSnippet(source: string): string {
    const escapeBraces = (text: string) => text.replace(/[{}]/g, '\\$&');
    const tokens = /\\([\\$}])|\$(\d+)|\$\{(\d+)(?::((?:\\.|[^}\\])*))?\}/g;
    let result = '';
    let end = 0;
    for (const match of source.matchAll(tokens)) {
        result += escapeBraces(source.slice(end, match.index));
        if (match[1]) {
            result += escapeBraces(match[1]);
        } else {
            const value = (match[4] ?? '').replace(/\\([\\$}])/g, '$1');
            const field = /[{}]/.test(value)
                ? escapeBraces(value) : (match[2] ?? match[3]) + ':' + value;
            result += '${' + field + '}';
        }
        end = match.index! + match[0].length;
    }
    return result + escapeBraces(source.slice(end));
}

export function createJsonSchemaSupport(schema?: JsonSchema) {
    const service = getLanguageService({
        clientCapabilities: {
            textDocument: { completion: { completionItem: { documentationFormat: ['plaintext'] } } },
        },
    });
    const schemaObject = typeof schema === 'boolean' ? (schema ? {} : { not: {} }) : schema;
    service.configure({
        validate: true,
        allowComments: false,
        schemas: schemaObject === undefined ? [] : [{
            uri: 'inmemory://kiao/editor.schema.json',
            fileMatch: ['*'],
            schema: schemaObject,
        }],
    });

    // Each editor owns its schema service and caches only snapshots still held by CodeMirror.
    const snapshots = new WeakMap<EditorState, { document: TextDocument; parsed: JSONDocument }>();
    const snapshot = (state: EditorState) => {
        let cached = snapshots.get(state);
        if (!cached) {
            const document = TextDocument.create('inmemory://kiao/document.json', 'json', 0, state.doc.toString());
            cached = { document, parsed: service.parseJSONDocument(document) };
            snapshots.set(state, cached);
        }
        return cached;
    };

    const validate = async (state: EditorState): Promise<Diagnostic[]> => {
        const { document, parsed } = snapshot(state);
        const diagnostics = await service.doValidation(document, parsed, {
            comments: 'error', trailingCommas: 'error', schemaValidation: 'error',
        });
        return diagnostics.map(diagnostic => ({
            from: document.offsetAt(diagnostic.range.start),
            to: document.offsetAt(diagnostic.range.end),
            severity: diagnostic.severity === DiagnosticSeverity.Error ? 'error'
                : diagnostic.severity === DiagnosticSeverity.Warning ? 'warning' : 'info',
            message: diagnostic.message,
            source: 'JSON',
        }));
    };

    const complete: CompletionSource = async context => {
        const { document, parsed } = snapshot(context.state);
        const result = await service.doComplete(document, document.positionAt(context.pos), parsed);
        if (context.aborted || !result?.items.length) return null;
        const edit = result.items[0].textEdit;
        if (!edit || !('range' in edit)) return null;

        return {
            from: document.offsetAt(edit.range.start),
            to: context.pos,
            options: result.items.map((item): Completion => {
                const text = item.textEdit?.newText ?? item.insertText ?? item.label;
                const trailingLength = document.offsetAt(edit.range.end) - context.pos;
                const apply = item.insertTextFormat === InsertTextFormat.Snippet ? snippet(codeMirrorSnippet(text)) : undefined;
                return {
                    label: item.filterText ?? item.label,
                    displayLabel: item.label,
                    type: item.kind === CompletionItemKind.Property ? 'property' : 'constant',
                    detail: item.detail,
                    info: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
                    // Filter only the prefix, then replace the rest of the LSP edit range on acceptance.
                    apply: (view, completion, from, to) => {
                        if (apply) apply(view, completion, from, to + trailingLength);
                        else view.dispatch(insertCompletionText(view.state, text, from, to + trailingLength));
                    },
                };
            }),
        };
    };

    return { validate, complete };
}

/** JSON syntax and schema assistance, scoped to one editor. Requires the JSON language. */
export function jsonSchemaExtensions(schema?: JsonSchema): Extension[] {
    const support = createJsonSchemaSupport(schema);
    return [
        linter(view => support.validate(view.state), { delay: 300 }),
        lintGutter(),
        autocompletion({ override: [support.complete] }),
    ];
}
