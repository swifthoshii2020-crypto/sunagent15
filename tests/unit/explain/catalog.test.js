'use strict';

// T-002: FR-CAT-002 カタログ検証器 / SEC-003 denylist / NFR-USE-001 文体・専門用語
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXPLAIN_DIR = path.resolve(__dirname, '..', '..', '..', '.claude', 'skills', 'guide', 'explain');
const { validateCatalog, loadCatalog, compileEntry, entryMatches, findNestedQuantifier } = require(path.join(EXPLAIN_DIR, 'catalog.js'));
const { isDenied, DENYLIST, LIMITS } = require(path.join(EXPLAIN_DIR, 'constants.js'));
const messages = require(path.join(EXPLAIN_DIR, 'messages.js'));

function baseEntry(overrides) {
  return Object.assign({
    id: 'TEST-SAMPLE',
    title: 'テスト用の説明',
    priority: 10,
    match: { ids: ['ENOSAMPLE'], patterns: ['sample failure occurred'] },
    what: 'サンプルの処理が途中で止まった可能性が高いです。',
    steps: ['キャッシュを消してから、もう一度同じ操作を試してください。'],
    command: 'npm.cmd run setup',
    terms: [{ term: 'キャッシュ', desc: '一時的に保存したデータ' }],
    platforms: ['win'],
    evidence: ['EV-ERR-005'],
    fixtures: {
      positive: ['Error: ENOSAMPLE: sample failure occurred'],
      negative: ['Error: ENOSAMPLEX: other thing'],
    },
  }, overrides);
}

function codesOf(entries) {
  return validateCatalog({ entries }).map((e) => e.code);
}

