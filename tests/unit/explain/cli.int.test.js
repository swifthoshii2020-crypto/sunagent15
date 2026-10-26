'use strict';

// T-006: FR-EXPL-004/005/006, FR-CFG-001/002（cli.js の run() を in-process で検証）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const EXPLAIN_DIR = path.resolve(__dirname, '..', '..', '..', '.claude', 'skills', 'guide', 'explain');
const SKILL_DIR = path.dirname(EXPLAIN_DIR);
const { run, decodeBuffer } = require(path.join(EXPLAIN_DIR, 'cli.js'));
const { isExplainEnabled, readConfig, configPath } = require(path.join(EXPLAIN_DIR, 'constants.js'));

const PS_POLICY = 'npm : File C:\\Program Files\\nodejs\\npm.ps1 cannot be loaded because running scripts is disabled on this system.';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-cli-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function pipe(text) {
  const s = Readable.from(text === undefined ? [] : [Buffer.from(text, 'utf8')]);
  s.isTTY = false;
  return s;
}

const TTY = Object.assign(Readable.from([]), { isTTY: true });

function exec(argv, opts) {
  return run(Object.assign({ argv, stdin: TTY, env: {}, homeDir: tmp }, opts));
}

describe('TC-FR-EXPL-004 3通りの入力', () => {
  test('TC-FR-EXPL-004 引数・--file・標準入力で同じ出力と exit 0', async () => {
    const file = path.join(tmp, 'err.txt');
    fs.writeFileSync(file, PS_POLICY);
    const byArg = await exec(['explain', PS_POLICY]);
    const byFile = await exec(['explain', '--file', file]);
    const byStdin = await exec(['explain'], { stdin: pipe(PS_POLICY) });
    expect(byArg.exitCode).toBe(0);
    expect(byArg.stdout).toContain('説明ID: WIN-PS-POLICY');
    expect(byFile).toEqual(byArg);
    expect(byStdin).toEqual(byArg);
  });

  test('TC-FR-EXPL-004 複数の引数は空白でつないで1つの入力にする', async () => {
    const r = await exec(['explain', 'Error:', 'ENOSPC:', 'no', 'space']);
    expect(r.stdout).toContain('説明ID: DISK-FULL');
  });

  test('TC-FR-EXPL-004 入力の優先順は 引数 > --file > 標準入力', async () => {
    const file = path.join(tmp, 'err.txt');
    fs.writeFileSync(file, 'Error: ENOSPC: no space left on device');
    const r = await exec(['explain', PS_POLICY, '--file', file], { stdin: pipe('EADDRINUSE') });
    expect(r.stdout).toContain('WIN-PS-POLICY');
    const r2 = await exec(['explain', '--file', file], { stdin: pipe('EADDRINUSE') });
    expect(r2.stdout).toContain('DISK-FULL');
  });

  test.each([
    ['UTF-16LE（BOM あり）', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(PS_POLICY, 'utf16le')])],
    ['UTF-16BE（BOM あり）', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(PS_POLICY, 'utf16le').swap16()])],
    ['UTF-8（BOM あり）', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(PS_POLICY, 'utf8')])],
    ['UTF-8（BOM なし）', Buffer.from(PS_POLICY, 'utf8')],
  ])('TC-FR-EXPL-004 --file は %s を正しく読む', async (_label, buf) => {
    const file = path.join(tmp, 'err.txt');
    fs.writeFileSync(file, buf);
    const r = await exec(['explain', '--file', file]);
    expect(r.stdout).toContain('説明ID: WIN-PS-POLICY');
  });

  test('TC-FR-EXPL-004 日本語が ? に化けても英字 ID で一致する（PowerShell 5.1 のパイプ）', async () => {
    const garbled = "Error: Cannot find module 'express'\n  code: 'MODULE_NOT_FOUND'\n????????";
    const r = await exec(['explain'], { stdin: pipe(garbled) });
    expect(r.stdout).toContain('NODE-MODULE-NOT-FOUND');
  });

  test('decodeBuffer は奇数バイトの UTF-16 でも例外を投げない', () => {
    expect(typeof decodeBuffer(Buffer.from([0xff, 0xfe, 0x41]))).toBe('string');
  });

  test.each([
    ['入力なし（標準入力が端末）', ['explain'], {}],
    ['空白だけの引数', ['explain', '   '], {}],
    ['空のパイプ入力', ['explain'], { stdin: pipe('') }],
    ['存在しないファイル', ['explain', '--file', 'no-such-file.txt'], {}],
    ['ファイルでなくフォルダ', ['explain', '--file', os.tmpdir()], {}],
    ['--file の値なし', ['explain', '--file'], {}],
    ['サブコマンドなし', [], {}],
    ['未知のサブコマンド', ['foo'], {}],
  ])('TC-FR-EXPL-004 %s は待たずに使い方を表示して exit 2', async (_label, argv, opts) => {
    const r = await exec(argv, opts);
    expect(r.exitCode).toBe(2);
    expect(r.stdout + r.stderr).toContain('使い方');
  });

  test('TC-FR-EXPL-004 終わらないパイプ入力は時間で打ち切り、そこまでの入力で説明する', async () => {
    const s = new Readable({ read() {} });
    s.isTTY = false;
    s.push(Buffer.from('Error: ENOSPC: no space left on device'));
    const started = Date.now();
    const r = await exec(['explain'], { stdin: s, stdinTimeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.stdout).toContain('DISK-FULL');
    s.destroy();
  });

  test('TC-FR-EXPL-004 1MB を超えるパイプ入力は 1MB で打ち切る', async () => {
    const big = 'x '.repeat(600 * 1024) + 'ENOSPC';
    const r = await exec(['explain'], { stdin: pipe(big) });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('DISK-FULL');
  });

  test('FR-EXPL-003 一致しない入力でも exit 0 で未収録の案内', async () => {
    const r = await exec(['explain', 'something odd happened']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('説明集にまだ載っていません');
  });
});

