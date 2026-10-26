#!/usr/bin/env node
/**
 * cli.js — エラー説明 CLI（SDD C-06・I/F 仕様は SDD §5 が正本）
 *
 *   node cli.js explain "<エラー文>" [--json]
 *   node cli.js explain --file <パス> [--json]
 *   <命令> | node cli.js explain [--json]
 *   node cli.js explain --id <説明ID> [--json]
 *   node cli.js guide "<やりたいこと>"
 *   node cli.js hint on|off
 *
 * exit: 0=正常（一致/不一致とも）、1=カタログ不正（メンテナ向け）、2=使い方誤り、3=設定書込み失敗
 * 入力は評価・実行しない。エラー原文を出力・保存しない（NFR-SEC-001）。
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { LIMITS, writeConfig } = require('./constants');
const { loadCatalog } = require('./catalog');
const { matchError } = require('./matcher');
const { formatTerminal, formatJson } = require('./format');
const { CLI: TEXT, hintResult, hintFailed } = require('./messages');

const CATALOG_PATH = path.join(__dirname, 'error-catalog.json');

function result(exitCode, stdout, stderr) {
  return { exitCode, stdout: stdout || '', stderr: stderr || '' };
}

function usage() {
  return result(2, `${TEXT.USAGE}\n`);
}

/**
 * BOM で UTF-16LE / UTF-16BE / UTF-8 を判別して文字列にする（FR-EXPL-004）
 * @param {Buffer} buf
 * @returns {string}
 */
function decodeBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const body = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    return body.swap16().toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

function readFileLimited(file) {
  const fd = fs.openSync(file, 'r');
  try {
    // FIFO・デバイス等は読むと止まりうるため、通常のファイルだけを受け付ける
    if (!fs.fstatSync(fd).isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOTFILE' });
    const buf = Buffer.alloc(LIMITS.STDIN_MAX_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 上限つきで標準入力を読む（maxBytes か timeoutMs で打ち切り・タイマーは必ず解除）
 * @returns {Promise<Buffer>}
 */
function readStdinLimited(stream, { maxBytes, timeoutMs }) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      if (typeof stream.pause === 'function') stream.pause();
      resolve(Buffer.concat(chunks));
    };
    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const take = Math.min(buf.length, maxBytes - size);
      chunks.push(buf.subarray(0, take));
      size += take;
      if (size >= maxBytes) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    stream.on('data', onData);
    stream.once('end', finish);
    stream.once('error', finish);
  });
}

function parseExplainArgs(args) {
  const parsed = { words: [], file: null, id: null, json: false, error: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') parsed.json = true;
    else if (a === '--file' || a === '--id') {
      if (args[i + 1] === undefined) parsed.error = true;
      parsed[a.slice(2)] = args[i + 1];
      i += 1;
    } else parsed.words.push(a);
  }
  return parsed;
}

// 入力の優先順: 引数 > --file > 標準入力（SDD §2.2）。読めない・空なら null
async function readInput(opts, parsed) {
  let text = parsed.words.join(' ');
  if (text.trim() === '' && parsed.file) {
    try {
      text = decodeBuffer(readFileLimited(parsed.file));
    } catch (_) {
      return null;
    }
  } else if (text.trim() === '' && opts.stdin && !opts.stdin.isTTY) {
    const timeoutMs = opts.stdinTimeoutMs || LIMITS.STDIN_TIMEOUT_MS;
    text = decodeBuffer(await readStdinLimited(opts.stdin, { maxBytes: LIMITS.STDIN_MAX_BYTES, timeoutMs }));
  }
  return text.trim() === '' ? null : text;
}

async function explainCommand(opts, args) {
  const parsed = parseExplainArgs(args);
  if (parsed.error) return usage();
  const catalog = loadCatalog(opts.catalogPath || CATALOG_PATH);
  if (catalog.errors.length > 0) {
    const first = catalog.errors[0];
    return result(1, '', `${TEXT.CATALOG_BROKEN}${first.code}${first.id ? ` ${first.id}` : ''}\n`);
  }
  const format = parsed.json ? formatJson : formatTerminal;
  if (parsed.id) {
    const hit = catalog.entries.find((c) => c.entry.id === parsed.id);
    if (!hit) return result(2, `${TEXT.ID_NOT_FOUND}\n`);
    return result(0, `${format({ matched: true, entry: hit.entry })}\n`);
  }
  const input = await readInput(opts, parsed);
  if (input === null) return usage();
  return result(0, `${format(matchError(catalog.entries, input))}\n`);
}

function hintCommand(opts, args) {
  if (args.length !== 1 || (args[0] !== 'on' && args[0] !== 'off')) return usage();
  const on = args[0] === 'on';
  try {
    writeConfig(opts.homeDir, { enabled: on });
  } catch (e) {
    return result(3, '', `${hintFailed(e && e.code)}\n`);
  }
  return result(0, `${hintResult(on, __filename)}\n`);
}

function guideCommand(opts, args) {
  // guide.js（SDD C-09）に処理を渡す。入力の扱いは guide.js 側の仕様に従う
  const guide = require('../guide');
  return guide.run(Object.assign({}, opts, { argv: args }));
}

/**
 * CLI 本体（テストからは in-process で呼ぶ・SDD §1 テスト容易性）
 * @param {{argv: string[], stdin?: object, env?: object, homeDir?: string, projectDir?: string,
 *          catalogPath?: string, stdinTimeoutMs?: number}} options
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
async function run(options) {
  const opts = Object.assign({}, options);
  if (opts.homeDir === undefined) opts.homeDir = os.homedir();
  const [sub, ...rest] = Array.isArray(opts.argv) ? opts.argv : [];
  if (sub === 'explain') return explainCommand(opts, rest);
  if (sub === 'hint') return hintCommand(opts, rest);
  if (sub === 'guide') return guideCommand(opts, rest);
  return usage();
}

// 直接起動より前に export する（cli.js と guide.js が互いを require するため）
module.exports = {
  run,
  decodeBuffer,
  readFileLimited,
  readStdinLimited,
};

if (require.main === module) {
  run({ argv: process.argv.slice(2), stdin: process.stdin, env: process.env }).then((r) => {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exitCode = r.exitCode;
    if (!process.stdin.isTTY) process.stdin.destroy();
  });
}
