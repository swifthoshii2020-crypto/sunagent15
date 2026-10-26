'use strict';

// T-010: E2E-01〜08（docs/E2E_SCENARIOS.md）。すべて子プロセスで実行し、
// HOME/USERPROFILE と TEMP/TMP/TMPDIR は一時ディレクトリに差し替える（REV-R2-016）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(ROOT, '.claude', 'skills', 'guide', 'explain', 'cli.js');
const GUIDE = path.join(ROOT, '.claude', 'skills', 'guide', 'guide.js');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'error-explain-hook.js');
const guideCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'guide', 'guide-catalog.json'), 'utf8'));

let tmp;
let env;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-e2e-'));
  const home = path.join(tmp, 'home');
  const temp = path.join(tmp, 'temp');
  fs.mkdirSync(home);
  fs.mkdirSync(temp);
  env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp });
  delete env.TAISUN_ERROR_EXPLAIN;
  delete env.CLAUDE_PROJECT_DIR;
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function node(script, args, opts) {
  const o = Object.assign({ input: '' }, opts);
  const started = Date.now();
  const r = spawnSync(process.execPath, [script, ...args], { input: o.input, env: o.env || env, cwd: o.cwd || tmp, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started };
}

function hookEvent(error, overrides) {
  return JSON.stringify(Object.assign({
    hook_event_name: 'PostToolUseFailure', session_id: 'e2e', tool_name: 'Bash',
    tool_input: { command: 'x' }, error, is_interrupt: false,
  }, overrides));
}

const MODULE_TAIL = "\nError: Cannot find module 'express'\n  code: 'MODULE_NOT_FOUND'";

describe('E2E-01（正常系1）PowerShell 実行ポリシーを日本語で説明（CLI・stdin）', () => {
  test('E2E-01 3部構成・コピー用 npm.cmd・説明ID と締め・危険な表現なし・exit 0', () => {
    const ja = 'npm : このシステムではスクリプトの実行が無効になっているため、ファイル C:\\Program Files\\nodejs\\npm.ps1 を読み込むことができません。\n'
      + '    + CategoryInfo          : セキュリティ エラー: (: ) []、PSSecurityException\n    + FullyQualifiedErrorId : UnauthorizedAccess';
    const r = node(CLI, ['explain'], { input: ja });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/【何が起きた】/);
    expect(r.stdout).toMatch(/【次にやること】\n {2}1\. /);
    expect(r.stdout).toMatch(/【コピー用】.*npm\.cmd/);
    expect(r.stdout).toContain('【用語】');
    expect(r.stdout).toContain('（説明ID: WIN-PS-POLICY）違うときは、この説明IDを添えて Claude に相談してください。');
    const step1 = r.stdout.split('\n').find((l) => l.startsWith('  1. '));
    expect(step1).not.toMatch(/Set-ExecutionPolicy/i);
    expect(r.stdout).not.toMatch(/unrestricted|bypass/i);
  });
});

describe('E2E-02（正常系2・最小）/guide を引数なしで実行', () => {
  test.each([[['--menu']], [[]]])('E2E-02 guide.js %p で6分野と入力例・1,200字以内・exit 0', (args) => {
    const r = node(GUIDE, args);
    expect(r.status).toBe(0);
    for (const c of guideCatalog.categories) {
      expect(r.stdout).toContain(c.label);
      expect(r.stdout).toContain(c.example);
    }
    expect(r.stdout.length).toBeLessThanOrEqual(1200);
  });
});

describe('E2E-03（正常系3・最大）hook 有効時に巨大エラーから説明', () => {
  test('E2E-03 19,900字のノイズ＋末尾 MODULE_NOT_FOUND で hook 向け説明・原文なし・1秒以内', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'guide', 'explain', 'error-catalog.json'), 'utf8'));
    expect(catalog.entries.find((e) => e.id === 'NODE-MODULE-NOT-FOUND').hook).toBe(true);
    const error = 'x'.repeat(19900) + MODULE_TAIL;
    const r = node(HOOK, [], { input: hookEvent(error, { session_id: 'e2e-03' }), env: Object.assign({}, env, { TAISUN_ERROR_EXPLAIN: '1' }) });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.systemMessage.length).toBeLessThanOrEqual(600);
    expect(out.systemMessage).toContain('説明ID: NODE-MODULE-NOT-FOUND');
    expect(out.systemMessage).toContain('Claude に「足りない部品を入れて、もう一度試して」と頼んでください。');
    expect(r.stdout).not.toContain('express');
    expect(r.ms).toBeLessThan(1000);
  }, 10000);
});

