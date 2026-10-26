'use strict';

// T-010: TC-NFR-PERF-002（固定コンテキスト増加0の5条件）, TC-NFR-SEC-001, TC-NFR-PORT-001, SSOT-DSN-001〜003
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { branchBase } = require('./git-base');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SKILL_DIR = path.join(ROOT, '.claude', 'skills', 'guide');
const EXPLAIN_DIR = path.join(SKILL_DIR, 'explain');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'error-explain-hook.js');
const CLI = path.join(EXPLAIN_DIR, 'cli.js');
const GUIDE = path.join(SKILL_DIR, 'guide.js');
const BASE = branchBase(ROOT);

// 本件で追加した本番コード（JS）
const NEW_JS = [
  ...fs.readdirSync(EXPLAIN_DIR).filter((n) => n.endsWith('.js')).map((n) => path.join(EXPLAIN_DIR, n)),
  GUIDE,
  HOOK,
];
const source = (file) => fs.readFileSync(file, 'utf8');
// コメントを除いたコード（説明文中の語で誤検知しないため）
const code = (file) => source(file).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');

let home;
let temp;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-nfr-home-'));
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-nfr-tmp-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(temp, { recursive: true, force: true });
});

function envWith(extra) {
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp }, extra);
  if (!extra || !('TAISUN_ERROR_EXPLAIN' in extra)) delete env.TAISUN_ERROR_EXPLAIN;
  return env;
}

const EVENT = JSON.stringify({
  hook_event_name: 'PostToolUseFailure', session_id: '', tool_name: 'Bash', is_interrupt: false,
  error: "Error: Cannot find module 'express'\n  code: 'MODULE_NOT_FOUND'",
});

