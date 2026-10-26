'use strict';

// T-007: FR-GUIDE-001〜004/006, FR-CFG-002（/guide ヒント）, NFR-PERF-003, SRS §12.2（--file と inbox）
const fs = require('fs');
const os = require('os');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..', '..', '..', '.claude', 'skills', 'guide');
const { run, isErrorLike } = require(path.join(SKILL_DIR, 'guide.js'));
const cli = require(path.join(SKILL_DIR, 'explain', 'cli.js'));
const { compileEntry } = require(path.join(SKILL_DIR, 'explain', 'catalog.js'));
const { matchError } = require(path.join(SKILL_DIR, 'explain', 'matcher.js'));
const messages = require(path.join(SKILL_DIR, 'explain', 'messages.js'));
const guideCatalog = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'guide-catalog.json'), 'utf8'));
const errorCatalog = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'explain', 'error-catalog.json'), 'utf8'));

const PS_POLICY = 'npm : File C:\\Program Files\\nodejs\\npm.ps1 cannot be loaded because running scripts is disabled on this system.\n    + FullyQualifiedErrorId : UnauthorizedAccess';
const MODULE_ERR = "node:internal/modules/cjs/loader:1228\n  throw err;\nError: Cannot find module 'express'\nRequire stack:\n- C:\\Users\\o'brien\\app.js\n  code: 'MODULE_NOT_FOUND'";
const LABELS = guideCatalog.categories.map((c) => c.label);