describe('E2E-04（異常系1・依存障害）カタログ破損でもセッションを止めない', () => {
  test('E2E-04 複製先でカタログを壊すと hook は無出力 exit 0、CLI は stderr 1行 exit 1', () => {
    const copy = path.join(tmp, 'copy');
    fs.cpSync(path.join(ROOT, '.claude', 'hooks', 'error-explain-hook.js'), path.join(copy, '.claude', 'hooks', 'error-explain-hook.js'));
    fs.cpSync(path.join(ROOT, '.claude', 'skills', 'guide', 'explain'), path.join(copy, '.claude', 'skills', 'guide', 'explain'), { recursive: true });
    fs.writeFileSync(path.join(copy, '.claude', 'skills', 'guide', 'explain', 'error-catalog.json'), '{broken');
    const hook = node(path.join(copy, '.claude', 'hooks', 'error-explain-hook.js'), [], {
      input: hookEvent('Error: ENOSPC: no space left on device'), env: Object.assign({}, env, { TAISUN_ERROR_EXPLAIN: '1' }),
    });
    expect(hook.status).toBe(0);
    expect(hook.stdout).toBe('');
    const cli = node(path.join(copy, '.claude', 'skills', 'guide', 'explain', 'cli.js'), ['explain', 'ENOSPC']);
    expect(cli.status).toBe(1);
    expect(cli.stderr.trim().split('\n')).toHaveLength(1);
  }, 10000);
});

describe('E2E-05（異常系2・不正入力）', () => {
  test('E2E-05 (a) CLI 入力なし → 使い方 exit 2', () => {
    const r = node(CLI, ['explain']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('使い方');
  });

  test('E2E-05 (b) --file に存在しないパス → 使い方 exit 2', () => {
    const r = node(CLI, ['explain', '--file', path.join(tmp, 'none.txt')]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('使い方');
  });

  test('E2E-05 (c) hook に壊れた JSON → 無出力 exit 0', () => {
    const r = node(HOOK, [], { input: '{not json', env: Object.assign({}, env, { TAISUN_ERROR_EXPLAIN: '1' }) });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('E2E-06（境界値）入力長の上限ぴったり/超過', () => {
  const ENOSPC_AT = (len) => ' '.repeat(9997) + 'ENOSPC' + ' '.repeat(len - 9997 - 6);

  test('E2E-06 (a) 500字ちょうど（末尾 LP）は LP 関連を推薦', () => {
    const r = node(GUIDE, ['あ'.repeat(498) + 'LP']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('/lp-full-generation');
  });

  test('E2E-06 (b) 501字（切り詰めで L のみ）は一致せずメニュー', () => {
    const r = node(GUIDE, ['あ'.repeat(499) + 'LP']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ぴったりの候補が見つかりませんでした。');
  });

  test('E2E-06 (c) 20,000字ちょうどは DISK-FULL に一致', () => {
    const r = node(CLI, ['explain', '--json', ENOSPC_AT(20000)]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).id).toBe('DISK-FULL');
  });

  test('E2E-06 (d) 20,001字は先頭/末尾の切り出しで分断され不一致', () => {
    const r = node(CLI, ['explain', '--json', ENOSPC_AT(20001)]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).matched).toBe(false);
  });
});

describe('E2E-07（正常系・主経路）/guide にエラー全文を渡すと説明', () => {
  const MODULE_FULL = 'node:internal/modules/cjs/loader:1228\n' + '  at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)\n'.repeat(8)
    + "Require stack:\n- C:\\Users\\o'brien\\app\\index.js" + MODULE_TAIL;

  test.each([
    ['(a) MODULE_NOT_FOUND 全文（複数行・\' あり・識別子が500字より後ろ）', MODULE_FULL, '説明ID: NODE-MODULE-NOT-FOUND'],
    ['(b) 未収録だが Error: を含む文', 'Error: something strange happened in the widget', 'このエラーは説明集にまだ載っていません。'],
    ['(c) LPを作りたい', 'LPを作りたい', '/lp-full-generation'],
  ])('E2E-07 %s: 引数渡しとファイル渡しで同一出力', (_label, input, expected) => {
    if (input === MODULE_FULL) expect(input.indexOf('MODULE_NOT_FOUND')).toBeGreaterThan(500);
    const byArg = node(GUIDE, [input]);
    const file = path.join(tmp, 'input.txt');
    fs.writeFileSync(file, input);
    const byFile = node(GUIDE, ['--file', file]);
    expect(byArg.status).toBe(0);
    expect(byArg.stdout).toContain(expected);
    expect(byFile.stdout).toBe(byArg.stdout);
    if (input === MODULE_FULL) expect(byArg.stdout).not.toContain('おすすめ');
  });
});

describe('E2E-08（正常系・hint→hook）1コマンドで有効化すると hook が反応する', () => {
  test('E2E-08 off→hint on→反応→hint off→無反応、設定は一時ホーム、リポジトリは不変', () => {
    const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
      + execFileSync('git', ['diff'], { cwd: ROOT, encoding: 'utf8' });
    const before = status();
    const input = hookEvent('npm : File C:\\Program Files\\nodejs\\npm.ps1 cannot be loaded because running scripts is disabled on this system.', { tool_name: 'PowerShell', session_id: '' });
    const config = path.join(env.HOME, '.claude', 'taisun', 'error-explain.json');

    expect(node(HOOK, [], { input }).stdout).toBe('');
    expect(node(CLI, ['hint', 'on']).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(config, 'utf8')).enabled).toBe(true);
    expect(JSON.parse(node(HOOK, [], { input }).stdout).systemMessage).toContain('WIN-PS-POLICY');
    expect(node(CLI, ['hint', 'off']).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(config, 'utf8')).enabled).toBe(false);
    expect(node(HOOK, [], { input }).stdout).toBe('');
    expect(status()).toBe(before);
  }, 15000);
});
