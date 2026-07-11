# プロジェクトコンテキスト

## 目的

PalmWiki Homeは、現在のObsidian VaultをCosense / Scrapbox風に閲覧するための独立したコミュニティプラグインです。`2hop-links-plus`とは別リポジトリで管理し、実行時依存も持たせません。

## 現在の管理状態

- GitHubリポジトリは`u-4/obsidian-palmwiki-home`です。
- 機能と公開資料を整える間はPrivateで管理します。
- 一般公開、GitHub Release、Obsidianコミュニティプラグイン申請はまだ行いません。
- 安定版の基準は`main`、開発作業は焦点を絞った`codex/*`ブランチを使用します。
- 生成済み`main.js`はGit管理せず、公開時は`main.js`、`manifest.json`、`styles.css`をGitHub Releaseへ添付します。

## 実装済みの範囲

- カード・テーブル表示、各種並べ替え、ピン留め
- include / excludeフォルダー設定と基本フィルター
- 大規模Vault向けの仮想化、レイアウト準備後のアイドル索引、永続キャッシュ
- 解決済みMarkdownリンクを利用したリンク数、被リンク数、PageRank風スコア
- PageRankのhub抑制、除外元設定、動作計測ログ

## 公開前に必要な確認

- PageRank補正後の順位が実データで有用か、コピーしたテストVaultで手動確認する。
- PageRank、Inlinks、Outlinksの並べ替えとリンク先フィルターに表示崩れや操作遅延がないことを確認する。
- `MANUAL_TEST_CHECKLIST.md`の主要項目を完了する。
- README、既知の制限、バージョン、リリース成果物を最終確認する。
- Publicへの変更は、上記確認後に利用者の明示的な判断を得てから行う。

## 継続時の注意

- テストVaultへの配布先は作業ごとに利用者へ確認する。
- 配布前に既存プラグインを`.obsidian/plugins/`の外へバックアップし、3成果物のチェックサムを照合する。
- Vault本文、添付ファイル、個人パス、ローカルレビュー記録をGitへ追加しない。
- `npm run eslint`は現在TypeScript型チェックであり、ルールベースのESLint導入は将来課題です。
