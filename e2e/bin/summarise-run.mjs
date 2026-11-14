/**
 * The e2e run, in as many lines as there were failures.
 *
 * Playwright's own reporters are written for a terminal someone is watching: the passes scroll by
 * and the failures are read as they land. Read afterwards through a tool result or a CI log, that
 * shape is wrong — the interesting part is at the bottom of thousands of lines and is the first
 * thing a truncated output loses. This prints the counts and then the failures alone, so what gets
 * read is bounded by how much went wrong rather than by how much was run.
 *
 * It also copes with a half-written report: `bin/run-tests.sh` calls it after a run that may have
 * been cut short by its budget, and a partial `results.json` still names the specs that had
 * finished. Anything missing is reported as missing rather than assumed to have passed.
 */
import { readFileSync } from 'node:fs';

const MAX_FAILURES_SHOWN = 15;
const MAX_ERROR_LINES = 6;

const report = JSON.parse(readFileSync(process.argv[2], 'utf-8'));

/** Every spec in the report, whatever the nesting of file -> describe -> describe. */
function* specs(suite, file = suite.file) {
    for (const spec of suite.specs ?? []) yield { ...spec, file: spec.file ?? file };
    for (const child of suite.suites ?? []) yield* specs(child, child.file ?? file);
}

const all = [...(report.suites ?? [])].flatMap(suite => [...specs(suite)]);
const failed = all.filter(spec => !spec.ok);

const stats = report.stats ?? {};
const counts = [
    `${stats.expected ?? all.filter(s => s.ok).length} passed`,
    `${stats.unexpected ?? failed.length} failed`,
    stats.flaky ? `${stats.flaky} flaky` : null,
    `${stats.skipped ?? 0} skipped`,
].filter(Boolean).join(', ');

const seconds = stats.duration ? ` in ${Math.round(stats.duration / 1000)}s` : '';
console.log(`[e2e] ${counts}${seconds} — ${all.length} specs reported`);

/* Errors Playwright raises outside any test: a web server that never came up, a config that would
 * not load. They are why a run can report zero failures and still have tested nothing. */
for (const error of report.errors ?? []) {
    const message = (error.message ?? String(error)).trim().split('\n').slice(0, MAX_ERROR_LINES).join('\n');
    console.log(`\n[e2e] run-level error:\n${message}`);
}

for (const spec of failed.slice(0, MAX_FAILURES_SHOWN)) {
    const result = spec.tests?.[0]?.results?.at(-1) ?? {};
    const status = result.status ?? spec.tests?.[0]?.status ?? 'unknown';
    console.log(`\nFAILED ${spec.file}:${spec.line} > ${spec.title}  [${status}]`);
    const raw = result.error?.message ?? result.errors?.[0]?.message ?? '';
    const message = raw.replace(/\[[0-9;]*m/g, '').trim();
    if (message) console.log(message.split('\n').slice(0, MAX_ERROR_LINES).map(line => `    ${line}`).join('\n'));
}

if (failed.length > MAX_FAILURES_SHOWN) {
    console.log(`\n[e2e] ...and ${failed.length - MAX_FAILURES_SHOWN} more failures — see the html report.`);
}
