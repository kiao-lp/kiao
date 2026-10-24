import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const binDir = dirname(fileURLToPath(import.meta.url));
const realGo = execFileSync(join(binDir, 'find-go.sh'), { encoding: 'utf8' }).trim();
const cleanEnv = { ...process.env, GOTOOLCHAIN: 'local' };
delete cleanEnv.GOROOT;
const realVersion = execFileSync(realGo, ['version'], { env: cleanEnv, encoding: 'utf8' }).trim();
const goVersion = realVersion.match(/^go version go(\S+) /)[1];
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function write(path, content, executable = false) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode: executable ? 0o755 : 0o644 });
}

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'kiao-go-toolchain-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const prefix = join(root, 'local prefix');
    const profile = join(root, 'profile.d/go.sh');
    mkdirSync(dirname(profile), { recursive: true });
    const mockBin = join(root, 'mock-bin');
    const curlLog = join(root, 'curl.log');
    const oldGoLog = join(root, 'old-go.log');
    const installedGo = join(prefix, 'go/bin/go');
    write(join(mockBin, 'go'), '#!/bin/sh\ntouch "$KIAO_TEST_OLD_GO_LOG"\nexit 91\n', true);
    // Force the unprivileged path even when this suite runs as root.
    write(join(mockBin, 'id'), '#!/bin/sh\necho 1000\n', true);
    write(join(mockBin, 'sudo'), '#!/bin/sh\nexec "$@"\n', true);
    write(join(mockBin, 'curl'), '#!/bin/sh\ntouch "$KIAO_TEST_CURL_LOG"\nexit 92\n', true);
    const installer = join(root, 'install-go-toolchain.sh');
    const installerSource = readFileSync(join(binDir, 'install-go-toolchain.sh'), 'utf8');
    // Fail before execution if a refactor would leave real system paths in the fixture.
    assert.ok(installerSource.includes('INSTALL_DIR="/usr/local"'));
    assert.ok(installerSource.includes('PROFILE_FILE="/etc/profile.d/go.sh"'));
    write(installer, installerSource
        .replaceAll('/usr/local', prefix)
        .replaceAll('/etc/profile.d/go.sh', profile), true);
    return {
        root, prefix, profile, mockBin, curlLog, oldGoLog, installedGo, installer,
        env: {
            ...process.env,
            PATH: `${mockBin}:${process.env.PATH}`,
            GOROOT: join(root, 'removed-sdk'),
            GOTOOLCHAIN: 'go0.0.0',
            GO_VERSION: goVersion,
            KIAO_TEST_CURL_LOG: curlLog,
            KIAO_TEST_OLD_GO_LOG: oldGoLog,
        },
    };
}

function installRealGo(f) {
    mkdirSync(dirname(f.installedGo), { recursive: true });
    symlinkSync(realGo, f.installedGo);
}

function run(command, args, env) {
    const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    return result;
}

function success(result) {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, '');
}

function assertNoFile(path) {
    assert.throws(() => statSync(path), { code: 'ENOENT' });
}

function assertProfile(f) {
    // Check the effect of sourcing the profile, including paths containing spaces.
    const result = run('/bin/sh', ['-c', '. "$1"; printf "%s\\n" "${GOROOT-unset}"; command -v go', 'test', f.profile], f.env);
    success(result);
    assert.equal(result.stdout, `unset\n${f.installedGo}\n`);
    assert.equal(statSync(f.profile).mode & 0o777, 0o644);
}

function downloadFixture(f, goScript) {
    const archiveRoot = join(f.root, 'archive');
    const archiveGo = join(archiveRoot, 'go/bin/go');
    mkdirSync(dirname(archiveGo), { recursive: true });
    if (goScript) write(archiveGo, goScript, true);
    else symlinkSync(realGo, archiveGo);
    const archive = join(f.root, 'go.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', archiveRoot, 'go']);
    const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
    write(join(f.mockBin, 'curl'), `#!/bin/sh
echo request >> "$KIAO_TEST_CURL_LOG"
case "$1" in
    -fsSL) echo ${checksum} ;;
    -fSL) cp ${shellQuote(archive)} "$4" ;;
    *) exit 93 ;;
esac
`, true);
}

