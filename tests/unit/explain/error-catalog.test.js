'use strict';

// T-005: 本番エラーカタログ（FR-CAT-001/002, NFR-FUNC-001, NFR-FLEX-001, ReDoS 計時）
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXPLAIN_DIR = path.resolve(__dirname, '..', '..', '..', '.claude', 'skills', 'guide', 'explain');
const CATALOG_PATH = path.join(EXPLAIN_DIR, 'error-catalog.json');
const { loadCatalog, validateCatalog } = require(path.join(EXPLAIN_DIR, 'catalog.js'));
const { matchError, normalizeInput } = require(path.join(EXPLAIN_DIR, 'matcher.js'));
const { LIMITS } = require(path.join(EXPLAIN_DIR, 'constants.js'));

const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const { entries } = loadCatalog(CATALOG_PATH);

// 無関係なエラー10件（どのエントリにも一致してはいけない・NFR-FUNC-001）
const NEGATIVE_SET = [
  "TypeError: Cannot read properties of undefined (reading 'map')",
  'SyntaxError: Unexpected token } in JSON at position 42',
  'ReferenceError: foo is not defined',
  'RangeError: Maximum call stack size exceeded',
  "error TS2322: Type 'string' is not assignable to type 'number'.",
  'fatal: refusing to merge unrelated histories',
  "fatal: Authentication failed for 'https://github.com/example/repo.git/'",
  'npm warn deprecated inflight@1.0.6: This module is not supported',
  'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal',
  'Segmentation fault (core dumped)',
];

describe('TC-FR-CAT-001 収録件数', () => {
  test('TC-FR-CAT-001 エントリは15件以上・win を含むものが7件以上', () => {
    expect(raw.entries.length).toBeGreaterThanOrEqual(15);
    expect(raw.entries.filter((e) => e.platforms.includes('win')).length).toBeGreaterThanOrEqual(7);
  });
});

describe('TC-FR-CAT-002 本番カタログの検証', () => {
  test('TC-FR-CAT-002 検証器を全件通過する', () => {
    expect(validateCatalog(raw)).toEqual([]);
    expect(entries).toHaveLength(raw.entries.length);
  });

  test('TC-FR-CAT-002 ReDoS: 敵対入力（20,000字）で各パターン50ms未満', () => {
    const slow = [];
    for (const e of raw.entries) {
      for (const src of e.match.patterns || []) {
        const re = new RegExp(src, 'i');
        const half = src.slice(0, Math.ceil(src.length / 2));
        const inputs = ['a'.repeat(LIMITS.INPUT_MAX), ' '.repeat(LIMITS.INPUT_MAX), half.repeat(Math.ceil(LIMITS.INPUT_MAX / half.length)).slice(0, LIMITS.INPUT_MAX)];
        for (const input of inputs) {
          const start = process.hrtime.bigint();
          re.test(normalizeInput(input));
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          if (ms >= 50) slow.push(`${e.id}: ${src} (${ms.toFixed(1)}ms)`);
        }
      }
    }
    expect(slow).toEqual([]);
  });
});

