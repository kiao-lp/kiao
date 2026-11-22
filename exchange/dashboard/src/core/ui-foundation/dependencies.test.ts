import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname);
const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx|css)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
});

describe('UI foundation dependencies', () => {
    it('uses its own modules and third-party libraries without application services', () => {
        const violations: string[] = [];
        for (const path of sources(root)) {
            const check = (name: string) => {
                const outside = name.startsWith('.') && relative(root, resolve(dirname(path), name)).startsWith('..');
                if (outside || /^(?:@kiao-dashboard-(?:core|kit)|@\/|src\/|react-concise|react-advanced-interactions|kiao-worker)/.test(name)) {
                    violations.push(`${relative(root, path)} imports ${name}`);
                }
            };
            const text = readFileSync(path, 'utf8');
            if (path.endsWith('.css')) {
                for (const match of text.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)/g)) check(match[1]);
                continue;
            }
            const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
            const inspect = (node: ts.Node) => {
                const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
                    ? node.moduleSpecifier
                    : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
                        ? node.arguments[0] : undefined;
                if (specifier && ts.isStringLiteral(specifier)) {
                    check(specifier.text);
                }
                ts.forEachChild(node, inspect);
            };
            inspect(source);
        }
        expect(violations).toEqual([]);
    });
});