test('installer defaults to Go 1.27.3 without a version override', (t) => {
    const f = fixture(t);
    delete f.env.GO_VERSION;
    write(f.installedGo, '#!/bin/sh\necho "go version go1.27.3 linux/amd64"\n', true);
    const result = run(f.installer, [], f.env);
    success(result);
    assert.match(result.stdout, /Go 1\.27\.3 is already installed/);
    assertProfile(f);
    assertNoFile(f.curlLog);
    assertNoFile(f.oldGoLog);
});

test('installer reuses real Go with a removed GOROOT and repairs the profile', (t) => {
    const f = fixture(t);
    installRealGo(f);
    write(f.profile, `export GOROOT=${shellQuote(f.env.GOROOT)}\nexport PATH="$PATH:${f.prefix}/go/bin"\n`);
    const result = run(f.installer, [], f.env);
    success(result);
    assert.match(result.stdout, /already installed/);
    assert.ok(result.stdout.includes(`Done: ${realVersion}`));
    assertProfile(f);
    assertNoFile(f.curlLog);
    assertNoFile(f.oldGoLog);

    const previousMtime = statSync(f.profile).mtimeMs;
    success(run(f.installer, [], f.env));
    assert.equal(statSync(f.profile).mtimeMs, previousMtime);
});

test('fresh installation verifies the real Go despite a removed GOROOT', (t) => {
    const f = fixture(t);
    mkdirSync(f.prefix);
    downloadFixture(f);
    const result = run(f.installer, [], f.env);
    success(result);
    assert.match(result.stdout, /Installing to/);
    assert.ok(result.stdout.includes(`Done: ${realVersion}`));
    assert.equal(readFileSync(f.curlLog, 'utf8'), 'request\nrequest\n');
    assertProfile(f);
    assertNoFile(f.oldGoLog);
});

for (const [name, goScript, status] of [
    ['unusable Go', '#!/bin/sh\necho "broken Go" >&2\nexit 42\n', 42],
    ['unexpected Go version', '#!/bin/sh\necho "go version go0.0.1 linux/amd64"\n', 1],
]) {
    test(`installer fails without reporting success for ${name}`, (t) => {
        const f = fixture(t);
        mkdirSync(f.prefix);
        downloadFixture(f, goScript);
        const result = run(f.installer, [], f.env);
        assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
        assert.doesNotMatch(result.stdout, /Done:|Configured/);
        assertNoFile(f.profile);
    });
}

for (const service of ['worker', 'hybridflow-store']) {
    for (const rootState of ['removed', 'existing but unrelated']) {
        test(`${service} builds with real Go when GOROOT is ${rootState}`, (t) => {
            const f = fixture(t);
            installRealGo(f);
            if (rootState === 'existing but unrelated') mkdirSync(f.env.GOROOT);
            const serviceDir = join(f.root, 'project/operation', service);
            const buildScript = join(serviceDir, 'build.sh');
            write(buildScript, readFileSync(join(binDir, '../operation', service, 'build.sh')), true);
            write(join(f.root, 'project/bin/find-go.sh'), readFileSync(join(binDir, 'find-go.sh'), 'utf8')
                .replaceAll('/usr/local/go/bin/go', shellQuote(f.installedGo)), true);
            write(join(serviceDir, 'go.mod'), 'module test/toolchain\n\ngo 1.27.3\n');
            write(join(serviceDir, 'main.go'), 'package main\n\nfunc main() {}\n');
            const output = join(f.root, 'test-binary');
            const result = run(buildScript, [output], { ...f.env, GOWORK: 'off', GOFLAGS: '' });
            success(result);
            assert.ok(result.stdout.includes(realVersion));
            assert.ok(statSync(output).size > 0);
            const compiledVersion = execFileSync(realGo, ['version', output], { env: cleanEnv, encoding: 'utf8' });
            assert.equal(compiledVersion, `${output}: go${goVersion}\n`);
            assertNoFile(f.oldGoLog);
        });
    }
}
