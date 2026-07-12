# プロジェクトコンテキスト

## 目的

PalmWiki Homeは、現在のObsidian VaultをCosense / Scrapbox風に閲覧するための独立したコミュニティプラグインです。`2hop-links-plus`とは別リポジトリで管理し、実行時依存も持たせません。

## 現在の管理状態

- GitHubリポジトリは`u-4/obsidian-palmwiki-home`です。
- リポジトリは2026-07-12にPublicへ変更しました。最新版は[0.2.0 Release](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.2.0)で、[0.1.0 Release](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.1.0)も履歴として公開済みです。
- Obsidianコミュニティプラグインへの申請はまだ行っていません。
- 0.2.0もObsidian Desktop 1.12.7以上を対象とし、モバイル対応は次の段階で検証します。
- 安定版の基準は`main`、開発作業は焦点を絞った`codex/*`ブランチを使用します。
- 生成済み`main.js`はGit管理せず、Releaseには`main.js`、`manifest.json`、`styles.css`だけを添付します。タグからは自動公開せず、検証後に下書きReleaseを作ります。

## 実装済みの範囲

- カード・テーブル表示、各種並べ替え、ピン留め
- include / excludeフォルダー設定と基本フィルター
- 大規模Vault向けの仮想化、レイアウト準備後のアイドル索引、永続キャッシュ
- 保存済み索引の先行表示と、Waiting / Indexing / Complete / Update failed状態表示
- 解決済みMarkdownリンクを利用したリンク数、被リンク数、PageRank風スコア
- PageRankのhub抑制、除外元設定、動作計測ログ
- 通常MarkdownタブとPalmWiki HomeタブをPalmWiki Home単独で管理する左上Homeボタン
- Markdownで選べるHome表示・既存ページ表示・Obsidianコマンド実行と、Home内の最上部移動
- PalmWiki HomeのCardからクリック元の同じタブへMarkdownページを開く経路

## 0.2.0実装・公開結果

- 左上Homeボタン所有機能とCard同一タブ遷移を0.2.0として公開しました。
- 2Hop Links Plusのコード、設定、DOM、実行時データには依存せず、PalmWiki Home固有のclassとmanagerだけを使用します。
- production build、公式Obsidian ESLint、50件の自動テスト、metadata検証、差分空白検査は成功済みです。
- 検証済みの機能更新は、利用者指定の`PalmWiki_LocalTest`へ再確認なしで配置する運用です。別のVaultへ配置する場合は改めて確認します。
- PR [#7](https://github.com/u-4/obsidian-palmwiki-home/pull/7)をCI成功後にsquash mergeし、タグ`0.2.0`はmainコミット`62e7876`を指しています。
- [Release workflow](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29191216958)で依存監査、build、lint、50テスト、厳格なRelease検証、3成果物の下書き作成がすべて成功しました。
- 公開URLから3成果物を再取得し、ローカルbuild・GitHub Digest・テストVault配布物とSHA-256が一致しました。
- SHA-256は`main.js`が`c825710c…88b3`、`manifest.json`が`13354511…aefd`、`styles.css`が`23bfeced…8c90`です。

## 0.1.0リリース候補で確認済み

- PageRank補正後の順位、PageRank / Inlinks / Outlinksの並べ替え、リンク先フィルターをコピーVaultで確認済み。
- 保存済み索引の先行表示、起動時の遅延索引、手動更新、設定保持、破損キャッシュ復旧を確認済み。
- README、既知の制限、バージョン、3成果物、チェックサムを確認済み。
- 公式Obsidian ESLint、`npm run check`、31件の自動テスト、依存関係監査を確認済み。

## 0.1.0公開結果

- タグ`0.1.0`は検証済みコミット`ee4d684`を指しています。
- 公開Releaseの添付物は`main.js`、`manifest.json`、`styles.css`の3点だけです。
- 公開URLから3成果物を再取得し、Release表示・ローカルbuild・テストVault配布物のSHA-256が一致しました。
- `main.js`には同梱するReact系ライブラリのMIT許諾文を埋め込み、Release検証で版番号と全文を確認します。
- 初回の下書き作成ジョブはリポジトリ自動判定に失敗しましたが、検証済みArtifactから安全に下書きを作成しました。PR #5でリポジトリを明示する修正を`main`へ反映済みです。

## 次の段階

- Publicリポジトリで利用可能になった`main`ブランチ保護を、単独管理でも運用不能にならない設定で有効化するか判断する。
- GitHubの非公開脆弱性報告と`SECURITY.md`を整備するか判断する。
- モバイル版Obsidianで互換性を検証する。
- 左上Homeボタンの複数split、ポップアウト、Hover系、reduced motion、未読込復元タブをコピーVaultで継続確認する。
- 安定運用を確認後、Obsidianコミュニティプラグインへの申請を検討する。

## 継続時の注意

- 検証済み機能更新は、既定の`PalmWiki_LocalTest`へ自動配置する。別のVaultへ配布する場合は利用者へ確認する。
- 配布前に既存プラグインを`.obsidian/plugins/`の外へバックアップし、3成果物のチェックサムを照合する。
- Vault本文、添付ファイル、個人パス、ローカルレビュー記録をGitへ追加しない。
- `npm run build`、`npm run eslint`、`npm test`、`npm run verify:release`、`git diff --check`をRelease前に実行します。
