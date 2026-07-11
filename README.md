# PalmWiki Home

PalmWiki Homeは、現在のObsidian VaultをCosense / Scrapbox風のホーム画面で一覧するためのプラグインです。

現在は開発中で、GitHubのPrivateリポジトリで管理しています。一般公開およびObsidianコミュニティプラグインへの登録はまだ行っていません。

## 主な機能

- `PalmWiki Home`カスタムビュー、リボンアイコン、コマンド
- Markdownページのカード表示とテーブル表示
- 更新日時、作成日時、タイトル、行数、文字数による並べ替え
- PageRank風スコア、被リンク数、リンク数による並べ替え
- ページのピン留め
- include / excludeフォルダー設定
- フォルダー、タグ、タイトル、パス、リンク先による絞り込み
- 大規模Vault向けのカード・テーブル仮想化
- 遅延インデックス、本文メタデータキャッシュ、動作計測ログ

## 現在の対象外

- 本文全文検索
- OCR検索
- 複数Vault検索
- 関連ページスコア
- Markdownビューへの常設トップバー
- `2hop-links-plus`との実行時連携

詳しい制限は[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)を参照してください。

## 開発環境

Node.js 22を推奨します。

```bash
npm ci
npm run build
npm run eslint
git diff --check
```

`npm run eslint`は現在、ESLintルールではなくTypeScriptの型チェックを実行します。

## テストVaultへのインストール

ビルド後、次の3ファイルをテスト用Vaultへ配置します。

```text
<vault>/.obsidian/plugins/palmwiki-home/
  main.js
  manifest.json
  styles.css
```

既存インストールを置き換える場合は、先に`.obsidian/plugins/`の外へバックアップしてください。バックアップフォルダーを`.obsidian/plugins/`内に残すと、Obsidianが古いプラグイン候補として読み込むことがあります。

## Performance debug logging

Obsidianの「設定」→「PalmWiki Home」の一番下にある`Performance debug logging`を有効にすると、開発者コンソールへ`[PalmWiki Home perf]`で始まる計測ログを出力します。

通常利用ではOFFのままにしてください。

## ライセンス

[MIT License](LICENSE.md)
