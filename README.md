# PalmWiki Home

PalmWiki Homeは、現在のObsidian VaultをCosense / Scrapbox風のホーム画面で一覧・検索するためのコミュニティプラグインです。カードまたはテーブルからページを探し、本文、ページ名、リンク関係、PageRank風スコア、更新状況を使って目的のページを見つけられます。

## 動作要件

- Obsidian Desktop 1.12.7以上
- 0.4.0はデスクトップ版のみ対応
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
2. 通常のMarkdownタブでは、左上のVault名ボタンの右に現在のVault相対パスを小さく表示し、中央にHomeと同じ検索欄を表示します。中央のノートタイトルはタブに表示されるため省略します。Vault名ボタンは設定で、同じタブに特定ページを開く動作、または選択したObsidianコマンドを実行する動作へ変更できます。
3. PalmWiki Homeタブで同じ左上ボタンを押すと、Card / TableのどちらでもHomeの最上部へ戻ります。
4. `Card` / `Table`で表示方法を切り替えます。CardまたはTableのページ名をクリックすると、そのHomeタブが選択したMarkdownページへ置き換わり、新しいタブは増えません。`Card preview`設定では、カードのページプレビューを無効、Cmd/Ctrl＋hover、hoverのみから選べます。
5. Homeまたは通常Markdownタブの中央検索欄へフォーカスすると、最近開いたページが表示されます。文字を入力するとページ名・ファイル名・別名の曖昧候補が表示され、矢印キーで選んでEnterを押すと、検索を始めた同じタブで開きます。
6. 通常Markdownタブでも、候補を選ばずに検索語をEnterで確定すると、そのタブがPalmWiki Homeの本文検索結果へ切り替わります。空白区切りはAND、`"語句"`は連続した語句、`-除外語`は除外として扱い、本文一致、ページ名、タグ、パス、直接リンク、2-hopリンク、PageRank風スコアから順位を決めます。
7. 検索欄へ移動するコマンドは`PalmWiki Home: Focus search`です。通常Markdownがアクティブならそのタブの検索欄、HomeがアクティブならHomeの検索欄へ移動します。Obsidianの「設定」→「ホットキー」で、好みのショートカットキーを割り当てられます。
8. 検索語と同名の既存ページがない場合は、結果先頭の作成候補から確認画面を開けます。ページ名とObsidianの新規ノート保存先を確認して`Create page`を選ぶまで、ファイルは作られません。
9. 並べ替え、昇順・降順、フォルダー、タグ、Quick filter、`Links to page`を組み合わせて絞り込みます。これらのフィルターは本文検索結果にも適用されます。
10. `Pin`は通常一覧では先頭グループに固定します。本文検索では関連度を上書きせず、同じ関連度の結果だけを優先します。
11. 最新状態をすぐ確認したい場合は`Refresh`を選びます。

検索結果は、見出し1行と一致箇所を中心にした本文約2行を、項目ごとに区切って表示します。検索結果を開くと、クリックしたHomeタブが対象ページへ置き換わります。複数語の検索では、同じ行に最も多くの検索語がある位置を優先します。Live Preview / Source modeでは一致箇所を選択して表示し、Reading viewでは一致行への移動を可能な範囲で試みます。Obsidianの戻る操作では検索語、フィルター、表示方法、スクロール位置を復元しますが、左上Homeボタンで戻った場合は新しいHome状態から始まります。

主な並べ替え項目は更新日時、作成日時、タイトル、行数、文字数、PageRank、被リンク数、リンク数です。

- `PageRank`: ページ同士のリンク関係などから推定した重要度
- `Inlinks`（被リンク数）: ほかのページからこのページへ来るリンク数
- `Outlinks`（リンク数）: このページからほかのページへ出るリンク数

## 索引状態

Home上部には、表示用索引と本文検索索引の状態を常に表示します。

- `Waiting`: Obsidianの画面・タブ復元やアイドル時間を待っています。保存済み索引があれば一覧を先に表示します。
- `Indexing`: 最新状態を検証・作成しています。保存済み一覧は処理中も利用できます。
- `Complete`: 最新索引への更新が完了しています。
- `Update failed`: 更新に失敗しました。保存済み一覧があれば引き続き表示し、`Refresh`で再試行できます。

既定では、Obsidian起動やMarkdownヘッダーへの検索欄表示だけを理由に全Vaultの本文を読みません。Markdownの検索欄を実際にフォーカスした時は、ページ名候補に必要な表示用索引を遅延準備します。Homeを開いた時は保存済み索引を先に読み、重い全件処理は画面復元後のアイドル時まで待ちます。`Index on startup`を有効にした場合だけ、Homeが閉じていても起動後のアイドル時に索引を更新します。

