'use strict';

// T-007: FR-CAT-003 スキル案内カタログ
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
const catalog = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, 'guide', 'guide-catalog.json'), 'utf8'));
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'hooks', 'config', 'skill-mapping.json'), 'utf8'));

const CATEGORIES = ['marketing', 'video', 'image', 'research', 'dev', 'help'];
const BUILTINS = ['help', 'login', 'compact'];

describe('TC-FR-CAT-003 案内カタログ', () => {
  test('TC-FR-CAT-003 12件以上・6分野それぞれ1件以上', () => {
    expect(catalog.entries.length).toBeGreaterThanOrEqual(12);
    for (const c of CATEGORIES) {
      expect(catalog.entries.filter((e) => e.category === c).length).toBeGreaterThanOrEqual(1);
    }
  });

  test('TC-FR-CAT-003 分野メニューは6分野・ラベルと入力例を持つ', () => {
    expect(catalog.categories.map((c) => c.id)).toEqual(CATEGORIES);
    expect(catalog.categories.map((c) => c.label)).toEqual(['マーケティング', '動画', '画像', 'リサーチ', '開発', '困ったとき']);
    for (const c of catalog.categories) expect(c.example).toMatch(/^\/guide \S/);
  });

  test.each(catalog.entries.map((e) => [e.name, e]))('TC-FR-CAT-003 %s は必須フィールドと字数を満たす', (_name, e) => {
    expect(['skill', 'builtin']).toContain(e.kind);
    expect(CATEGORIES).toContain(e.category);
    expect(Array.isArray(e.keywords) && e.keywords.length).toBeGreaterThanOrEqual(1);
    expect(e.keywords.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
    expect(typeof e.summary === 'string' && e.summary.length > 0 && e.summary.length <= 60).toBe(true);
    expect(typeof e.example === 'string' && e.example.length > 0 && e.example.length <= 120).toBe(true);
  });

  test('TC-FR-CAT-003 kind=skill は実在、kind=builtin は許可リスト内', () => {
    for (const e of catalog.entries) {
      if (e.kind === 'skill') expect(fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md'))).toBe(true);
      else expect(BUILTINS).toContain(e.name);
    }
  });

  test('TC-FR-CAT-003 「開発」分野の先頭は作りたいシステムを伝える系（sdd-full）', () => {
    expect(catalog.entries.find((e) => e.category === 'dev').name).toBe('sdd-full');
  });

  test('TC-FR-CAT-003 skill-mapping.json と同じ語の推薦先が食い違わない（REV-R2-021）', () => {
    const conflicts = [];
    for (const m of mapping.mappings) {
      if (!m.skill || !fs.existsSync(path.join(SKILLS_DIR, m.skill, 'SKILL.md'))) continue;
      for (const t of m.triggers) {
        const names = catalog.entries.filter((e) => e.keywords.some((k) => k.toLowerCase() === t.toLowerCase())).map((e) => e.name);
        if (names.length > 0 && !names.includes(m.skill)) conflicts.push(`${t}: mapping=${m.skill} guide=${names.join(',')}`);
      }
    }
    expect(conflicts).toEqual([]);
  });
});