describe('TC-NFR-FUNC-001 照合の正確さ', () => {
  test('TC-NFR-FUNC-001 全エントリの陽性 fixture は、カタログ全体で照合しても自エントリが選ばれる（100%）', () => {
    const wrong = [];
    for (const e of raw.entries) {
      for (const text of e.fixtures.positive) {
        const result = matchError(entries, text);
        if (!result.matched || result.entry.id !== e.id) wrong.push(`${e.id} <- ${result.matched ? result.entry.id : 'none'}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test.each(NEGATIVE_SET)('TC-NFR-FUNC-001 陰性セット: %s はどれにも一致しない', (text) => {
    expect(matchError(entries, text)).toEqual({ matched: false });
  });
});

describe('E2E と仕様で参照されるエントリ', () => {
  const byId = Object.fromEntries(raw.entries.map((e) => [e.id, e]));

  test('E2E-01 WIN-PS-POLICY: 日本語 UI の実エラーに一致し、第1手は設定を変えない', () => {
    const ja = 'npm : このシステムではスクリプトの実行が無効になっているため、ファイル C:\\Program Files\\nodejs\\npm.ps1 を読み込むことができません。\n'
      + '    + FullyQualifiedErrorId : UnauthorizedAccess';
    expect(matchError(entries, ja).entry.id).toBe('WIN-PS-POLICY');
    const e = byId['WIN-PS-POLICY'];
    expect(e.steps[0]).not.toMatch(/Set-ExecutionPolicy/i);
    expect(e.command).toContain('npm.cmd');
  });

  test('E2E-03 NODE-MODULE-NOT-FOUND は hook:true で hook_steps を持ち、巨大入力の末尾でも一致', () => {
    expect(byId['NODE-MODULE-NOT-FOUND'].hook).toBe(true);
    const text = 'x '.repeat(9950) + "\nError: Cannot find module 'express'\n  code: 'MODULE_NOT_FOUND'";
    expect(matchError(entries, text).entry.id).toBe('NODE-MODULE-NOT-FOUND');
  });

  test('E2E-06 DISK-FULL は一次キー ENOSPC を持つ', () => {
    expect(byId['DISK-FULL'].match.ids).toContain('ENOSPC');
  });

  test('FR-EXPL-002 PowerShell の別エラー GetContentReaderUnauthorizedAccessError は WIN-PS-POLICY にしない', () => {
    const result = matchError(entries, 'FullyQualifiedErrorId : GetContentReaderUnauthorizedAccessError');
    expect(result.matched && result.entry.id === 'WIN-PS-POLICY').toBe(false);
  });
});

describe('TC-NFR-FUNC-001 紛らわしいエラーの振り分け（誤誘導の防止）', () => {
  const idOf = (text) => {
    const r = matchError(entries, text);
    return r.matched ? r.entry.id : null;
  };

  test.each([
    ["Error: ENOSPC: System limit for number of file watchers reached, watch '/home/x/src'", 'LINUX-WATCHERS-LIMIT'],
    ['Error: ENOSPC: no space left on device, write', 'DISK-FULL'],
    ["Error: spawn npm ENOENT\n  code: 'ENOENT',\n  syscall: 'spawn npm'", 'NODE-SPAWN-NOT-FOUND'],
    ["Error: ENOENT: no such file or directory, open 'C:\\work\\node_modules\\x\\package.json'", 'NODE-FILE-NOT-FOUND'],
    ["Error: Cannot find module './foo'\n  code: 'MODULE_NOT_FOUND'", 'NODE-SCRIPT-NOT-FOUND'],
    ["Error: Cannot find module '/home/x/app.js'\n  code: 'MODULE_NOT_FOUND'", 'NODE-SCRIPT-NOT-FOUND'],
    ["Error: Cannot find module 'express'\n  code: 'MODULE_NOT_FOUND'", 'NODE-MODULE-NOT-FOUND'],
    ['File C:\\work\\.venv\\Scripts\\Activate.ps1 cannot be loaded because running scripts is disabled on this system.', 'WIN-PS-POLICY-OTHER'],
    ['Error: listen EACCES: permission denied 0.0.0.0:80', 'NODE-EACCES'],
  ])('TC-NFR-FUNC-001 %s → %s', (text, id) => {
    expect(idOf(text)).toBe(id);
  });

  test('TC-NFR-FUNC-001 localhost への ECONNRESET はインターネット不通と断定しない', () => {
    expect(idOf('Error: read ECONNRESET at TCP.onStreamRead (127.0.0.1:3000)')).toBeNull();
  });

  test('DATA-001 hook:true は誤誘導しない高確度の3件だけ', () => {
    expect(raw.entries.filter((e) => e.hook === true).map((e) => e.id).sort())
      .toEqual(['DISK-FULL', 'NODE-MODULE-NOT-FOUND', 'WIN-PS-POLICY']);
  });
});

describe('TC-NFR-FLEX-001 拡張性', () => {
  test('TC-NFR-FLEX-001 JSON にエントリを1件足すだけで、コード変更なしに検証・照合に載る', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-flex-'));
    try {
      const extra = {
        id: 'TEST-EXTRA', title: '追加テスト', priority: 50,
        match: { ids: ['EXTRAERR'] },
        what: '追加したエントリが使われた可能性が高いです。',
        steps: ['この説明が出れば、追加は成功しています。'],
        platforms: ['win'], evidence: ['EV-ERR-005'],
        fixtures: { positive: ['code EXTRAERR'], negative: ['code EXTRAERRX'] },
      };
      const file = path.join(dir, 'catalog.json');
      fs.writeFileSync(file, JSON.stringify({ entries: [...raw.entries, extra] }));
      const loaded = loadCatalog(file);
      expect(loaded.errors).toEqual([]);
      expect(matchError(loaded.entries, 'code EXTRAERR').entry.id).toBe('TEST-EXTRA');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