本文検索索引は表示用索引とは別です。PalmWiki Homeを初めて開いた後に遅延作成し、その後は変更されたMarkdownだけを最大2件ずつ読み直します。入力中のページ名候補は本文を走査せず、Enterで本文検索を確定した時だけ作成済み索引を検索します。

## 主な機能

- Markdownページのカード表示とテーブル表示
- MarkdownとPalmWiki Homeの各タブを対象にした左上Homeボタン
- 通常Markdownの左上に表示する小さなVault相対パスと、中央のページ候補・本文検索欄
- Homeを開く、既存ページを開く、Obsidianコマンドを実行する3種類のHomeボタン動作
- Card / Tableからクリック元のHomeタブへMarkdownページを開く同一タブ遷移
- CardからObsidian標準のページプレビューを開く3段階設定
- 更新日時、作成日時、タイトル、行数、文字数による並べ替え
- PageRank風スコア、被リンク数、リンク数による並べ替え
- 最近開いたページと曖昧なページ名候補を表示するヘッダー検索欄
- 空白AND、引用符、除外語に対応したローカル本文検索
- UI停止を避けるため、本文検索は最大256文字・正負合計8語まで
- 直接リンク、2-hopリンク、PageRank風スコアを加味した検索順位と理由表示（密なグラフでは1語あたり直接20,000辺・2-hop 50,000辺で決定的に打ち切り）
- 同一タブでの検索結果表示、Live Preview / Source modeの一致箇所選択
- 確認画面を経由する空のMarkdownページ作成
- Obsidianの戻る・進む操作による検索状態とスクロール位置の復元
- ページのピン留め
- include / excludeフォルダー設定
- フォルダー、タグ、タイトル、パス、リンク先による絞り込み
- 大規模Vault向けのカード・テーブル仮想化
- アイドル時の遅延索引、永続キャッシュ、任意の動作計測ログ

## 保存データとプライバシー

PalmWiki Homeは、アクティブなVault内のMarkdown本文をローカルで読み、表示用の説明、件数、タグ、リンク情報を作ります。ノート本文や添付ファイルを変更・削除しません。

外部通信、アカウント、課金、広告、利用状況の送信、テレメトリはありません。プラグインフォルダーには次のローカルデータだけを保存します。

- `data.json`: Homeボタン、include / exclude、表示方法、ピン留めなどの設定
- `index-cache.json`: Vault内パス、タイトル、別名、タグ、作成・更新日時、画像参照、リンク、件数、計算済みスコア、最大約180文字の本文由来説明などの表示用索引。このファイルにはノート全文を保存しません。
- `search-cache.json`: include / exclude対象に含まれるMarkdown本文を、文字幅と大文字・小文字を揃えた検索用テキストとして保存する全文検索索引です。Vault内のプラグインフォルダーだけに保存し、外部へ送信しません。1ファイル8 MiB、対象原文合計64 MiB、推定RAM 128 MiBを超える場合は検索を開始・継続せず、include / excludeを狭める案内を表示します。互換文字の正規化で文字数が増える場合も保持前に上限判定します。キャッシュが64 MiBを超える場合は永続保存を行わず、次回起動時に再作成します。

Obsidianの戻る・進むで復元するため、検索語とHomeの表示状態はObsidianのworkspace状態にも保存される場合があります。

Vault設定フォルダーをObsidian Syncなどの対象にしている場合、これらもその仕組みによって同期される可能性があります。

`Performance debug logging`は既定でOFFです。ONにすると、処理時間、Vault相対パス、PageRank診断などをローカルの開発者コンソールへ出力する場合があります。コンソール内容を第三者へ共有する前に確認してください。

## 問題が起きた場合

1. Home上部の`Refresh`を選びます。
2. 改善しない場合はプラグインを無効にします。
3. 一覧の問題なら`<vault>/.obsidian/plugins/palmwiki-home/index-cache.json`、本文検索の問題なら同じ場所の`search-cache.json`だけを削除し、再度有効にします。索引は再作成され、ノートと設定は消えません。
4. 起動できない場合はプラグインを無効にし、事前にバックアップした`main.js`、`manifest.json`、`styles.css`へ戻します。

`data.json`を削除すると設定とピン留めが初期化されるため、索引の復旧だけを目的に削除しないでください。不具合報告は[GitHub Issues](https://github.com/u-4/obsidian-palmwiki-home/issues)で受け付けます。

セキュリティ上の問題は公開Issueへ書かず、[SECURITY.md](SECURITY.md)の手順または[非公開脆弱性報告](https://github.com/u-4/obsidian-palmwiki-home/security/advisories/new)を利用してください。

## 現在の対象外

- OCR検索
- 複数Vault検索
- 意味をAIで推測するベクトル検索や、同義語辞書による自動展開
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
