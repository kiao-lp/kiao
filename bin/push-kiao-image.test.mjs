import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const binDir = dirname(fileURLToPath(import.meta.url));
const script = join(binDir, 'push-kiao-image.sh');
const repository = 'ghcr.io/example/kiao';
const imageId = `sha256:${'a'.repeat(64)}`;

function write(path, content, executable = false) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode: executable ? 0o755 : 0o644 });
}

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'kiao-image-push-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const mockBin = join(root, 'mock-bin');
    const log = join(root, 'docker.jsonl');
    write(join(mockBin, 'docker'), `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.KIAO_TEST_DOCKER_LOG, JSON.stringify(args) + '\\n');
const command = args.slice(0, 2).join(' ');
if (command === 'image inspect') {
    if (process.env.KIAO_TEST_MISSING_IMAGE) process.exit(1);
    console.log('${imageId}');
} else if (command === 'image tag') {
    if (args.at(-1) === process.env.KIAO_TEST_FAIL_TAG) process.exit(18);
} else if (command === 'image push') {
    if (args.at(-1) === process.env.KIAO_TEST_FAIL_PUSH) process.exit(19);
} else if (command === 'image ls') {
    console.log('123MB');
} else if (args[0] !== 'build') {
    console.error('Unexpected Docker command:', args);
    process.exit(99);
}
`, true);
    return {
        root,
        mockBin,
        env: { ...process.env, PATH: `${mockBin}:${process.env.PATH}`, KIAO_TEST_DOCKER_LOG: log },
        calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [],
    };
}

function run(f, args, command = script) {
    const result = spawnSync('/bin/bash', [command, ...args], {
        cwd: f.root,
        env: f.env,
        encoding: 'utf8',
        timeout: 10_000,
    });
    assert.ifError(result.error);
    return result;
}

function success(result) {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('help succeeds without contacting Docker', (t) => {
    const f = fixture(t);
    const result = run(f, ['--help']);
    success(result);
    assert.match(result.stdout, /Usage:/);
    assert.deepEqual(f.calls(), []);
});

test('publishes the existing default image as latest from any working directory', (t) => {
    const f = fixture(t);
    const result = run(f, ['--repository', repository]);
    success(result);
    assert.deepEqual(f.calls(), [
        ['image', 'inspect', '--format', '{{.Id}}', 'kiao:latest'],
        ['image', 'tag', imageId, `${repository}:latest`],
        ['image', 'push', `${repository}:latest`],
    ]);
});

test('publishes several tags from one resolved custom image', (t) => {
    const f = fixture(t);
    success(run(f, ['--repository', repository, '--image', 'kiao:release', '--tag', 'v1.0.0', '--tag', 'latest']));
    assert.deepEqual(f.calls(), [
        ['image', 'inspect', '--format', '{{.Id}}', 'kiao:release'],
        ['image', 'tag', imageId, `${repository}:v1.0.0`],
        ['image', 'tag', imageId, `${repository}:latest`],
        ['image', 'push', `${repository}:v1.0.0`],
        ['image', 'push', `${repository}:latest`],
    ]);
});

for (const args of [
    [],
    ['--repository'],
    ['--repository', ''],
    ['--repository', '--tag', 'latest'],
    ['--repository', 'https://ghcr.io/example/kiao'],
    ['--repository', 'ghcr.io/Example/kiao'],
    ['--repository', `${repository}:latest`],
    ['--repository', repository, '--tag', 'valid', '--tag', 'invalid/tag'],
    ['--repository', repository, '--tag', 'a'.repeat(129)],
    ['--repository', repository, '--image'],
    ['--repository', repository, '--unknown'],
]) {
    test(`rejects invalid arguments before contacting Docker: ${JSON.stringify(args)}`, (t) => {
        const f = fixture(t);
        assert.equal(run(f, args).status, 1);
        assert.deepEqual(f.calls(), []);
    });
}

test('does not tag or push when the source image is unavailable', (t) => {
    const f = fixture(t);
    f.env.KIAO_TEST_MISSING_IMAGE = '1';
    const result = run(f, ['--repository', repository]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /build or load the image first/);
    assert.equal(f.calls().length, 1);
});

test('does not push any tag when local tagging fails', (t) => {
    const f = fixture(t);
    f.env.KIAO_TEST_FAIL_TAG = `${repository}:latest`;
    assert.equal(run(f, ['--repository', repository, '--tag', 'v1.0.0', '--tag', 'latest']).status, 18);
    assert.ok(f.calls().every((args) => args[1] !== 'push'));
});

test('propagates a failed push and stops subsequent pushes', (t) => {
    const f = fixture(t);
    f.env.KIAO_TEST_FAIL_PUSH = `${repository}:v1.0.0`;
    const result = run(f, ['--repository', repository, '--tag', 'v1.0.0', '--tag', 'latest']);
    assert.equal(result.status, 19);
    assert.deepEqual(f.calls().filter((args) => args[1] === 'push'), [
        ['image', 'push', `${repository}:v1.0.0`],
    ]);
    assert.doesNotMatch(result.stdout, /Published /);
});

test('the root wrapper forwards arguments from another working directory', (t) => {
    const f = fixture(t);
    const wrapper = join(binDir, '../../bin/pub-push-kiao-image.sh');
    if (!existsSync(wrapper)) {
        t.skip('the standalone public checkout has no root wrapper');
        return;
    }
    success(run(f, ['--repository', repository, '--tag', 'v1.0.0'], wrapper));
    assert.deepEqual(f.calls().at(-1), ['image', 'push', `${repository}:v1.0.0`]);
});

test('--skip-save succeeds on a fresh image build without an archive', (t) => {
    const f = fixture(t);
    const project = join(f.root, 'project');
    const buildScript = join(project, 'bin/build-kiao-image.sh');
    write(buildScript, readFileSync(join(binDir, 'build-kiao-image.sh')));
    write(join(project, 'bin/require-build-all.sh'), readFileSync(join(binDir, 'require-build-all.sh')), true);
    for (const dir of ['reference/kiao-mcp/dist', 'exchange/dashboard/node_modules']) {
        mkdirSync(join(project, dir), { recursive: true });
    }
    for (const path of [
        'operation/worker/worker',
        'operation/hybridflow-store/hybridflow-store',
        'operation/worker/internal/toolbox/catalog/pub.json',
        'operation/worker/internal/toolbox/install/pi/kiao-node-check.cjs',
        'dist/kiao-mcp/dist/index.js',
        'e2e/data/files-template/example.md',
        'bin/docker/kiao-image/Dockerfile',
        'bin/docker/kiao-image/docker-entrypoint.sh',
        'bin/docker/kiao-image/kiao.conf.template',
        'bin/docker/kiao-image/kiao-dev.sh',
        'bin/docker/kiao-image/apt-hint.sh',
        'bin/docker/kiao-image/apk-nudge.sh',
        'bin/docker/kiao-image/claude-container-memory.md',
    ]) write(join(project, path), 'fixture');
    write(join(f.mockBin, 'npm'), '#!/bin/sh\nmkdir -p build\necho fixture > build/index.html\n', true);
    write(join(f.mockBin, 'node'), '#!/bin/sh\nmkdir -p "$3"\n', true);

    success(run(f, ['--skip-save'], buildScript));
    assert.ok(existsSync(join(project, 'dist/kiao-image/Dockerfile')));
    assert.ok(!existsSync(join(project, 'dist/kiao-image.tar.gz')));
    assert.ok(f.calls().some((args) => args[0] === 'build'));
    assert.ok(f.calls().every((args) => args[0] !== 'save'));
});