describe('TC-NFR-PERF-002 固定コンテキスト増加0（5条件 AND）', () => {
  (BASE ? test : test.skip)('TC-NFR-PERF-002 (1) 分岐元に対する .claude/CLAUDE.md と .claude/rules/ の差分が0行', () => {
    const diff = execFileSync('git', ['diff', '--numstat', BASE, '--', '.claude/CLAUDE.md', '.claude/rules/'], { cwd: ROOT, encoding: 'utf8' });
    expect(diff.trim()).toBe('');
  });

  test('TC-NFR-PERF-002 (2) /guide は disable-model-invocation: true', () => {
    const front = source(path.join(SKILL_DIR, 'SKILL.md')).split(/^---\r?$/m)[1];
    expect(yaml.load(front)['disable-model-invocation']).toBe(true);
  });

  test('TC-NFR-PERF-002 (3) flag off のとき hook の stdout は空', () => {
    const r = spawnSync(process.execPath, [HOOK], { input: EVENT, env: envWith(), encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  test('TC-NFR-PERF-002 (4) additionalContext は既定 false（flag on でも Claude 向けメモを出さない）', () => {
    const r = spawnSync(process.execPath, [HOOK], { input: EVENT, env: envWith({ TAISUN_ERROR_EXPLAIN: '1' }), encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    expect(out.systemMessage).toBeDefined();
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  test.each(['settings.json', 'settings.normal.json'])('TC-NFR-PERF-002 (5) %s の hook は async にしない', (name) => {
    const entries = JSON.parse(source(path.join(ROOT, '.claude', name))).hooks.PostToolUseFailure;
    for (const e of entries) for (const h of e.hooks) expect(h.async).toBeUndefined();
  });

  test('TC-NFR-PERF-002 npm run context:check と同じ引数で exit 0', () => {
    const [cmd, ...args] = JSON.parse(source(path.join(ROOT, 'package.json'))).scripts['context:check'].split(' ');
    expect(cmd).toBe('node');
    expect(() => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe' })).not.toThrow();
  });
});

describe('TC-NFR-SEC-001 セキュリティ', () => {
  const TOKEN = 'sk-ant-TESTDUMMY-0123456789';

  test.each([
    ['CLI 一致', CLI, ['explain', `Error: ENOSPC: no space left ${TOKEN}`], ''],
    ['CLI 不一致', CLI, ['explain', `odd failure ${TOKEN}`], ''],
    ['CLI --json', CLI, ['explain', '--json', `Error: ENOSPC ${TOKEN}`], ''],
    ['guide エラー文', GUIDE, [`Error: ENOSPC: no space left ${TOKEN}`], ''],
    ['guide 未収録', GUIDE, [`Error: odd failure ${TOKEN}`], ''],
    ['guide 推薦', GUIDE, [`LPを作りたい ${TOKEN}`], ''],
  ])('TC-NFR-SEC-001 %s: 入力中のダミートークンが出力に出ない', (_label, script, args) => {
    const r = spawnSync(process.execPath, [script, ...args], { env: envWith(), encoding: 'utf8', input: '' });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  test('TC-NFR-SEC-001 hook: 原文のトークンが stdout にも状態ファイルにも出ない', () => {
    const event = JSON.stringify(Object.assign(JSON.parse(EVENT), { session_id: 'sec', error: `${JSON.parse(EVENT).error}\n${TOKEN}` }));
    const r = spawnSync(process.execPath, [HOOK], { input: event, env: envWith({ TAISUN_ERROR_EXPLAIN: '1' }), encoding: 'utf8' });
    expect(r.stdout).toContain('systemMessage');
    expect(r.stdout).not.toContain(TOKEN);
    const stateDir = path.join(temp, 'taisun-explain');
    for (const f of fs.readdirSync(stateDir)) expect(source(path.join(stateDir, f))).not.toContain(TOKEN);
  });

  test.each(NEW_JS.map((f) => [path.relative(ROOT, f), f]))('TC-NFR-SEC-001 %s に eval / new Function / child_process が無い（SEC-004・C-BAN-001/101）', (_rel, file) => {
    const c = code(file);
    expect(c).not.toMatch(/\beval\s*\(/);
    expect(c).not.toMatch(/new\s+Function\s*\(/);
    expect(c).not.toMatch(/child_process/);
  });

  test.each(NEW_JS.map((f) => [path.relative(ROOT, f), f]))('C-BAN-102 %s の正規表現リテラルに g フラグが無い', (_rel, file) => {
    expect(code(file)).not.toMatch(/\/[^/\n]+\/[a-z]*g[a-z]*\b(?=\s*[,;).\]}])/);
    expect(code(file)).not.toMatch(/new\s+RegExp\([^)]*,\s*['"`][a-z]*g[a-z]*['"`]\s*\)/);
  });
});

describe('TC-NFR-PORT-001 / SSOT 監査', () => {
  test('TC-NFR-PORT-001 CRLF と LF で同じ結果（子プロセス・標準入力）', () => {
    const lf = "Error: Cannot find module 'express'\n  code: 'MODULE_NOT_FOUND'";
    const run = (text) => spawnSync(process.execPath, [CLI, 'explain', '--json'], { input: text, env: envWith(), encoding: 'utf8' }).stdout;
    expect(run(lf.split('\n').join('\r\n'))).toBe(run(lf));
  });

  test.each(NEW_JS.map((f) => [path.relative(ROOT, f), f]))('SSOT-DSN-002 / TC-NFR-PORT-001 %s に絶対パスのハードコードが無い', (_rel, file) => {
    expect(code(file)).not.toMatch(/[A-Za-z]:\\\\|['"`][A-Za-z]:\/|\/Users\/|\/home\//);
  });

  test.each(NEW_JS.map((f) => [path.relative(ROOT, f), f]))('SSOT-DSN-003 %s にプロジェクト名のハードコードが無い', (_rel, file) => {
    expect(source(file)).not.toContain('sunagent15');
  });

  test.each(NEW_JS.filter((f) => path.basename(f) !== 'constants.js').map((f) => [path.relative(ROOT, f), f]))(
    'SSOT-DSN-001 %s に上限値（600/200/80）の直書きが無い',
    (_rel, file) => {
      expect(code(file)).not.toMatch(/\b(600|200|80)\b/);
    },
  );
});
