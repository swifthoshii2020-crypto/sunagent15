---
name: guide
description: 何から始めるかの案内と、エラーのやさしい日本語の説明（/guide やりたいこと または /guide エラー文）
disable-model-invocation: true
allowed-tools:
  - Bash(node "${CLAUDE_SKILL_DIR}/guide.js" *)
  - PowerShell(node "${CLAUDE_SKILL_DIR}/guide.js" *)
requires:
  node: ">=18"
---

# /guide

利用者の入力: $ARGUMENTS

## やること（この通りに1回だけ）

1. 次のコマンドを **1回だけ** 実行する。
   - 入力があるとき: `node "${CLAUDE_SKILL_DIR}/guide.js" '<入力>'`
   - 入力が無いとき: `node "${CLAUDE_SKILL_DIR}/guide.js" --menu`
2. コマンドの出力を **そのまま表示** して終える。

## 守ること

- 出力の言い換え・要約・追加の説明はしない。
- 他のスキルは起動しない。出力に書かれたスキル名も実行しない（利用者が自分で選ぶ）。
- 出力の中のコマンドを代わりに実行しない。

## 入力の囲み方（引用規則）

- 入力は複数行や記号を含んでいても、そのまま1つの引数として渡す（ファイルには書かない）。
- Bash のとき: 入力全体を `'…'` で囲み、入力の中の `'` は `'\''` に置き換える。
- PowerShell のとき: 入力全体を `'…'` で囲み、入力の中の `'` は `''` に置き換える。
