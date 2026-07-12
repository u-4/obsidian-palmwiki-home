# プロジェクトコンテキスト

## 目的

PalmWiki Homeは、現在のObsidian VaultをCosense / Scrapbox風に閲覧するための独立したコミュニティプラグインです。`2hop-links-plus`とは別リポジトリで管理し、実行時依存も持たせません。

## 現在の管理状態

- GitHubリポジトリは`u-4/obsidian-palmwiki-home`です。
- 機能と公開資料を整える間はPrivateで管理します。
- 一般公開、GitHub Release、Obsidianコミュニティプラグイン申請はまだ行いません。
- 0.1.0はObsidian Desktop 1.12.7以上を対象とし、モバイル対応は公開後に検証します。
- 安定版の基準は`main`、開発作業は焦点を絞った`codex/*`ブランチを使用します。
- 生成済み`main.js`はGit管理せず、公開時は`main.js`、`manifest.json`、`styles.css`をGitHub Releaseへ添付します。タグからは自動公開せず、検証後に下書きReleaseを作ります。

## 実装済みの範囲

- カード・テーブル表示、各種並べ替え、ピン留め
- include / excludeフォルダー設定と基本フィルター
- 大規模Vault向けの仮想化、レイアウト準備後のアイドル索引、永続キャッシュ
- 保存済み索引の先行表示と、Waiting / Indexing / Complete / Update failed状態表示
- 解決済みMarkdownリンクを利用したリンク数、被リンク数、PageRank風スコア
- PageRankのhub抑制、除外元設定、動作計測ログ

## 0.1.0リリース候補で確認済み

- PageRank補正後の順位、PageRank / Inlinks / Outlinksの並べ替え、リンク先フィルターをコピーVaultで確認済み。
- 保存済み索引の先行表示、起動時の遅延索引、手動更新、設定保持、破損キャッシュ復旧を確認済み。
- README、既知の制限、バージョン、3成果物、チェックサムを確認済み。
- 公式Obsidian ESLint、`npm run check`、31件の自動テスト、依存関係監査を確認済み。

## 公開時に残る確認

- `main`のCI成功後、タグ`0.1.0`を作成する。
- 自動作成された下書きReleaseに3成果物だけが添付されていることをGitHub画面で確認する。
- Publicへの変更とRelease公開は、利用者の明示的な判断を得てから行う。

## 継続時の注意

- テストVaultへの配布先は作業ごとに利用者へ確認する。
- 配布前に既存プラグインを`.obsidian/plugins/`の外へバックアップし、3成果物のチェックサムを照合する。
- Vault本文、添付ファイル、個人パス、ローカルレビュー記録をGitへ追加しない。
- `npm run build`、`npm run eslint`、`npm test`、`npm run verify:release`、`git diff --check`を公開前に実行します。