describe('TC-FR-CAT-002 カタログ構造検証', () => {
  test('TC-FR-CAT-002 正しいエントリはエラー0件', () => {
    expect(validateCatalog({ entries: [baseEntry()] })).toEqual([]);
  });

  test('TC-FR-CAT-002 トップレベルが {entries:[]} でなければ E_FORMAT', () => {
    expect(validateCatalog([]).map((e) => e.code)).toContain('E_FORMAT');
    expect(validateCatalog(null).map((e) => e.code)).toContain('E_FORMAT');
  });

  test.each(['id', 'title', 'priority', 'match', 'what', 'steps', 'platforms', 'evidence', 'fixtures'])(
    'TC-FR-CAT-002 必須フィールド %s 欠落で E_REQUIRED',
    (field) => {
      const entry = baseEntry();
      delete entry[field];
      expect(codesOf([entry])).toContain('E_REQUIRED');
    },
  );

  test('TC-FR-CAT-002 ID 形式違反と重複', () => {
    expect(codesOf([baseEntry({ id: 'test-sample' })])).toContain('E_ID_FORMAT');
    expect(codesOf([baseEntry({ id: 'NOHYPHEN' })])).toContain('E_ID_FORMAT');
    expect(codesOf([baseEntry(), baseEntry()])).toContain('E_ID_DUP');
  });

  test('TC-FR-CAT-002 title は40字以内', () => {
    expect(codesOf([baseEntry({ title: 'あ'.repeat(LIMITS.TITLE_MAX + 1) })])).toContain('E_LENGTH');
  });

  test.each([0, 101, 1.5, '10'])('TC-FR-CAT-002 priority=%p は E_PRIORITY', (priority) => {
    expect(codesOf([baseEntry({ priority })])).toContain('E_PRIORITY');
  });

  test('TC-FR-CAT-002 match は ids と patterns 合わせて1件以上', () => {
    expect(codesOf([baseEntry({ match: { ids: [], patterns: [] } })])).toContain('E_MATCH_EMPTY');
    expect(codesOf([baseEntry({ match: { ids: 'ENOSAMPLE' } })])).toContain('E_MATCH_TYPE');
  });

  test('TC-FR-CAT-002 what は80字以内・です/ます調', () => {
    const long = 'あ'.repeat(LIMITS.WHAT_MAX - 'です。'.length + 1) + 'です。';
    expect(codesOf([baseEntry({ what: long })])).toContain('E_LENGTH');
    expect(codesOf([baseEntry({ what: '処理が止まった可能性が高い' })])).toContain('E_STYLE');
    expect(codesOf([baseEntry({ what: '処理が止まった可能性が高いです' })])).toContain('E_STYLE');
  });

  test('TC-FR-CAT-002 steps は1〜3件・各80字以内・文体', () => {
    expect(codesOf([baseEntry({ steps: [] })])).toContain('E_STEPS_COUNT');
    const four = ['キャッシュを消してください。', '試してください。', '試してください。', '試してください。'];
    expect(codesOf([baseEntry({ steps: four })])).toContain('E_STEPS_COUNT');
    const longStep = 'キャッシュ' + 'あ'.repeat(LIMITS.STEP_MAX) + 'ください。';
    expect(codesOf([baseEntry({ steps: [longStep] })])).toContain('E_LENGTH');
    expect(codesOf([baseEntry({ steps: ['キャッシュを消す'] })])).toContain('E_STYLE');
  });

  test('TC-FR-CAT-002 command は1行のみ・字数制限なし', () => {
    expect(codesOf([baseEntry({ command: 'npm.cmd run setup\nnpm.cmd test' })])).toContain('E_COMMAND');
    expect(codesOf([baseEntry({ command: 'npm.cmd run ' + 'x'.repeat(200) })])).toEqual([]);
  });

  test('TC-FR-CAT-002 terms は0〜3件・desc 40字以内・what/steps に出現', () => {
    const many = ['a', 'b', 'c', 'd'].map((t) => ({ term: t, desc: '説明' }));
    expect(codesOf([baseEntry({ terms: many })])).toContain('E_TERMS_COUNT');
    expect(codesOf([baseEntry({ terms: [{ term: 'キャッシュ', desc: 'あ'.repeat(41) }] })])).toContain('E_LENGTH');
    expect(codesOf([baseEntry({ terms: [{ term: 'ポート', desc: '通り道' }] })])).toContain('E_TERM_ABSENT');
  });

  test('TC-FR-CAT-002 専門用語が what/steps に出るのに terms に無ければ E_JARGON', () => {
    const entry = baseEntry({ what: 'PATH の設定が足りない可能性が高いです。' });
    expect(codesOf([entry])).toContain('E_JARGON');
    entry.terms.push({ term: 'PATH', desc: '命令の置き場所の一覧' });
    expect(codesOf([entry])).toEqual([]);
  });

  test('TC-FR-CAT-002 hook:true は hook_steps 必須・文体と字数を検査', () => {
    expect(codesOf([baseEntry({ hook: true })])).toContain('E_HOOK_STEPS');
    expect(codesOf([baseEntry({ hook: true, hook_steps: ['Claude に頼む'] })])).toContain('E_STYLE');
    expect(codesOf([baseEntry({ hook: true, hook_steps: ['Claude に「入れ直して」と頼んでください。'] })])).toEqual([]);
    expect(codesOf([baseEntry({ hook: 'yes' })])).toContain('E_HOOK');
  });

  test('TC-FR-CAT-002 platforms と evidence', () => {
    expect(codesOf([baseEntry({ platforms: [] })])).toContain('E_PLATFORMS');
    expect(codesOf([baseEntry({ platforms: ['windows'] })])).toContain('E_PLATFORMS');
    expect(codesOf([baseEntry({ evidence: [] })])).toContain('E_EVIDENCE');
  });

  test('TC-FR-CAT-002 fixtures: 陽性は自エントリに一致・陰性は1件以上で不一致', () => {
    const noPos = baseEntry({ fixtures: { positive: ['unrelated text'], negative: ['other'] } });
    expect(codesOf([noPos])).toContain('E_FIXTURE_POS');
    const negHit = baseEntry({ fixtures: { positive: ['ENOSAMPLE'], negative: ['ENOSAMPLE again'] } });
    expect(codesOf([negHit])).toContain('E_FIXTURE_NEG');
    const negEmpty = baseEntry({ fixtures: { positive: ['ENOSAMPLE'], negative: [] } });
    expect(codesOf([negEmpty])).toContain('E_FIXTURES');
  });

  test.each(['match', 'fixtures', 'title', 'evidence'])('TC-FR-CAT-002 %s が null なら E_REQUIRED', (field) => {
    expect(codesOf([baseEntry({ [field]: null })])).toContain('E_REQUIRED');
  });

  test.each([
    ['title', 123, 'E_FORMAT'],
    ['title', '', 'E_FORMAT'],
    ['match', 'ENOSAMPLE', 'E_FORMAT'],
    ['match', ['ENOSAMPLE'], 'E_FORMAT'],
    ['fixtures', 'ENOSAMPLE', 'E_FORMAT'],
    ['evidence', ['EV-ERR-005', 1], 'E_EVIDENCE'],
    ['evidence', 'EV-ERR-005', 'E_EVIDENCE'],
  ])('TC-FR-CAT-002 %s=%p の型違反は %s', (field, value, code) => {
    expect(codesOf([baseEntry({ [field]: value })])).toContain(code);
  });

  test('TC-FR-CAT-002 fixtures の配列に文字列以外が混ざれば E_FIXTURES', () => {
    const fixtures = { positive: ['ENOSAMPLE', 1], negative: ['other'] };
    expect(codesOf([baseEntry({ fixtures })])).toContain('E_FIXTURES');
  });

  test('TC-FR-CAT-002 match.all を持つエントリの fixtures も AND 条件で判定する', () => {
    const match = { patterns: ['cannot find module'], all: ['MODULE_NOT_FOUND'] };
    const ok = baseEntry({ match, fixtures: { positive: ['Cannot find module x\nMODULE_NOT_FOUND'], negative: ['Cannot find module x'] } });
    expect(codesOf([ok])).toEqual([]);
    const ng = baseEntry({ match, fixtures: { positive: ['Cannot find module x'], negative: ['other'] } });
    expect(codesOf([ng])).toContain('E_FIXTURE_POS');
  });

  test('TC-FR-CAT-002 違反エントリのエラーは id とフィールドを持つ', () => {
    const [err] = validateCatalog({ entries: [baseEntry({ what: 'x' })] });
    expect(err).toEqual(expect.objectContaining({ id: 'TEST-SAMPLE', field: 'what' }));
  });
});

