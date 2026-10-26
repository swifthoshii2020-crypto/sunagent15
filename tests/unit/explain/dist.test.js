'use strict';

// T-009: FR-DIST-001, FR-CLI-001, FR-DOC-001, NFR-COMP-001
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const { branchBase, showAt, changedLines: diffLines } = require('./git-base');

const BASE = branchBase(ROOT); // 分岐元。取れない（浅い履歴・マージ後）ときは差分検査を skip
const onBranch = BASE ? test : test.skip;
const ANNOUNCE = '困ったとき・何から始めるか迷ったときは、Claude Code で /guide と入力してください。';
const CLI = '.claude/skills/guide/explain/cli.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readBase = (rel) => showAt(ROOT, BASE, rel);
const count = (text, s) => text.split(s).length - 1;
const changedLines = (rel) => diffLines(ROOT, BASE, rel);

describe('TC-FR-DIST-001 全プロファイルに guide', () => {
  test('TC-FR-DIST-001 minimal / standard / full の展開結果すべてに guide が含まれる', () => {
    const p = JSON.parse(read('scripts/skill-profiles.json'));
    for (const preset of ['minimal', 'standard', 'full']) {
      const skills = p.presets[preset].flatMap((name) => p.profiles[name].skills);
      expect(skills).toContain('guide');
    }
    expect(p.profiles.core.skills.filter((s) => s === 'guide')).toHaveLength(1);
  });
});

describe('TC-FR-CLI-001 npm scripts', () => {
  const scripts = JSON.parse(read('package.json')).scripts;

  test('TC-FR-CLI-001 4本の script が cli.js の各サブコマンドを指す', () => {
    expect(scripts['taisun:explain']).toBe(`node ${CLI} explain`);
    expect(scripts['taisun:guide']).toBe(`node ${CLI} guide`);
    expect(scripts['taisun:hint:on']).toBe(`node ${CLI} hint on`);
    expect(scripts['taisun:hint:off']).toBe(`node ${CLI} hint off`);
  });

  test('TC-FR-CLI-001 npm run -s の結果が直接実行と一致（hint は一時ホームに書く）', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'taisun-npm-'));
    try {
      const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home });
      const opts = { cwd: ROOT, env, encoding: 'utf8', shell: process.platform === 'win32' };
      const cases = [
        [['taisun:explain', '--', 'ENOSPC'], ['explain', 'ENOSPC']],
        [['taisun:guide', '--', 'LP'], ['guide', 'LP']],
        [['taisun:hint:on'], ['hint', 'on']],
        [['taisun:hint:off'], ['hint', 'off']],
      ];
      for (const [npmArgs, cliArgs] of cases) {
        const viaNpm = spawnSync('npm', ['run', '-s', ...npmArgs], opts);
        const direct = spawnSync(process.execPath, [CLI, ...cliArgs], Object.assign({}, opts, { shell: false }));
        expect(viaNpm.status).toBe(0);
        expect(viaNpm.stdout.replace(/\r\n/g, '\n')).toBe(direct.stdout.replace(/\r\n/g, '\n'));
      }
      expect(fs.existsSync(path.join(home, '.claude', 'taisun', 'error-explain.json'))).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 60000);
});

describe('TC-FR-DOC-001 告知1行', () => {
  test('TC-FR-DOC-001 README の「🎯 使い方」節の先頭にちょうど1行', () => {
    const readme = read('README.md');
    expect(count(readme, ANNOUNCE)).toBe(1);
    const section = readme.split('## 🎯 使い方')[1].split('\n## ')[0];
    const firstText = section.split('\n').find((l) => l.trim() !== '');
    expect(firstText).toBe(ANNOUNCE);
  });

  test.each(['scripts/install.ps1', 'scripts/install.sh'])('TC-FR-DOC-001 %s の「❓ 困ったときは」ブロック内にちょうど1行', (rel) => {
    const text = read(rel);
    expect(count(text, ANNOUNCE)).toBe(1);
    const lines = text.split('\n');
    const head = lines.findIndex((l) => l.includes('❓ 困ったときは'));
    const at = lines.findIndex((l) => l.includes(ANNOUNCE));
    expect(at).toBe(head + 1);
    expect(lines[at]).not.toMatch(/[│║┃|]/);
  });

  onBranch.each(['scripts/install.ps1', 'scripts/install.sh'])('TC-FR-DOC-001 %s は告知1行の追加以外を変えない', (rel) => {
    const { added, removed } = changedLines(rel);
    expect(removed).toEqual([]);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain(ANNOUNCE);
  });

  test('TC-FR-DOC-001 install.ps1 は BOM 付き UTF-8 のまま', () => {
    const buf = fs.readFileSync(path.join(ROOT, 'scripts', 'install.ps1'));
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  onBranch('TC-FR-DOC-001 README の告知行以外の変更は数値の同期だけ（REV-R2-006）', () => {
    const { added, removed } = changedLines('README.md');
    const others = added.filter((l) => l !== ANNOUNCE && l.trim() !== '');
    const digitsOff = (l) => l.replace(/\d+/g, '#');
    expect(others.map(digitsOff).sort()).toEqual(removed.filter((l) => l.trim() !== '').map(digitsOff).sort());
  });
});

describe('TC-NFR-COMP-001 互換性', () => {
  onBranch('TC-NFR-COMP-001 dependencies / devDependencies の差分0', () => {
    const now = JSON.parse(read('package.json'));
    const base = JSON.parse(readBase('package.json'));
    expect(now.dependencies).toEqual(base.dependencies);
    expect(now.devDependencies).toEqual(base.devDependencies);
  });

  onBranch('TC-NFR-COMP-001 package.json の変更は script 4本の追加だけ', () => {
    const now = JSON.parse(read('package.json'));
    const base = JSON.parse(readBase('package.json'));
    const added = Object.keys(now.scripts).filter((k) => !(k in base.scripts)).sort();
    expect(added).toEqual(['taisun:explain', 'taisun:guide', 'taisun:hint:off', 'taisun:hint:on']);
    for (const k of Object.keys(base.scripts)) expect(now.scripts[k]).toBe(base.scripts[k]);
  });

  test.each(['sync-readme-counts.js', 'sync-plugin-metadata.js'])('TC-NFR-COMP-001 %s --check が exit 0', (script) => {
    expect(() => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), '--check'], { cwd: ROOT, stdio: 'pipe' })).not.toThrow();
  });
});
