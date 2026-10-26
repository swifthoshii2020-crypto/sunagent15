'use strict';

// T-008: FR-HOOK-001〜005, FR-CFG-001, NFR-REL-001, NFR-PERF-001（error-explain-hook.js）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'error-explain-hook.js');
const { run } = require(HOOK);
const { LIMITS, configPath } = require(path.join(ROOT, '.claude', 'skills', 'guide', 'explain', 'constants.js'));

const PS_POLICY = 'npm : File C:\\Program Files\\nodejs\\npm.ps1 cannot be loaded because running scripts is disabled on this system.';
const MODULE_ERR = "Exit code 1\nnode:internal/modules/cjs/loader:1228\n[12000 characters truncated]\nError: Cannot find module 'express'\n  code: 'MODULE_NOT_FOUND'";
const CMD_NOT_FOUND = "'nodee' is not recognized as an internal or external command,"; // hook:false のエントリ

let tmp;
let home;
let tmpDir;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-hook-'));
  home = path.join(tmp, 'home');
  tmpDir = path.join(tmp, 'tmp');
  fs.mkdirSync(home);
  fs.mkdirSync(tmpDir);
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function event(overrides) {
  return Object.assign({
    hook_event_name: 'PostToolUseFailure',
    session_id: 'sess-1',
    tool_name: 'Bash',
    tool_input: { command: 'npm run setup' },
    error: PS_POLICY,
    is_interrupt: false,
  }, overrides);
}

function stream(text) {
  return Readable.from(text === '' ? [] : [Buffer.from(text, 'utf8')]);
}

function hook(input, opts) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return run(Object.assign({ stdin: stream(text), env: { TAISUN_ERROR_EXPLAIN: '1' }, homeDir: home, tmpDir }, opts));
}

function writeConfig(obj) {
  fs.mkdirSync(path.dirname(configPath(home)), { recursive: true });
  fs.writeFileSync(configPath(home), JSON.stringify(obj));
}