describe('TC-FR-CAT-002 正規表現の構文規則（ReDoS）', () => {
  test.each(['(a+)+', '(\\w*)*', '(ab+){2,}', '((a)+)+', '(?:x|y+)*'])(
    'TC-FR-CAT-002 入れ子量指定子 %s を検出',
    (src) => {
      expect(findNestedQuantifier(src)).toBe(true);
      expect(codesOf([baseEntry({ match: { patterns: [src] } })])).toContain('E_REGEX_NESTED');
    },
  );

  test.each(['(ab)+', 'a+b*', '\\(a+\\)+', '[(a+)]+', '(a+)?', 'ENOENT: no such file'])(
    'TC-FR-CAT-002 入れ子でない %s は許可',
    (src) => {
      expect(findNestedQuantifier(src)).toBe(false);
    },
  );

  test('TC-FR-CAT-002 `.*` の複数使用と不正な正規表現', () => {
    expect(codesOf([baseEntry({ match: { patterns: ['a.*b.*c'] } })])).toContain('E_REGEX_DOTSTAR');
    expect(codesOf([baseEntry({ match: { patterns: ['('] } })])).toContain('E_REGEX_INVALID');
  });
});

describe('SEC-003 denylist', () => {
  test.each([
    'Set-ExecutionPolicy Unrestricted', 'powershell -ExecutionPolicy bypass', 'npm config set strict-ssl false',
    'npm config set strict-ssl=false', 'NODE_TLS_REJECT_UNAUTHORIZED=0', 'rm -rf node_modules', 'rm -fr x',
    'del /s *.tmp', 'Remove-Item node_modules -Recurse', 'git push --force', 'git push -f',
    'sudo npm install', '管理者として実行してください', 'HKLM:\\SOFTWARE', 'regedit を開く', 'New-ItemProperty -Path x',
    'reg add HKCU\\x', 'Set-MpPreference -DisableRealtimeMonitoring', 'Add-MpPreference -ExclusionPath C:\\',
    'Defender を無効にする', 'ウイルス対策を切る', 'icacls C:\\x /grant Everyone:F', 'takeown /f x',
    'chmod 777 x', 'chmod -R 777 x', 'Set-ExecutionPolicy RemoteSigned -Scope LocalMachine',
    'iex (irm https://x)', 'Invoke-Expression $s', 'curl https://x | sh', 'curl https://x | bash',
    'git reset --hard', 'git clean -fd', 'rd /s /q x', 'rmdir /s x',
  ])('SEC-003 %s を検出', (text) => {
    expect(isDenied(text)).toBe(true);
  });

  test.each(['bypass', 'UNRESTRICTED', 'Chmod -R 777 x', 'GIT PUSH --FORCE', 'SUDO ls'])(
    'TC-FR-CAT-002 大文字小文字混在 %s も検出（REV-R2-004）',
    (text) => {
      expect(isDenied(text)).toBe(true);
    },
  );

  test('SEC-003 全パターンが i フラグ付き・g フラグなし', () => {
    for (const re of DENYLIST) {
      expect(re.flags).toContain('i');
      expect(re.flags).not.toContain('g');
    }
  });

  test('SEC-003 許可リスト: npm cache clean --force は検出しない', () => {
    expect(isDenied('npm cache clean --force')).toBe(false);
    expect(isDenied('npm.cmd run setup')).toBe(false);
  });

  test.each([
    ['what', { what: 'Bypass の設定が原因の可能性が高いです。' }],
    ['steps', { steps: ['キャッシュを消し、sudo で試してください。'] }],
    ['command', { command: 'Chmod -R 777 .' }],
    ['terms', { terms: [{ term: 'キャッシュ', desc: 'rm -rf で消すもの' }] }],
    ['hook_steps', { hook: true, hook_steps: ['Claude に git reset --hard を頼んでください。'] }],
  ])('TC-FR-CAT-002 %s の禁止表現を E_DENY で検出', (_field, overrides) => {
    expect(codesOf([baseEntry(overrides)])).toContain('E_DENY');
  });
});