let tmp;
let home;
let project;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-guide-'));
  home = path.join(tmp, 'home');
  project = path.join(tmp, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function guide(argv, opts) {
  return run(Object.assign({ argv, env: {}, homeDir: home, projectDir: project, platform: 'win32' }, opts));
}

function installSkill(base, name) {
  const dir = path.join(base, '.claude', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: x\n---\n');
}

describe('TC-FR-GUIDE-001 推薦', () => {
  test.each([
    ['LPを作りたい', 'lp-full-generation'],
    ['ショート動画', 'shorts-create'],
    ['リサーチして', 'research-system-free'],
  ])('TC-FR-GUIDE-001 「%s」で %s を含む最大3件を名前・説明・例文つきで出す', async (query, expected) => {
    const r = await guide([query]);
    expect(r.exitCode).toBe(0);
    const shown = guideCatalog.entries.filter((e) => r.stdout.includes(`/${e.name} `) || r.stdout.includes(`/${e.name}\n`));
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length).toBeLessThanOrEqual(3);
    expect(shown.map((e) => e.name)).toContain(expected);
    for (const e of shown) {
      expect(r.stdout).toContain(e.summary);
      expect(r.stdout).toContain(e.example);
    }
  });

  test.each([
    ['help me', 'help'],
    ['login できない', 'login'],
    ['compact したい', 'compact'],
  ])('TC-FR-GUIDE-001 英字キーワードは単語単位で照合する: 「%s」→ /%s（help の中の lp で LP を出さない）', async (q, name) => {
    const r = await guide([q]);
    expect(r.stdout).toContain(`/${name} `);
    expect(r.stdout).not.toContain('/lp-full-generation');
  });

  test('TC-FR-GUIDE-001 「無料で LP を作りたい」はリサーチを推薦しない', async () => {
    const r = await guide(['無料で LP を作りたい']);
    expect(r.stdout).toContain('/lp-full-generation');
    expect(r.stdout).not.toContain('/research-system-free');
  });

  test('TC-FR-GUIDE-001 全角英字（ＬＰ）も NFKC で一致する', async () => {
    expect((await guide(['ＬＰを作りたい'])).stdout).toContain('/lp-full-generation');
  });

  test('TC-FR-GUIDE-001 境界: 500字ちょうどの末尾「LP」は推薦される', async () => {
    const q = 'あ'.repeat(498) + 'LP';
    expect((await guide([q])).stdout).toContain('/lp-full-generation');
  });

  test('TC-FR-GUIDE-001 境界: 501字では切り詰めで「L」だけ残り、メニューになる', async () => {
    const q = 'あ'.repeat(499) + 'LP';
    const r = await guide([q]);
    expect(r.stdout).toContain(messages.GUIDE.NO_MATCH);
    for (const label of LABELS) expect(r.stdout).toContain(label);
  });
});

describe('TC-FR-GUIDE-002 分野メニュー', () => {
  test.each([[[]], [['--menu']], [['   ']]])('TC-FR-GUIDE-002 引数 %p で6分野と入力例', async (argv) => {
    const r = await guide(argv);
    expect(r.exitCode).toBe(0);
    for (const c of guideCatalog.categories) {
      expect(r.stdout).toContain(c.label);
      expect(r.stdout).toContain(c.example);
    }
    expect(r.stdout).not.toContain(messages.GUIDE.NO_MATCH);
  });
});

describe('TC-FR-GUIDE-003 一致ゼロ', () => {
  test('TC-FR-GUIDE-003 「あいうえお」は候補なしの1文と分野メニュー', async () => {
    const r = await guide(['あいうえお']);
    expect(r.stdout.split('\n')[0]).toBe(messages.GUIDE.NO_MATCH);
    for (const label of LABELS) expect(r.stdout).toContain(label);
  });
});

describe('TC-FR-GUIDE-004 未導入ラベル', () => {
  test('TC-FR-GUIDE-004 ホームにもプロジェクトにも無いスキルは（未導入）と導入方法（Windows）', async () => {
    const r = await guide(['ショート動画']);
    expect(r.stdout).toContain(messages.GUIDE.NOT_INSTALLED);
    expect(r.stdout).toContain('-Profile full');
    expect(r.stdout).not.toContain('--profile full');
  });

  test('TC-FR-GUIDE-004 Mac/Linux は --profile full と案内する', async () => {
    const r = await guide(['ショート動画'], { platform: 'darwin' });
    expect(r.stdout).toContain('--profile full');
  });

  test('TC-FR-GUIDE-004 ホームかプロジェクトに入っていればラベルなし', async () => {
    installSkill(home, 'shorts-create');
    installSkill(home, 'video-agent');
    installSkill(project, 'video-download');
    const r = await guide(['ショート動画 ダウンロード']);
    expect(r.stdout).not.toContain(messages.GUIDE.NOT_INSTALLED);
  });

  test('TC-FR-GUIDE-004 ホームが取得できなければ判定しない', async () => {
    const r = await guide(['ショート動画'], { homeDir: '' });
    expect(r.stdout).not.toContain(messages.GUIDE.NOT_INSTALLED);
  });

  test('TC-FR-GUIDE-004 組込みコマンドには付けない', async () => {
    const r = await guide(['使い方が分からない']);
    expect(r.stdout).toContain('/help');
    expect(r.stdout).not.toContain(messages.GUIDE.NOT_INSTALLED);
  });
});

describe('TC-FR-GUIDE-006 エラー文を渡すと説明', () => {
  test.each([['WIN-PS-POLICY', PS_POLICY], ['NODE-MODULE-NOT-FOUND', MODULE_ERR]])(
    'TC-FR-GUIDE-006 %s の実エラー文は推薦ではなく端末向け説明',
    async (id, text) => {
      const r = await guide([text]);
      expect(r.stdout).toContain(`説明ID: ${id}`);
      expect(r.stdout).toContain(messages.HEADINGS.WHAT);
    },
  );

  test('TC-FR-GUIDE-006 500字より後ろに識別子があるエラー文でも一致（切り詰めない）', async () => {
    const text = 'x '.repeat(400) + MODULE_ERR;
    expect((await guide([text])).stdout).toContain('説明ID: NODE-MODULE-NOT-FOUND');
  });

  test.each(['Error: foo bar baz', 'something failed\nexit code 1'])('TC-FR-GUIDE-006 未収録のエラーらしい文 %p は未収録案内', async (text) => {
    const r = await guide([text]);
    expect(r.stdout).toContain(messages.NOT_FOUND);
  });

  test.each(['エラーを直したい', 'exit code 1 で失敗しました', 'LPを作りたい'])('TC-FR-GUIDE-006 エラーらしさを満たさない %p は推薦かメニュー', async (text) => {
    const r = await guide([text]);
    expect(r.stdout).not.toContain(messages.NOT_FOUND);
    expect(isErrorLike(text)).toBe(false);
  });

  test('TC-FR-GUIDE-006 エラーらしさの判定規則', () => {
    expect(isErrorLike('TypeError: x is not a function')).toBe(true);
    expect(isErrorLike('npm ERR! code 1')).toBe(true);
    expect(isErrorLike('エラーが出ました\n詳細は下')).toBe(true);
    expect(isErrorLike('エラーが出て ENOENT と表示')).toBe(true);
    expect(isErrorLike('エラーが出ました')).toBe(false);
    expect(isErrorLike('LP を作りたい\n2行目')).toBe(false);
  });

  test('TC-FR-GUIDE-006 案内カタログの例文・キーワードはエラーカタログに一致せず、例文はエラーらしさに当たらない', () => {
    const entries = errorCatalog.entries.map(compileEntry);
    for (const e of guideCatalog.entries) {
      for (const text of [e.example, ...e.keywords]) expect(matchError(entries, text)).toEqual({ matched: false });
      expect(isErrorLike(e.example)).toBe(false);
    }
  });
});

describe('TC-FR-CFG-002 /guide ヒント', () => {
  test.each(['ヒント', 'エラー時のヒントをオンにしたい'])('TC-FR-CFG-002 「%s」で絶対パス入りの hint コマンドを表示', async (q) => {
    const r = await guide([q]);
    const cliPath = path.join(SKILL_DIR, 'explain', 'cli.js');
    expect(path.isAbsolute(cliPath)).toBe(true);
    expect(r.stdout).toContain(`node "${cliPath}" hint on`);
    expect(r.stdout).toContain(`node "${cliPath}" hint off`);
    expect(r.stdout).not.toContain(messages.NOT_FOUND);
  });
});

describe('TC-NFR-PERF-003 出力量', () => {
  test('TC-NFR-PERF-003 メニュー・全例文・全分野例・エラー説明・ヒントの出力が1,200字以内', async () => {
    const inputs = [[], ['ヒント'], [PS_POLICY], [MODULE_ERR], ['Error: foo'],
      ...guideCatalog.entries.map((e) => [e.example]), ...guideCatalog.categories.map((c) => [c.example.replace('/guide ', '')]),
      [guideCatalog.entries.map((e) => e.keywords.join(' ')).join(' ')]];
    for (const argv of inputs) {
      const r = await guide(argv);
      expect(r.stdout.length).toBeLessThanOrEqual(1200);
    }
  });
});

describe('--file と inbox（SRS §12.2）', () => {
  const inbox = () => path.join(project, '.taisun-inbox');
  const put = (dir, name, text) => {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f, text);
    return f;
  };

  test('TC-FR-GUIDE-006 --file と引数で同じ出力、.taisun-inbox の guide-*.txt は読込後に削除しフォルダも消す', async () => {
    const byArg = await guide(['LPを作りたい']);
    const f = put(inbox(), 'guide-abc.txt', 'LPを作りたい');
    const byFile = await guide(['--file', f]);
    expect(byFile).toEqual(byArg);
    expect(fs.existsSync(f)).toBe(false);
    expect(fs.existsSync(inbox())).toBe(false);
  });

  test('TC-FR-GUIDE-006 --file は BOM 付き UTF-16LE も読む', async () => {
    const f = put(inbox(), 'guide-utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('LPを作りたい', 'utf16le')]));
    expect((await guide(['--file', f])).stdout).toContain('/lp-full-generation');
  });

  test('TC-FR-GUIDE-006 --file が無ければ読めない旨を表示して exit 2', async () => {
    const r = await guide(['--file', path.join(inbox(), 'guide-none.txt')]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain(messages.GUIDE.INPUT_UNREADABLE);
  });

  test.each([
    ['名前規則外', (p) => put(path.join(p, '.taisun-inbox'), 'other.txt', 'LP')],
    ['別名のフォルダ', (p) => put(path.join(p, '.inbox'), 'guide-abc.txt', 'LP')],
    ['inbox の外', (p) => put(p, 'guide-abc.txt', 'LP')],
  ])('TC-FR-GUIDE-006 %s のファイルは読むだけで削除しない', async (_label, make) => {
    const f = make(project);
    await guide(['--file', f]);
    expect(fs.existsSync(f)).toBe(true);
  });

  test('TC-FR-GUIDE-006 Windows ではフォルダ名の大文字小文字を区別しない', async () => {
    const f = put(path.join(project, '.TAISUN-INBOX'), 'guide-abc.txt', 'LP');
    await guide(['--file', f], { platform: 'linux' });
    expect(fs.existsSync(f)).toBe(true);
    await guide(['--file', f], { platform: 'win32' });
    expect(fs.existsSync(f)).toBe(false);
  });

  function tryLink(target, link) {
    try {
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
      return true;
    } catch {
      return false;
    }
  }

  test('TC-FR-GUIDE-006 祖先フォルダが Junction でも実体の .taisun-inbox なら削除する（REV-R5-S2 (1)）', async () => {
    const real = path.join(tmp, 'real');
    const f = put(path.join(real, '.taisun-inbox'), 'guide-abc.txt', 'LP');
    const link = path.join(tmp, 'link');
    if (!tryLink(real, link)) return console.warn('skip: Junction を作れない環境');
    await guide(['--file', path.join(link, '.taisun-inbox', 'guide-abc.txt')]);
    expect(fs.existsSync(f)).toBe(false);
  });

  test('TC-FR-GUIDE-006 .taisun-inbox 自体が別フォルダへの Junction なら削除しない（REV-R5-S2 (2)）', async () => {
    const f = put(path.join(project, 'store'), 'guide-abc.txt', 'LP');
    if (!tryLink(path.join(project, 'store'), inbox())) return console.warn('skip: Junction を作れない環境');
    await guide(['--file', path.join(inbox(), 'guide-abc.txt')]);
    expect(fs.existsSync(f)).toBe(true);
  });

  test('TC-FR-GUIDE-006 inbox 自体がリンクなら掃除でリンク先のファイルを消さない', async () => {
    const store = path.join(project, 'store');
    const old = put(store, 'guide-old.txt', 'x');
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(old, past, past);
    if (!tryLink(store, inbox())) return console.warn('skip: Junction を作れない環境');
    await guide(['--menu']);
    expect(fs.existsSync(old)).toBe(true);
  });

  test('TC-FR-GUIDE-006 起動ごとに mtime 1時間超の guide-*.txt だけ掃除する', async () => {
    const old = put(inbox(), 'guide-old.txt', 'x');
    const fresh = put(inbox(), 'guide-new.txt', 'x');
    const notes = put(inbox(), 'notes.txt', 'x');
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(old, past, past);
    fs.utimesSync(notes, past, past);
    await guide(['--menu']);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(notes)).toBe(true);
  });

  test('TC-FR-GUIDE-006 掃除で空になった inbox は消え、inboxDir を注入できる', async () => {
    const dir = path.join(tmp, 'custom-inbox');
    const old = put(dir, 'guide-old.txt', 'x');
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(old, past, past);
    await guide(['--menu'], { inboxDir: dir });
    expect(fs.existsSync(dir)).toBe(false);
  });

  test('TC-FR-GUIDE-006 掃除に失敗しても出力と exit は変わらない', async () => {
    const normal = await guide(['LPを作りたい']);
    const notDir = path.join(tmp, 'file-not-dir');
    fs.writeFileSync(notDir, 'x');
    expect(await guide(['LPを作りたい'], { inboxDir: notDir })).toEqual(normal);
  });
});

describe('cli.js guide（T-006 からの持ち越し）', () => {
  test('FR-CLI-001 cli.js guide は guide.js と同じ結果', async () => {
    const opts = { env: {}, homeDir: home, projectDir: project, platform: 'win32' };
    const viaCli = await cli.run(Object.assign({ argv: ['guide', 'LPを作りたい'] }, opts));
    expect(viaCli).toEqual(await guide(['LPを作りたい']));
  });

  test('FR-CLI-001 cli.js guide を直接起動しても循環 require の警告が出ない', () => {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [path.join(SKILL_DIR, 'explain', 'cli.js'), 'guide', 'ヒント'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('hint on');
  });
});
