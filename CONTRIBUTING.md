# Contributing to PalmWiki Home

## 開発の流れ

- 安定版は`main`で管理します。作業ブランチは`codex/<topic>`を使用してください。
- `main`へ直接Pushせず、Pull Request経由で変更します。
- Pull Requestには目的、影響範囲、手動確認の有無、ロールバック方法を記載してください。
- `2hop-links-plus`への実行時依存や、その固有DOM・設定の読み取りを追加しないでください。
- Vault本文、添付ファイル、`data.json`、`index-cache.json`、全文を含む`search-cache.json`、個人パス、ローカルレビュー記録をコミットしないでください。

## ローカル検証

Node.js 22とlockfileを使用します。

```bash
npm ci
npm run check
```

変更内容に応じて、`docs/MANUAL_TEST_PLAN.md`と`MANUAL_TEST_CHECKLIST.md`へ手動確認項目を追加してください。Obsidian実機で確認できない環境は、対応済みと記載しないでください。

## Pull RequestとRelease

- CIが成功してからSquash mergeします。
- Release前に`npm run verify:release`を実行し、`package.json`、`manifest.json`、`versions.json`、タグの版番号を揃えます。
- Releaseへ添付するのは`main.js`、`manifest.json`、`styles.css`だけです。
- 配布前にテストVaultの既存プラグインを`.obsidian/plugins/`の外へバックアップし、3ファイルのSHA-256を照合します。