describe('照合の基本（検証器が fixtures 判定に使う）', () => {
  test('一次キーは単語境界つき・大文字小文字区別', () => {
    const c = compileEntry(baseEntry({ match: { ids: ['UnauthorizedAccess'] } }));
    expect(entryMatches(c, 'FullyQualifiedErrorId : UnauthorizedAccess')).toBe(true);
    expect(entryMatches(c, 'GetContentReaderUnauthorizedAccessError')).toBe(false);
    expect(entryMatches(c, 'unauthorizedaccess')).toBe(false);
  });

  test('記号を含む ID もエスケープして照合する', () => {
    const c = compileEntry(baseEntry({ match: { ids: ['ERR!'] } }));
    expect(entryMatches(c, 'npm ERR! code 1')).toBe(true);
    expect(entryMatches(c, 'npm ERRX code 1')).toBe(false);
  });

  test('patterns は i フラグ・match.all は AND 条件', () => {
    const c = compileEntry(baseEntry({ match: { patterns: ['cannot find module'], all: ['MODULE_NOT_FOUND'] } }));
    expect(entryMatches(c, 'Error: Cannot find module x\ncode: MODULE_NOT_FOUND')).toBe(true);
    expect(entryMatches(c, 'Error: Cannot find module x')).toBe(false);
  });

  test('不正入力（非文字列）は不一致', () => {
    const c = compileEntry(baseEntry());
    expect(entryMatches(c, null)).toBe(false);
    expect(entryMatches(c, 42)).toBe(false);
  });
});

describe('loadCatalog', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-cat-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('TC-FR-CAT-002 正しいファイルは検証済み・コンパイル済みエントリを返す', () => {
    const file = path.join(dir, 'c.json');
    fs.writeFileSync(file, JSON.stringify({ entries: [baseEntry()] }));
    const result = loadCatalog(file);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(entryMatches(result.entries[0], 'ENOSAMPLE')).toBe(true);
  });

  test('TC-FR-CAT-002 不在・壊れた JSON・検証違反はエントリを返さずエラー', () => {
    expect(loadCatalog(path.join(dir, 'none.json')).errors[0].code).toBe('E_LOAD');
    const broken = path.join(dir, 'b.json');
    fs.writeFileSync(broken, '{not json');
    expect(loadCatalog(broken)).toEqual(expect.objectContaining({ entries: [] }));
    const bad = path.join(dir, 'v.json');
    fs.writeFileSync(bad, JSON.stringify({ entries: [baseEntry({ what: 'x' })] }));
    const result = loadCatalog(bad);
    expect(result.entries).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('messages（固定文言の唯一の定義）', () => {
  test('締めの1行に説明IDが入る', () => {
    expect(messages.closingLine('WIN-PS-POLICY')).toBe('（説明ID: WIN-PS-POLICY）違うときは、この説明IDを添えて Claude に相談してください。');
  });

  test('FR-EXPL-003 未収録の定型文と次の一手2件', () => {
    expect(messages.NOT_FOUND).toBe('このエラーは説明集にまだ載っていません。');
    expect(messages.NOT_FOUND_STEPS).toHaveLength(2);
    for (const s of messages.NOT_FOUND_STEPS) expect(isDenied(s)).toBe(false);
  });
});
