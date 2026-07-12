# PalmWiki Home

PalmWiki Homeは、現在のObsidian VaultをCosense / Scrapbox風のホーム画面で一覧するためのコミュニティプラグインです。カードまたはテーブルからページを探し、リンク関係や更新状況を使って並べ替えられます。

## 動作要件

- Obsidian Desktop 1.12.7以上
- 0.2.1はデスクトップ版のみ対応
- macOS版Obsidian 1.12.7で確認済み
- Windows / Linuxは未確認
- iOS / Android対応は今後検証予定

macOSのiPhoneミラーリングは、画面表示や基本タップの予備確認には利用できますが、iOS版Obsidianのネイティブ互換性、バックグラウンド復帰、タッチ・キーボード・ファイル操作を証明するものではありません。iOS対応を表示する前に、実機のiOS版Obsidianで確認します。

## インストール

Obsidianコミュニティプラグインへの登録前は、GitHub Releaseから次の3ファイルを個別に取得します。GitHubが自動生成する`Source code.zip`ではありません。

```text
main.js
manifest.json
styles.css
```

3ファイルを次のフォルダーへ配置し、Obsidianの「設定」→「コミュニティプラグイン」で`PalmWiki Home`を有効にします。

```text
<vault>/.obsidian/plugins/palmwiki-home/
```

既存インストールを置き換える場合は、先に`.obsidian/plugins/`の外へバックアップしてください。バックアップをプラグインフォルダー内に残すと、Obsidianが古いプラグイン候補として検出することがあります。

## 基本的な使い方

1. 左側リボンのホームアイコン、またはコマンドパレットの`PalmWiki Home: Open home`を選びます。
2. 通常のMarkdownタブでは左上のVault名ボタンからHomeへ戻れます。設定で、同じタブに特定ページを開く動作、または選択したObsidianコマンドを実行する動作へ変更できます。
3. PalmWiki Homeタブで同じ左上ボタンを押すと、Card / TableのどちらでもHomeの最上部へ戻ります。
4. `Card` / `Table`で表示方法を切り替えます。Cardをクリックすると、そのHomeタブが選択したMarkdownページへ置き換わり、新しいタブは増えません。`Card preview`設定では、カードのページプレビューを無効、Cmd/Ctrl＋hover、hoverのみから選べます。
5. 並べ替え、昇順・降順、フォルダー、タグ、Quick filter、`Links to page`を組み合わせて絞り込みます。
6. `Pin`で重要なページを先頭グループに固定します。
7. 最新状態をすぐ確認したい場合は`Refresh`を選びます。

主な並べ替え項目は更新日時、作成日時、タイトル、行数、文字数、PageRank、被リンク数、リンク数です。

- `PageRank`: ページ同士のリンク関係などから推定した重要度
- `Inlinks`（被リンク数）: ほかのページからこのページへ来るリンク数
- `Outlinks`（リンク数）: このページからほかのページへ出るリンク数

## 索引状態

Home上部には、次の状態を常に表示します。

- `Waiting`: Obsidianの画面・タブ復元やアイドル時間を待っています。保存済み索引があれば一覧を先に表示します。
- `Indexing`: 最新状態を検証・作成しています。保存済み一覧は処理中も利用できます。
- `Complete`: 最新索引への更新が完了しています。
- `Update failed`: 更新に失敗しました。保存済み一覧があれば引き続き表示し、`Refresh`で再試行できます。

既定では、Obsidian起動だけを理由に全Vaultの本文を読みません。Homeを開いた時は保存済み索引を先に読み、重い全件処理は画面復元後のアイドル時まで待ちます。`Index on startup`を有効にした場合だけ、Homeが閉じていても起動後のアイドル時に索引を更新します。

## 主な機能

- Markdownページのカード表示とテーブル表示
- MarkdownとPalmWiki Homeの各タブを対象にした左上Homeボタン
- Homeを開く、既存ページを開く、Obsidianコマンドを実行する3種類のHomeボタン動作
- Cardからクリック元のHomeタブへMarkdownページを開く同一タブ遷移
- CardからObsidian標準のページプレビューを開く3段階設定
- 更新日時、作成日時、タイトル、行数、文字数による並べ替え
- PageRank風スコア、被リンク数、リンク数による並べ替え
- ページのピン留め
- include / excludeフォルダー設定
- フォルダー、タグ、タイトル、パス、リンク先による絞り込み
- 大規模Vault向けのカード・テーブル仮想化
- アイドル時の遅延索引、永続キャッシュ、任意の動作計測ログ

## 保存データとプライバシー

PalmWiki Homeは、アクティブなVault内のMarkdown本文をローカルで読み、表示用の説明、件数、タグ、リンク情報を作ります。ノート本文や添付ファイルを変更・削除しません。

外部通信、アカウント、課金、広告、利用状況の送信、テレメトリはありません。プラグインフォルダーには次のローカルデータだけを保存します。

- `data.json`: Homeボタン、include / exclude、表示方法、ピン留めなどの設定
- `index-cache.json`: Vault内パス、タイトル、別名、タグ、作成・更新日時、画像参照、リンク、件数、計算済みスコア、最大約180文字の本文由来説明などの表示用索引。ノート全文は保存しません。

Vault設定フォルダーをObsidian Syncなどの対象にしている場合、これらもその仕組みによって同期される可能性があります。

`Performance debug logging`は既定でOFFです。ONにすると、処理時間、Vault相対パス、PageRank診断などをローカルの開発者コンソールへ出力する場合があります。コンソール内容を第三者へ共有する前に確認してください。

## 問題が起きた場合

1. Home上部の`Refresh`を選びます。
2. 改善しない場合はプラグインを無効にします。
3. `<vault>/.obsidian/plugins/palmwiki-home/index-cache.json`だけを削除し、再度有効にします。索引は再作成され、ノートと設定は消えません。
4. 起動できない場合はプラグインを無効にし、事前にバックアップした`main.js`、`manifest.json`、`styles.css`へ戻します。

`data.json`を削除すると設定とピン留めが初期化されるため、索引の復旧だけを目的に削除しないでください。不具合報告は[GitHub Issues](https://github.com/u-4/obsidian-palmwiki-home/issues)で受け付けます。

セキュリティ上の問題は公開Issueへ書かず、[SECURITY.md](SECURITY.md)の手順または[非公開脆弱性報告](https://github.com/u-4/obsidian-palmwiki-home/security/advisories/new)を利用してください。

## 現在の対象外

- 本文全文検索
- OCR検索
- 複数Vault検索
- 関連ページスコア
- `2hop-links-plus`との実行時連携
- モバイル版Obsidian

詳しい制限は[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)を参照してください。

## 開発と検証

Node.js 22を使用します。

```bash
npm ci
npm run check
```

`npm run check`は、型チェックとproduction build、Obsidian公式ESLint、自動テスト、リリース版番号と3成果物の照合、Git差分の空白検査を実行します。生成済み`main.js`、source map、Vault実行データはGit管理しません。

## ライセンス

PalmWiki Home本体は[MIT License](LICENSE.md)です。配布用`main.js`に同梱するReact系ライブラリと、Homeナビゲーション設計で参照したMITコードの許諾文は、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)で確認できます。同じ全文をproduction build時に`main.js`へ埋め込みます。これはライセンス表記の継承であり、`2hop-links-plus`への実行時依存ではありません。