describe('TC-FR-HOOK-001 有効時の表示', () => {
  test.each(['Bash', 'PowerShell'])('TC-FR-HOOK-001 tool_name=%s で hook:true に一致すれば systemMessage（600字以内）', async (tool) => {
    const r = await hook(event({ tool_name: tool }));
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.systemMessage.length).toBeLessThanOrEqual(LIMITS.SYSTEM_MESSAGE_MAX);
    expect(out.systemMessage).toContain('説明ID: WIN-PS-POLICY');
    expect(out.systemMessage).toContain('Claude に「npm の代わりに npm.cmd で実行して」と頼んでください。');
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  test('TC-FR-HOOK-001 公式形式（先頭 Exit code・[N characters truncated]）の error でも一致', async () => {
    const out = JSON.parse((await hook(event({ error: MODULE_ERR }))).stdout);
    expect(out.systemMessage).toContain('説明ID: NODE-MODULE-NOT-FOUND');
  });

  test('TC-FR-HOOK-001 hook:false のエントリや不一致は何も出さない', async () => {
    expect((await hook(event({ error: CMD_NOT_FOUND }))).stdout).toBe('');
    expect((await hook(event({ error: 'something unrelated' }))).stdout).toBe('');
  });

  test('NFR-SEC-001 エラー原文（トークン・パス）を出力しない', async () => {
    const r = await hook(event({ error: `${PS_POLICY}\nC:\\Users\\taro sk-ant-TESTDUMMY` }));
    expect(r.stdout).not.toContain('sk-ant-TESTDUMMY');
    expect(r.stdout).not.toContain('taro');
  });
});

describe('TC-FR-HOOK-002 / TC-FR-CFG-001 既定では何もしない', () => {
  test('TC-FR-HOOK-002 環境変数も設定ファイルも無ければ stdout 空・exit 0', async () => {
    const r = await hook(event(), { env: {} });
    expect(r).toEqual({ exitCode: 0, stdout: '' });
  });

  test('TC-FR-CFG-001 hint on の設定ファイルだけでも有効になり、環境変数 0 が優先される', async () => {
    writeConfig({ enabled: true });
    expect((await hook(event(), { env: {} })).stdout).not.toBe('');
    expect((await hook(event({ session_id: 'sess-2' }), { env: { TAISUN_ERROR_EXPLAIN: '0' } })).stdout).toBe('');
  });
});

describe('TC-FR-HOOK-003 / NFR-REL-001 fail-open', () => {
  const big = JSON.stringify(event({ error: 'x'.repeat(LIMITS.STDIN_MAX_BYTES + 10) }));
  test.each([
    ['壊れた JSON', '{not json'],
    ['空', ''],
    ['1MB 超', big],
    ['null', 'null'],
    ['配列', '[]'],
    ['文字列', '"text"'],
    ['is_interrupt=true', JSON.stringify(event({ is_interrupt: true }))],
    ['tool_name が Bash/PowerShell 以外', JSON.stringify(event({ tool_name: 'Edit' }))],
    ['error が文字列でない', JSON.stringify(event({ error: 123 }))],
    ['error なし', JSON.stringify(event({ error: undefined }))],
  ])('TC-FR-HOOK-003 %s → stdout 空・exit 0', async (_label, input) => {
    expect(await hook(input)).toEqual({ exitCode: 0, stdout: '' });
  });

  test('TC-FR-HOOK-003 カタログ破損でも stdout 空・exit 0', async () => {
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{not json');
    expect(await hook(event(), { catalogPath: bad })).toEqual({ exitCode: 0, stdout: '' });
  });

  test('TC-FR-HOOK-003 標準入力のストリームが壊れても stdout 空・exit 0', async () => {
    const s = new Readable({ read() { this.destroy(new Error('boom')); } });
    expect(await run({ stdin: s, env: { TAISUN_ERROR_EXPLAIN: '1' }, homeDir: home, tmpDir })).toEqual({ exitCode: 0, stdout: '' });
  });

  test('TC-FR-HOOK-003 終わらない標準入力は時間で打ち切る', async () => {
    const s = new Readable({ read() {} });
    const started = Date.now();
    const r = await run({ stdin: s, env: { TAISUN_ERROR_EXPLAIN: '1' }, homeDir: home, tmpDir, stdinTimeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r).toEqual({ exitCode: 0, stdout: '' });
    s.destroy();
  });
});

describe('TC-FR-HOOK-004 連発抑止', () => {
  test('TC-FR-HOOK-004 同じ session・同じエントリの2回目は出さず、別 session は出す', async () => {
    expect((await hook(event())).stdout).not.toBe('');
    expect((await hook(event())).stdout).toBe('');
    expect((await hook(event({ session_id: 'sess-other' }))).stdout).not.toBe('');
  });

  test('TC-FR-HOOK-004 同じ session でも別エントリなら出す', async () => {
    await hook(event());
    expect((await hook(event({ error: MODULE_ERR }))).stdout).not.toBe('');
  });

  test('TC-FR-HOOK-004 状態を書けなければ抑止せず表示する', async () => {
    const notDir = path.join(tmp, 'not-a-dir');
    fs.writeFileSync(notDir, 'x');
    expect((await hook(event(), { tmpDir: notDir })).stdout).not.toBe('');
    expect((await hook(event(), { tmpDir: notDir })).stdout).not.toBe('');
  });

  test('TC-FR-HOOK-004 session_id が空・記号だけなら抑止しない', async () => {
    for (const sid of ['', '../../', undefined]) {
      expect((await hook(event({ session_id: sid }))).stdout).not.toBe('');
      expect((await hook(event({ session_id: sid }))).stdout).not.toBe('');
    }
  });

  test('TC-FR-HOOK-004 状態ファイルは一時ディレクトリの taisun-explain/ に ID だけを記録し、24時間超は無視する', async () => {
    await hook(event({ session_id: 'abc/../DEF-1' }));
    const file = path.join(tmpDir, 'taisun-explain', 'abcDEF1.json');
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(state.shown).toEqual(['WIN-PS-POLICY']);
    expect(JSON.stringify(state)).not.toContain('npm.ps1');
    state.updatedAt = Date.now() - LIMITS.DEDUP_TTL_MS - 1000;
    fs.writeFileSync(file, JSON.stringify(state));
    expect((await hook(event({ session_id: 'abc/../DEF-1' }))).stdout).not.toBe('');
  });
});

describe('TC-FR-HOOK-005 Claude 向け1行メモ', () => {
  test('TC-FR-HOOK-005 additionalContext=true なら200字以内の1行を追加', async () => {
    writeConfig({ additionalContext: true });
    const out = JSON.parse((await hook(event())).stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUseFailure');
    expect(out.hookSpecificOutput.additionalContext).toContain('WIN-PS-POLICY');
    expect(out.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(LIMITS.ADDITIONAL_CONTEXT_MAX);
    expect(out.hookSpecificOutput.additionalContext).not.toContain('\n');
  });
});

describe('ADR-006 settings への登録', () => {
  const EXPECTED = {
    matcher: 'Bash|PowerShell',
    hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/error-explain-hook.js'], timeout: 5 }],
  };

  test.each(['settings.json', 'settings.normal.json'])('ADR-006 %s は PostToolUseFailure 1エントリだけを追加し、他は変えない', (name) => {
    const rel = `.claude/${name}`;
    const now = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const base = JSON.parse(execFileSync('git', ['show', `e8e6a89:${rel}`], { cwd: ROOT, encoding: 'utf8' }));
    expect(now.hooks.PostToolUseFailure).toEqual([EXPECTED]);
    const rest = JSON.parse(JSON.stringify(now));
    delete rest.hooks.PostToolUseFailure;
    expect(rest).toEqual(base);
  });
});

describe('TC-NFR-PERF-001 性能', () => {
  test('TC-NFR-PERF-001 hook を子プロセスで100回起動して p95 が目標以内', () => {
    const input = JSON.stringify(event({ session_id: '' }));
    const env = Object.assign({}, process.env, { TAISUN_ERROR_EXPLAIN: '1', TEMP: tmpDir, TMP: tmpDir, TMPDIR: tmpDir, HOME: home, USERPROFILE: home });
    const times = [];
    for (let i = 0; i < 100; i += 1) {
      const start = process.hrtime.bigint();
      const r = spawnSync(process.execPath, [HOOK], { input, env, encoding: 'utf8' });
      times.push(Number(process.hrtime.bigint() - start) / 1e6);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).systemMessage).toContain('説明ID: WIN-PS-POLICY');
    }
    times.sort((a, b) => a - b);
    const p95 = times[94];
    console.log(`TC-NFR-PERF-001 hook p95=${p95.toFixed(1)}ms median=${times[49].toFixed(1)}ms`);
    expect(p95).toBeLessThan(process.env.CI ? 900 : 300);
  }, 60000);
});