describe('TC-FR-EXPL-005 --json', () => {
  test('TC-FR-EXPL-005 1行の JSON と必須キー', async () => {
    const r = await exec(['explain', '--json', PS_POLICY]);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(Object.keys(JSON.parse(r.stdout)).sort()).toEqual(['id', 'matched', 'steps', 'terms', 'what']);
  });
});

describe('TC-FR-EXPL-006 --id', () => {
  test('TC-FR-EXPL-006 既存 ID は照合せずに表示', async () => {
    const r = await exec(['explain', '--id', 'DISK-FULL']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('説明ID: DISK-FULL');
  });

  test('TC-FR-EXPL-006 --id と --json の併用', async () => {
    const r = await exec(['explain', '--id', 'DISK-FULL', '--json']);
    expect(JSON.parse(r.stdout).id).toBe('DISK-FULL');
  });

  test('TC-FR-EXPL-006 未知の ID は「その番号の説明はありません」で exit 2', async () => {
    const r = await exec(['explain', '--id', 'NO-SUCH']);
    expect(r.exitCode).toBe(2);
    expect(r.stdout + r.stderr).toContain('その番号の説明はありません');
  });
});

describe('カタログ不正（メンテナ向け）', () => {
  test('SDD §2.2 カタログが読めなければ stderr 1行・exit 1', async () => {
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{not json');
    const r = await exec(['explain', PS_POLICY], { catalogPath: bad });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
  });
});

describe('TC-FR-CFG-001 有効判定', () => {
  const write = (obj) => {
    fs.mkdirSync(path.dirname(configPath(tmp)), { recursive: true });
    fs.writeFileSync(configPath(tmp), typeof obj === 'string' ? obj : JSON.stringify(obj));
  };

  test('TC-FR-CFG-001 設定ファイルが無ければ off', () => {
    expect(isExplainEnabled({ env: {}, homeDir: tmp })).toBe(false);
  });

  test('TC-FR-CFG-001 環境変数が設定ファイルより優先', () => {
    write({ enabled: true });
    expect(isExplainEnabled({ env: { TAISUN_ERROR_EXPLAIN: '0' }, homeDir: tmp })).toBe(false);
    write({ enabled: false });
    expect(isExplainEnabled({ env: { TAISUN_ERROR_EXPLAIN: '1' }, homeDir: tmp })).toBe(true);
  });

  test('TC-FR-CFG-001 環境変数が無ければ設定ファイルの enabled', () => {
    write({ enabled: true });
    expect(isExplainEnabled({ env: {}, homeDir: tmp })).toBe(true);
    expect(isExplainEnabled({ env: { TAISUN_ERROR_EXPLAIN: 'yes' }, homeDir: tmp })).toBe(true);
  });

  test('TC-FR-CFG-001 壊れた設定ファイル・ホーム不明は off', () => {
    write('{broken');
    expect(isExplainEnabled({ env: {}, homeDir: tmp })).toBe(false);
    expect(readConfig(tmp)).toEqual({ enabled: false, additionalContext: false });
    expect(isExplainEnabled({ env: {}, homeDir: '' })).toBe(false);
  });
});

describe('TC-FR-CFG-002 hint on/off', () => {
  function snapshot(dir) {
    const out = {};
    for (const name of fs.readdirSync(dir, { recursive: true })) {
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile()) out[name] = `${st.mtimeMs}:${st.size}`;
    }
    return out;
  }

  test('TC-FR-CFG-002 on→enabled:true・off→false、既存キー保持、リポジトリは不変', async () => {
    const before = snapshot(SKILL_DIR);
    fs.mkdirSync(path.dirname(configPath(tmp)), { recursive: true });
    fs.writeFileSync(configPath(tmp), JSON.stringify({ additionalContext: true }));

    const on = await exec(['hint', 'on']);
    expect(on.exitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(configPath(tmp), 'utf8'))).toEqual({ additionalContext: true, enabled: true });
    expect(on.stdout).toContain('エラー時のヒントをオンにしました');
    expect(on.stdout).toContain('TAISUN 本体と setup-project 済みのフォルダ');
    expect(on.stdout).toContain('hint off');

    const off = await exec(['hint', 'off']);
    expect(off.exitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(configPath(tmp), 'utf8')).enabled).toBe(false);
    expect(off.stdout).toContain('hint on');

    expect(snapshot(SKILL_DIR)).toEqual(before);
  });

  test('TC-FR-CFG-002 フォルダが無ければ作る', async () => {
    const r = await exec(['hint', 'on']);
    expect(r.exitCode).toBe(0);
    expect(readConfig(tmp).enabled).toBe(true);
  });

  test('TC-FR-CFG-002 書き込めなければ理由1文で exit 3', async () => {
    const blocker = path.join(tmp, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    const r = await exec(['hint', 'on'], { homeDir: blocker });
    expect(r.exitCode).toBe(3);
    expect((r.stdout + r.stderr).trim().split('\n')).toHaveLength(1);
  });

  test('TC-FR-CFG-002 置き換えに失敗しても一時ファイルを残さない', async () => {
    fs.mkdirSync(configPath(tmp), { recursive: true });
    const r = await exec(['hint', 'on']);
    expect(r.exitCode).toBe(3);
    expect(fs.readdirSync(path.dirname(configPath(tmp))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  test('TC-FR-CFG-002 on/off 以外は使い方で exit 2', async () => {
    const r = await exec(['hint', 'maybe']);
    expect(r.exitCode).toBe(2);
  });
});
