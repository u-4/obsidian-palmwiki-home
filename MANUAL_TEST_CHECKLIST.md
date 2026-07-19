# 手動テストチェックリスト

状態の目安:

- `[x]` 自動確認またはObsidian実画面で確認済み
- `[ ]` 未実施、または公開操作時にだけ確認する項目

## 0.6.1 モバイル対応リリース判定（2026-07-19）

自動・静的確認:

- `[x]` 公開manifestの`isDesktopOnly`を`false`とし、Obsidian Mobileでインストールできる設定にする。
- `[x]` 実行時ソースとproduction bundleにNode.js / Electron import、`process.platform`、無条件の`FileSystemAdapter`、正規表現lookbehindがない。
- `[x]` Release verifierがモバイル有効manifestを必須とし、デスクトップ専用runtime参照を検出した場合は公開前に失敗する。
- `[x]` 0.6.1のproduction build、公式Obsidian ESLint、124件の自動テスト、metadata、Release metadata、diff check、moderate基準の依存監査が成功する。

実機・配布確認:

- `[x]` 利用者がiPhone実機で主要動作に大きな問題がないことを確認した。
- `[x]` `PalmWiki_LocalTest`の既存版をVault外へバックアップし、0.6.1の3成果物だけを配置してSHA-256一致を確認する。既存の設定・索引・検索キャッシュは変更しない。
- `[ ]` iPad miniを含むiPad全幅／Split Viewを個別に確認する。
- `[ ]` Android版Obsidianで起動、Home／Markdown移動、検索、設定保存を個別に確認する。

公開判定:

- `[ ]` 0.6.1タグが公開時の`main`を指し、Release workflowが3成果物だけの下書きを作る。
- `[ ]` 公開URLから3成果物を再取得し、GitHub Digest、ローカルbuild、`PalmWiki_LocalTest`配置物と一致する。

## 0.6.0 固定Homeボタン動作リリース判定（2026-07-18）

自動確認:

- `[x]` Markdownではクリックしたleafを通常Homeへ置き換え、失敗時だけ元のViewStateとephemeral stateを復元する。
- `[x]` Home検索結果ではdraft/submitted queryとresult limitだけを初期化し、filter、Card/Table、sort、方向を維持する。
- `[x]` 通常Homeでは既存の最上部移動を維持し、検索中と通常時でアクセシブル名を切り替える。
- `[x]` ページ／Obsidianコマンドの選択設定とprivate command-manager経路を削除し、旧保存keyを安全に破棄する。
- `[x]` 2Hop Links Plusのimport、設定、class、DOM参照、実行時依存を追加しない。
- `[x]` production build、公式Obsidian ESLint、124件の自動テスト、metadata、Release metadata、diff check、moderate基準の依存監査を公開前に成功させる。

`PalmWiki_LocalTest`実機確認:

- `[x]` macOS版Obsidian 1.12.7を完全再起動し、`BODY_ONLY_NEEDLE_ALPHA`の検索結果で左上ボタンが通常Homeへ戻り、検索欄と結果を消す。
- `[x]` 通常Homeの`BodyOnlyCandidate` CardからMarkdownを同じleafへ開き、左上ボタンで通常Homeへ戻る。
- `[x]` 通常Homeを数画面下へスクロールし、左上ボタンで見出しと先頭Cardが見える最上部へ戻る。
- `[x]` 更新版3成果物だけをVault外バックアップ後に配置し、ローカル成果物とのSHA-256一致を確認する。

公開結果:

- Pull Request: [#21](https://github.com/u-4/obsidian-palmwiki-home/pull/21)
- Release tag commit: `d725ea4`（タグ`0.6.0`）
- PR CI: [29629446642](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29629446642)
- Main CI: [29629480183](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29629480183)
- Release workflow: [29629532692](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29629532692)
- 公開Release: [PalmWiki Home 0.6.0](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.6.0)
- 公開成果物のSHA-256: `main.js` `34d2718dbe7336dcdd1703c79eb92305fa8b14dc5689e573ba634acf23b10399`、`manifest.json` `5093eea4cd22f4c2a68380f21650c3070ea3dd2276b7fc5d2e7f43f24ab50d34`、`styles.css` `26b7d509a033798f4ed848e5fe7ad55c2279b9ffa4ddb125e0f51b54f92ac330`
- `[x]` 通常のLatest Releaseとして公開され、Assetsが3成果物だけであることを確認した。
- `[x]` GitHub Digest、下書き／公開URLから再取得したファイル、ローカルbuild、`PalmWiki_LocalTest`配置物のSHA-256が一致した。

## 0.5.0 レスポンシブUIリリース判定（2026-07-15）

自動確認:

- `[x]` 既存設定へ`cardShape: portrait`と`Square two-column maximum width: 480`を補い、形状の保存値、不正値のfallback、閾値の整数化と280〜1600への制限を確認する。
- `[x]` Card shape/size/2列閾値は表示専用であり、表示用索引キャッシュを無効化しない。
- `[x]` Portraitの3固定高を維持し、Squareは276未満で1列、276〜設定値で2列、設定値より広い領域でCard size別の2列以上を使う。320〜440、480境界、680、820、1080、1280 CSS pxで列数を固定し、実列幅と同じ高さ・正しい行数とspacer高、未計測幅と空一覧を確認する。
- `[x]` Squareの表示契約がパスfallbackと補助メタデータを省き、Portraitでは維持する。
- `[x]` ソースと静的レビューで、更新操作をObsidian標準`refresh-cw`アイコンとして状態表示の隣へ置き、タッチ環境では44pxの操作領域にする契約を確認する。実描画は下の実機項目に残す。
- `[x]` ソースと静的レビューで、Home上部は端末判定を使わず、実際のtoolbar幅が620 CSS pxを超える時はタイトル右に状態・更新・絞り込みを1行、以下では状態行を折り返す契約を確認する。同じ絞り込みアイコンと初期閉鎖を全環境で使い、実描画は下の実機項目に残す。
- `[x]` ソースと静的レビューで、検索候補はタイトル、任意のalias、canonical full pathを別要素で表示する契約を確認する。検索欄は表示placeholderを持たず左端にObsidianの検索アイコンを置き、iOS標準のpill形状と重複clearを抑えて4px角丸の矩形にする。実描画は下の実機項目に残す。

実機確認:

- `[x]` iPhone 15 Pro Max縦画面で、小さいページ数行の下に`Complete`、`Search ready`、更新アイコンが1行で表示され、更新中も`Indexing`、`Indexing search`、無効状態の更新アイコンが1行を維持する。
- `[x]` iPhone 15 Pro Max縦画面で表示設定が初期状態で閉じ、開閉でき、閉じている間は大きい絞り込みcontrolが表示領域を占有しない。矢印を絞り込みアイコンへ変更し、全環境で同じ開閉にした最終配置はソースと自動検査まで確認し、実機再確認は下の未実施項目へ残す。
- `[x]` iPhone 15 Pro Max縦画面のSmall / Squareで2列の実カードが正方形になり、compact Pin、タイトル、画像・本文を維持し、パス等の補助情報を省く。長い一覧をスクロールしても重なり・大きな空白はなく、Homeボタンで上部へ戻る。
- `[x]` iPhone 15 Pro MaxのライトテーマでHomeボタン・検索欄・候補popupが白背景になり、平坦な候補で太字タイトルと小さい右寄せfull pathを確認する。
- `[x]` iPhone版ObsidianでPalmWiki Homeを無効化・再有効化し、更新版を再読み込みしてHomeを同一leafへ開ける。
- `[x]` `PalmWiki_LocalTest`のデスクトップで更新アイコン、全表示設定、3サイズ×2形状、長いSquare一覧、明るい/暗いテーマ、最近/曖昧候補を確認する。
  - 2026-07-15、macOS版Obsidian 1.12.7、候補commit `85841cc`で実施。更新中の状態・無効化、Card/Table、並べ替えと方向、folder/tag/quick/link target filter、表示設定の初期閉鎖、Small/Medium/Large × Portrait/Square、Square一覧の最下部、ライト/ダーク、最近のページと`RrC`→`RareC`の曖昧候補を確認し、Medium・Portrait・Darkへ戻した。
- `[ ]` iPhone実機の縦・横画面で、狭い時は小さいページ数の下に2状態、更新、絞り込みアイコンが1行に収まることを確認する。320 CSS px相当では長いエラー表示が省略されても重ならず、読み上げには全文が残ることを確認する。絞り込みの開閉、確定済みfilterだけに付くactive表示、全Card sizeで2列Square、Pinがタイトル高さを超えないこと、縦横回転後も長い一覧を維持することを確認する。
- `[ ]` iPad miniを含むiPad実機で、全幅なら`PalmWiki Home`の右に`Complete`、`Search ready`、更新、絞り込みが右寄せ1行で並ぶことを確認する。SquareはSmall/Medium/Largeに応じて2列固定を脱し、Split Viewで幅を480以下へ縮めると2列へ戻ること、設定値の変更が即時反映されることを確認する。
- `[ ]` Homeと通常Markdownの検索欄が、左端の虫眼鏡、表示文字なし、角だけわずかに丸い矩形として表示されることを確認する。focus、最近のページ、入力候補、独自clear、ソフトウェアキーボードを再確認する。
- `[ ]` iPhone実機でHome/Markdown双方の白いHomeボタン・検索欄、平坦な候補、タイトル優先、小さい右寄せfull path、touch/ソフトウェアキーボード操作を確認する。
- `[ ]` iPhone実機で再起動・タブ復元、バックグラウンド復帰、Card/Table同一leaf移動、Back/Forward、検索索引作成中の応答性とメモリを確認する。
- `[x]` iOSライフサイクル確認が完了するまでは公開manifestの`isDesktopOnly`とREADMEのdesktop-only表示を変更しない。

公開結果:

- Pull Request: [#18](https://github.com/u-4/obsidian-palmwiki-home/pull/18)
- Release tag commit: `fc60dc7`（タグ`0.5.0`）
- PR CI: [29410044094](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29410044094)
- Main CI: [29410125218](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29410125218)
- Release workflow: [29410359415](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29410359415)
- 公開Release: [PalmWiki Home 0.5.0](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.5.0)
- 公開成果物のSHA-256: `main.js` `a7f87cad4f9a9e9172659a53aa3109bf272fae120b2fb83cf31feca1b3c0253a`、`manifest.json` `d51e136a0fd26b2fec4b30c020829d7901c37aff93a3c7320a2854eb14649195`、`styles.css` `26b7d509a033798f4ed848e5fe7ad55c2279b9ffa4ddb125e0f51b54f92ac330`
- `[x]` 通常のLatest Releaseとして公開され、Assetsが3成果物だけであることを確認した。
- `[x]` 公開URLから3成果物を再取得し、GitHub DigestとローカルbuildのSHA-256が一致した。

## 0.3.1 ItemView → Markdown互換性（2026-07-13）

自動・調査確認:

- `[x]` PalmWiki Home表示中にObsidian標準のファイルエクスプローラからMarkdownを開いても、初回だけ2Hop本文内表示が出ないことを再現し、PalmWiki固有のクリック処理だけが原因ではないと確認した。
- `[x]` PalmWiki Homeは公開APIの`WorkspaceLeaf.openFile()`を維持し、workspaceイベントの手動再発火、2Hopのimport・設定・DOM参照を追加していない。
- `[x]` Card、Table、最近のページ、ページ候補、検索結果が所有Home leafの同じ失敗時復元経路を使う。
- `[x]` Card previewは`PalmWikiHomeView`が所有し、view終了時に残っているpopoverを解除する。
- `[x]` PalmWiki Homeの`npm run check`が113件、2Hop候補のテスト15件、build、公式lint、diff check、依存監査、3,000ノート相当benchmarkが成功する。

`PalmWiki_LocalTest`で確認する項目:

- `[x]` Card、Table、最近のページ、ページ名候補、本文検索結果から同じleafでMarkdownを開いた初回に2Hop本文内表示が現れる。
- `[x]` 本文検索結果から開いた初回に2Hop本文内表示が現れる。検索一致位置への直接移動との両立だけは別途再確認する。
- `[x]` PalmWiki Home表示中にObsidian標準のファイルエクスプローラと標準検索から開いた初回にも2Hop本文内表示が現れる。
- `[x]` Live Preview、Source mode、Reading view、別Markdownへの通常移動、Back / Forwardで2Hop本文内表示と右上ボタン1個を維持する。
- `[x]` Live Preview → Reading view → Source mode → Live Previewの往復で、現行ノートの本文2Hopと右上ボタン1個を維持する。
- `[x]` Reading viewで別ノートへ移動してLive Previewへ戻しても、前ノート固有の2Hopカードがhidden hostから復活しない。
- `[ ]` 同じ候補を複数splitとpop-outでも再確認する。
- `[ ]` Card previewを表示してからクリックしてもpreview所有状態が移動先Markdownへ残らない。
- `[x]` ノートAからBへ素早く切り替えても、遅れた処理がAへ描画せずBだけに表示する。
- `[x]` MarkdownからPalmWiki Homeへ戻って3秒以上待っても、2Hop本文内表示、右上ボタン、検索欄がHomeへ残らない。
- `[x]` 2Hopのseparate paneを有効にしたままLive PreviewとReading viewを往復し、本文内2Hopと右上ボタンが0、設定を戻して現行ノートの表示が1組だけ復帰する。
- `[x]` 2Hopを無効化して反対modeへ切り替え、5秒待ってもhidden本文や右上ボタンが復活しない。再有効化後は現行ノートの表示が1組だけ復帰する。

公開結果:

- Pull Request: [#15](https://github.com/u-4/obsidian-palmwiki-home/pull/15)
- Release tag commit: `9a1a40c`（タグ`0.3.1`）
- Release workflow: [29245936423](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29245936423)
- 公開Release: [PalmWiki Home 0.3.1](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.3.1)
- 公開成果物のSHA-256: `main.js` `3c3be397fba13ccc9f369b213f753949927d8b63934882671dcc57717d896f16`、`manifest.json` `7baffd8c734e7f89767a162c6bf4c5eacf721e0ff367d1b83d99d6a4bf057b6a`、`styles.css` `939d092d5011d5441c37f150535962b5ff348dd876125b0ee1524d265f2fa799`
- `[x]` 公開URLから3成果物を再取得し、GitHub Digest、ローカルbuild、`PalmWiki_LocalTest`配置物のSHA-256が一致した。

## 0.4.0 Markdownヘッダー検索リリース判定

自動確認:

- `[x]` 各Markdown leafが検索欄、query、候補・submit callbackを個別所有し、候補とEnterが開始元leafを受け取る。
- `[x]` 検索欄の表示だけでは索引準備callbackを呼ばず、実際のfocus時にだけ表示用索引を要求する。
- `[x]` Homeボタンの直後にcanonical `TFile.path`を1個だけ置き、更新・重複防止・切断leaf・unload清掃を確認する。
- `[x]` 検索hostを設置できない場合はMarkdown限定classを付けず、Obsidian標準タイトルを残す。
- `[x]` ownerDocumentが異なるsplit/pop-out相当のfake DOM、実popover祖先、非Markdown viewを分離する。
- `[x]` 118件の自動テスト、production build、公式Obsidian ESLint、`git diff --check`が成功する。
- `[x]` `package.json`、lockfile、`manifest.json`、`versions.json`を0.4.0へ揃え、厳格なRelease検証とmoderate基準の依存監査（既知脆弱性0件）が成功する。

公開結果:

- Pull Request: [#16](https://github.com/u-4/obsidian-palmwiki-home/pull/16)
- Release tag commit: `a2bb139`（タグ`0.4.0`）
- PR CI: [29251935466](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29251935466)
- Main CI: [29252020672](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29252020672)
- Release workflow: [29252133885](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29252133885)
- 公開Release: [PalmWiki Home 0.4.0](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.4.0)
- 公開成果物のSHA-256: `main.js` `abcfcdf2ca77d6152f4b2e2c9bf0dd985234ea286ea193663b9d532de13ae83d`、`manifest.json` `13b20bcd4008980fa147ea6e52e57235d503e9322e301d61dd2f233fc45cbd7a`、`styles.css` `2cbca2f971114f3ef20f7e81066377bd9f005ea674b70499dfeac87f8bf42e4e`
- `[x]` 通常のLatest Releaseとして公開され、Assetsが3成果物だけであることを確認した。
- `[x]` 公開URLから3成果物を再取得し、GitHub Digest、ローカルbuild、`PalmWiki_LocalTest`配置物のSHA-256が一致した。

`PalmWiki_LocalTest`で確認した項目（2026-07-13）:

- `[x]` Live Preview、Source mode、Reading viewで「戻る・進む → Homeボタン → 薄いパス」と中央検索欄が各1個で、中央ノートタイトルと重複するフォルダーパンくずは表示されない。
- `[x]` 狭いsplitでも左右のヘッダーが重ならず、パス要素のアクセシブル名で完全なVault相対パスを確認できる。実際のpointer hoverによるツールチップ表示は未確認。
- `[x]` Markdownの検索欄で最近のページ、曖昧候補、候補の同一leaf移動が動作する。
- `[x]` 候補未選択のEnterで同じleafに本文検索結果が表示され、Backで元ノートへ戻る。
- `[x]` `PalmWiki Home: Focus search`コマンドがactive Markdownの欄を優先し、HomeではHomeの欄をフォーカスする。
- `[ ]` 任意のホットキーを割り当てた状態でも同じフォーカス動作になる。
- `[ ]` 複数splitで別々のqueryを保ち、inactive leaf、Back/Forward、rename、ファイル切替で別leafのパスや動作を混ぜない。
- `[ ]` pop-outで入力、候補のoutside click、同一leaf遷移、ウィンドウを戻した後の重複防止が動作する。
- `[ ]` Hover Preview、Hover Editor、Canvas、設定、他custom viewへボタン・パス・検索欄・タイトル非表示を追加しない。
- `[x]` plugin無効化でReact root、候補、host、パス、限定classが消え、再有効化で各1個だけ復帰する。
- `[ ]` 2Hop Links Plusの右上ボタンと本文内表示に変化がなく、双方を個別に無効化・再有効化できる。
- `[x]` PalmWiki Homeだけを無効化・再有効化しても、2Hop Links Plusの右上ボタン1個と本文内表示が維持される。2Hop Links Plus側だけの無効化・再有効化は未確認。

## 0.2.1 Release verification

- `[x]` 設定に`Off`、`Cmd/Ctrl + hover`、`Hover`が表示され、既存設定の既定値は`Cmd/Ctrl + hover`になる。
- `[x]` `Hover`でCardの正しいMarkdownページがObsidian標準プレビューに表示され、pointerを外すと閉じる。
- `[x]` `Off`と、`Cmd/Ctrl + hover`で修飾キーを押さない通常hoverではプレビューが出ない。
- `[x]` Obsidianのページプレビュー設定に`PalmWiki Home cards`が修飾キー対象として登録される。
- `[x]` Pin上ではプレビューもPin状態変更も起きず、通常クリックは同じHomeタブだけをMarkdownへ置き換える。
- `[x]` 設定切替後も索引は維持され、56件の自動テスト、build、公式lint、metadata、diff checkが成功する。
- `[x]` 利用者操作でCard上にpointerを置き、Cmdを押し続けたときに正しいプレビューが表示されることを確認した。

公開結果:

- Pull Request: [#9](https://github.com/u-4/obsidian-palmwiki-home/pull/9)
- Release tag commit: `a27bc67`（タグ`0.2.1`）
- Main CI / PR CI: [29194543903](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29194543903)
- Release workflow: [29194603482](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29194603482)
- 公開Release: [PalmWiki Home 0.2.1](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.2.1)
- 公開成果物のSHA-256: `main.js` `aa9ba96b…fd45`、`manifest.json` `ea12c27f…f831`、`styles.css` `23bfeced…8c90`

## Compatibility status

- `[x]` macOS版Obsidian Desktop 1.12.7で0.2.1の基本機能、Homeボタン、Card/Table、同一タブ遷移、Card previewを確認した。
- `[ ]` Windows / Linuxの実機確認は未実施。確認するまで対応環境と記載しない。
- `[ ]` iOS実機のネイティブ確認は未実施。検索機能対応後に、インストール、復元、タッチ、設定、ファイル操作、バックグラウンド復帰を確認する。
- `[ ]` macOSのiPhoneミラーリングとComputer Useは、利用可能な場合に予備的な表示・タップ確認へ使用できる。ただしiOS対応判定の証拠にはしない。

## 0.3.0 本文検索リリース判定

確認環境:

- 日付: 2026-07-13
- Release branch: `codex/full-text-search`
- Obsidian: Desktop 1.12.7 / macOS
- テストVault: `PalmWiki_LocalTest`（公開候補3ファイルを配置し、既存設定と索引キャッシュを保持）
- 公開候補のSHA-256: `main.js` `d69816fd…de245`、`manifest.json` `010e1468…93e0`、`styles.css` `939d092d…fa799`

自動確認済み:

- `[x]` NFKC・大小文字、ページ名のひらがな/カタカナ、空白AND、引用符フレーズ、マイナス除外を処理する。
- `[x]` `散髪`、`気道 ガイドライン`、`レシピ トマト`の合成例で、具体的な本文/リンク証拠が日記ノイズや巨大hubより上に出る。
- `[x]` PageRank係数が最大でありながら無関係な高PageRankページを除外し、直接リンク、最大2-hop、hub減衰、最良経路、Pin同点補助が決定的に動く。密グラフでは1語あたり直接20,000辺・2-hop 50,000辺で同じ順序に打ち切る。
- `[x]` 半角カナ＋濁点、分解済み濁点、全角英数字を原文位置へ戻し、スニペットとクリック後のジャンプが同じ最良行を選ぶ。
- `[x]` 最近開いたページ、曖昧候補、最大10件、body/tag非参照、7,000ページ候補上限を検証する。
- `[x]` `search-cache.json`のschema、設定fingerprint、64 MiB境界、破損entry除外、mtime/size/path差分再利用を検証する。
- `[x]` 索引中のmodify/deleteで古い本文を公開せず、同時ensureを単一処理へまとめ、全件read失敗が自動再試行しない。
- `[x]` include/exclude変更時はHome非アクティブでも旧全文キャッシュを削除し、`.gitignore`とRelease検証で追跡を禁止する。
- `[x]` 削除済み・旧scope・破損entryを含むdisk cacheを即時削除し、削除失敗は警告して次回成功時に解除する。検索対象外ノートのイベントでは有効なcacheを維持する。
- `[x]` 長文貼り付けを最大256文字・正負合計8語で停止し、1ファイル8 MiB・対象原文64 MiB・推定RAM 128 MiBを超える全文索引は部分公開しない安全策を検証する。
- `[x]` キャッシュ保存前にentry単位で容量を数え、巨大な全体byte配列を作らず、非同期検索結果後のscroll復元と作成確認中のleaf変更を安全に扱う。
- `[x]` `npm run check`で113件の自動テスト、production build、公式Obsidian ESLint、metadata検証、差分空白検査がすべて成功する。

`PalmWiki_LocalTest`で確認する項目:

- `[x]` macOS版Obsidian Desktop 1.12.7で中央検索欄と、Back/Forward→Homeボタン→検索欄の順を確認した。
- `[ ]` 複数split・非アクティブHome・ポップアウトで各leafが独立する。
- `[x]` 空欄フォーカスで最近開いたページ、入力中にページ名の曖昧候補が出る。
- `[ ]` 素早い再入力後に古い候補をEnterで開かないことを実画面でも確認する。
- `[x]` `PalmWiki Home: Focus search`がコマンドパレットに表示され、既存Homeの検索欄へフォーカスする。Obsidian標準ホットキーを割り当て可能。
- `[x]` 候補選択は同じHome leafで開き、未選択Enterは本文検索となり、Enterだけではページを作らない。
- `[x]` `散髪`、`気道 ガイドライン`、`レシピ トマト`を実データで検索し、順位、理由badge、原文snippetが実用的であることを確認した。
- `[x]` Obsidian標準の30px固定button高を解除し、表示中100件で重なり0件、項目間隔10px、結果高148px、見出し1行、本文47px（2行）、Pin通常配置を実寸確認した。
- `[x]` Source modeで最良一致語が選択され、検索結果を表示していた同じleafで開く。
- `[ ]` Reading viewでのbest-effort移動と、別操作を先に行った場合に遅い読み込みが上書きしないことを実画面でも確認する。
- `[x]` Quick filterが本文検索結果へAND適用され、6件から1件へ絞り込まれることを確認した。
- `[ ]` folder / tag / link target filterのAND適用と、Pinが同点補助に留まることを実画面でも確認する。
- `[ ]` 100件ずつ最大500件まで追加し、上限で絞り込み案内が出て画面が固まらない。
- `[x]` 存在しない安全な名前では、Enterだけでは作成されず、作成先を示す確認画面が別に開く。確認画面をキャンセルし、ファイルが作成されないことを確認した。
- `[ ]` 全Vaultのtitle/basename/alias、除外先、unsafe名、競合先を上書きしないことを実画面でも確認する。
- `[x]` Backで検索語と結果が復元され、ForwardでMarkdownへ戻り、Markdownの左上Homeボタンでは空の新しいHome状態になる。
- `[ ]` Back/Forwardのfilter、view/sort、limit、scroll復元を実画面でも確認する。
- `[x]` `search-cache.json`が7,147件、約20 MBで保存され、schema versionと設定keyを保持することを確認した。
- `[ ]` warm再利用、変更1件だけ再読込、同時read最大2、scope変更で旧cache削除を実画面でも確認する。
- `[ ]` 破損cacheとread失敗がretry loopにならずRefreshで復旧し、64 MiB超過時は次回再構築の案内が出る。
- `[x]` plugin disable/enable後に検索欄が1個だけ再表示され、右上の2Hop Links Plusボタンへ影響しないことを確認した。
- `[ ]` plugin reload/disable後にdocument listener、idle timer、遅延ナビゲーションが残らないことを開発者ツールでも確認する。

## 0.2.0 リリース判定

確認環境:

- 日付: 2026-07-12
- Release branch: `codex/home-button-ownership`
- Pull Request: [#7](https://github.com/u-4/obsidian-palmwiki-home/pull/7)
- Release tag commit: `62e7876`（タグ`0.2.0`）
- Main CI: [29191162028](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29191162028)
- Release workflow: [29191216958](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29191216958)
- Obsidian: Desktop 1.12.7 / macOS
- テストVault: `PalmWiki_LocalTest`（コピーVault）

確認結果:

- `[x]` 利用者がテストVaultで基本機能とインターフェースに問題がないことを確認した。
- `[x]` Cardクリックが同じHomeタブでMarkdownページを開く。
- `[x]` 左ヘッダーが「戻る・進む」→PalmWiki Homeボタン→ノートタイトルの順で表示される。
- `[x]` PalmWiki Homeタブの中央タイトル文字が非表示になり、将来の検索欄用領域が残る。
- `[x]` production build、公式Obsidian ESLint、自動テスト50件、metadata検証、差分空白検査が成功する。
- `[x]` `npm ci`と`npm audit --audit-level=moderate`が成功し、既知の脆弱性が0件である。
- `[x]` 配布した`main.js`、`manifest.json`、`styles.css`のSHA-256が開発元と一致し、`data.json`と索引キャッシュを上書きしない。
- `[x]` PR CIとmain CIが成功し、タグ`0.2.0`がmainコミット`62e7876`を指す。
- `[x]` Release workflowが検証済みの3成果物だけを下書きへ添付し、全jobが成功する。
- `[x]` 下書きを通常のLatest Releaseとして公開し、公開URLから3成果物を再取得してSHA-256を照合する。
- `[ ]` ポップアウト、Hover Preview / Hover Editor、reduced motionなどの特殊条件は、下記の回帰確認項目として継続する。
- `[ ]` 起動直後の未読込・非アクティブ復元タブにおける相対ページ、ローカル見出し、文脈依存コマンドは継続確認とする。

公開結果: [PalmWiki Home 0.2.0](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.2.0)

公開成果物のSHA-256:

```text
c825710cf55057c86f2fed92de07f6ff77971648f1dc80ab111f9193f07088b3  main.js
13354511f0c91b881dd3f63e7e6f7e21a84ab6196d7b4b7f74c47a4a9a72aefd  manifest.json
23bfeced70b7f1c73e2a9efcbb16919c95ca1a7008d5bae14d4e5a2367e08c90  styles.css
```

## 0.1.0 リリース判定（必須）

この節を0.1.0の公開可否判定に使用する。後続の詳細一覧は回帰確認用の項目集であり、未確認項目が自動的に0.1.0の公開停止を意味するものではない。

確認環境:

- 日付: 2026-07-12
- Release tag commit: `ee4d684`（タグ`0.1.0`）
- Release workflow fix: `0bd3554`（PR #5、`main`へ反映済み）
- Obsidian: Desktop 1.12.7 / macOS
- テストVault: `PalmWiki_LocalTest`（コピーVault）

自動確認:

- `[x]` `npm ci`から`npm run check`まで成功する。
- `[x]` `npm audit --audit-level=moderate`が既知の脆弱性0件で成功する。
- `[x]` Obsidian公式ESLintが警告0件で成功する。
- `[x]` 自動テスト31件が全件成功する。
- `[x]` `manifest.json`、`package.json`、`package-lock.json`、`versions.json`が0.1.0 / Obsidian 1.12.7で一致する。
- `[x]` `main.js`、`manifest.json`、`styles.css`が存在し、production build、source mapなし、Git未追跡である。

Obsidian実画面:

- `[x]` 配布前バックアップが`.obsidian/plugins/`の外にあり、配布した3成果物のSHA-256が一致する。
- `[x]` `Index on startup` OFFで、Homeが非表示の起動時にfull index/cache writeが始まらない。
- `[x]` プラグイン再読み込み後、保存済みページが検証buildより先に表示される。
- `[x]` 状態が`Waiting`→`Indexing`→`Complete`と変化し、一覧は処理中も利用できる。
- `[x]` warm検証buildで未変更本文を全件読み直さない。
- `[x]` 待機中のRefreshが1回だけ実行され、後から不要な二重buildが始まらない。
- `[x]` Card/Table、PageRank/Inlinks/Outlinks、Asc/Desc、Quick filter 0件、リンク先filterがエラーなく動く。
- `[x]` PageRank上位が日記など単一hub由来だけで支配されず、PR 1.000の大量同率がない。
- `[x]` cardからnoteを開き、ribbonで既存Homeへ戻れる。
- `[x]` pin、include/exclude、表示設定が再読み込み後も保持される。
- `[x]` 破損した`index-cache.json`から起動不能にならず、再構築で復旧する。
- `[x]` PalmWiki Home由来の未処理エラー、二重build、`File not found`がない。コンソールの既存1件は別プラグイン由来。

公開物:

- `[x]` README、既知の制限、CHANGELOG、desktop-only表記を最終確認する。
- `[x]` Release verifierはタグ`0.1.0`（`v`なし）を受け付け、不正な形式をRelease作成前に拒否する。
- `[x]` Release workflowが添付する成果物は`main.js`、`manifest.json`、`styles.css`の3点だけである。
- `[x]` 実際のタグと下書きReleaseを作成し、GitHub画面で添付物を確認する。
- `[x]` Public化とRelease公開を利用者の明示承認後に実行する。
- `[x]` 公開URLから3成果物を再取得し、SHA-256と内容が検証済みArtifactに一致する。
- `[x]` `main.js`に同梱ライブラリのMIT許諾文が埋め込まれ、source mapがない。

公開結果: [PalmWiki Home 0.1.0](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.1.0)

初回の自動下書き作成は、書き込みジョブにローカルGit checkoutがないためGitHub CLIのリポジトリ判定に失敗した。検証・build・監査・Artifact保存は成功していたため、その検証済みArtifactから下書きを作成して全項目を再確認した。PR #5で`--repo`を明示し、同じ失敗を防止済み。

## Build check

- `[x]` `npm ci` を実行する。
- `[x]` `npm run build` を実行する。
- `[x]` `npm run eslint` を実行する。Obsidian公式の型情報付きESLint。
- `[x]` `git diff --check` を実行する。

## 左上Homeボタン所有機能（今回の手動確認）

- `[ ]` Live Preview、Reading view、複数split、非アクティブsplitの通常Markdownタブに、タイトルより前の左上ボタンが各1個だけ表示される。
- `[ ]` 左ヘッダーが「戻る・進む」→PalmWiki Homeボタン→ノートタイトルの順に表示される。
- `[ ]` PalmWiki Homeタブでは中央の`PalmWiki Home`タイトル文字が表示されず、中央ヘッダー領域が空いたまま残る。
- `[ ]` Canvas、設定、他のカスタムビュー、Hover Preview、Hover Editor、popoverには左上ボタンが表示されない。
- `[ ]` ラベル空欄では現在のVault名、任意ラベルではその文字列になり、表示・tooltip・読み上げ名が全対象タブへ即時反映される。
- `[ ]` `Open PalmWiki Home`で、クリック元MarkdownタブだけがHomeへ置き換わり、新規タブや別の既存Homeへ移動しない。
- `[ ]` `Open a page`で、既存ページがクリック元タブに開く。ノート名、Vault相対パス、`.md`、Wiki link、alias、headingを確認する。
- `[ ]` 空欄または存在しないHome pageでは、ファイルを作らず元のMarkdown表示を維持し、Noticeを表示する。
- `[ ]` command chooserで選択しただけでは実行されず、左上ボタンクリック時はクリック元splitがactiveになってから実行される。
- `[ ]` 未選択、無効、現在の文脈で実行不能なcommandでは表示を変えずNoticeを表示する。
- `[ ]` Home設定だけを変更しても、索引再構築やVault本文の全件読み込みが始まらない。
- `[ ]` PalmWiki HomeのCard/Tableを下へscroll後、左上ボタンで同じHomeの最上部へ戻る。reduced motion有効時も確認する。
- `[ ]` ポップアウトウィンドウでも左上ボタンの表示、動作、最上部移動が正しい。
- `[ ]` leaf close、plugin disable/reload後にPalmWikiボタンやeventが残らず、再有効化後も二重表示にならない。
- `[ ]` 2Hop Links Plus併用時も右上2-hopボタンが変化せず、2Hopを無効化してもPalmWikiの左上ボタンが機能する。
- `[ ]` Cardクリックで、そのCardを表示していたHomeタブが正しいMarkdownページへ置き換わり、タブ数と他splitは変わらない。
- `[ ]` Cardのtitle/bodyをEnter / Spaceで操作した場合も同一タブで開き、pin buttonはpinだけを切り替える。
- `[ ]` Tableの既存ページ表示動作に回帰がない。

## テスト Vault での smoke test

- `[ ]` プラグインをテスト Vault にインストールする。
- `[ ]` Obsidian でプラグインを有効化する。
- `[ ]` command palette から `PalmWiki Home: Open home` を実行する。
- `[ ]` Home view が開くことを確認する。
- `[ ]` Markdown ページが card として表示されることを確認する。
- `[ ]` card をクリックすると、そのHomeタブが正しい note へ置き換わり、新しいタブが増えないことを確認する。
- `[ ]` Table view に切り替える。
- `[ ]` 同じ note が table 形式で表示されることを確認する。
- `[ ]` updated time descending で sort する。
- `[ ]` 新しい note が古い note より前に出ることを確認する。
- `[ ]` title ascending で sort する。
- `[ ]` title sort が安定していることを確認する。
- `[ ]` Page rank sort で、PageRank値の高い note が上位に出ることを確認する。
- `[ ]` Page rank sort で、`PR 1.000` が大量に並ばないことを確認する。
- `[ ]` `日記` などのhub由来だけで上位が支配されないことを確認する。
- `[ ]` PageRank ignored source folder / pattern を設定し、PageRank順位だけが変わり、Inlinks / Outlinks count は変わらないことを確認する。
- `[ ]` Inlinks sort で、被リンク数の多い note が上位に出ることを確認する。
- `[ ]` Outlinks sort で、リンク数の多い note が上位に出ることを確認する。
- `[ ]` note を pin する。
- `[ ]` card view と table view の両方で、pin した note が上部に出ることを確認する。
- `[ ]` pin を解除する。
- `[ ]` 通常の sort 順に戻ることを確認する。
- `[ ]` `Archive` などの folder を exclude に設定する。
- `[ ]` `Archive/` 以下の note が消えることを確認する。
- `[ ]` `Notes/Anesthesia` などの folder を include に設定する。
- `[ ]` include folder 以下だけが表示され、exclude folder が優先されることを確認する。
- `[ ]` Obsidian を再読み込みする。
- `[ ]` pin と settings が保持されていることを確認する。

## コピーした実 Vault での smoke test

- `[ ]` 本番 Vault ではなく、ローカルコピーした実 Vault を開く。
- `[ ]` プラグインをインストールする。
- `[ ]` PalmWiki Home を開く。
- `[ ]` 初回 index がエラーなく完了することを確認する。
- `[ ]` 実 note 数で card view が使えることを確認する。
- `[ ]` table view が使えることを確認する。
- `[ ]` default sort が updated-desc であることを確認する。
- `[ ]` 実際の folder 名で include / exclude folder settings が効くことを確認する。
- `[ ]` よく使う note をいくつか pin し、常に上部に残ることを確認する。
- `[ ]` よくリンクされている note を link target filter で選び、その note へリンクしているページだけが出ることを確認する。
- `[ ]` link target filter を clear できることを確認する。
- `[ ]` view を何度か開閉し、重複表示や stale rendering が目立たないことを確認する。

## Edge case / hardening 確認

- `[ ]` 別 folder にある同名 note が別 card として表示される。
- `[ ]` 同名 note が sort、filter、pin 後も別々に扱われる。
- `[ ]` metadata cache がない file でも view が crash しない。
- `[ ]` frontmatter aliases がある file でも crash しない。
- `[ ]` 壊れた frontmatter がある file でも crash しない。
- `[ ]` 本文が空の file でも表示される。
- `[ ]` 存在しない image embed がある file でも、壊れた thumbnail を出さずに表示される。
- `[ ]` 非 Markdown file が Phase 1 のページ一覧に出ない。
- `[ ]` `Index on startup` を有効化しない限り、Obsidian 起動時に full index が即時実行されない。
- `[ ]` PalmWiki Home を開くと、index が dirty または空の場合に indexing が始まる。
- `[ ]` Home view を閉じた状態で Markdown を編集すると、即時 full reindex せず stale / dirty 状態になる。
- `[ ]` Home view が別 tab の裏にある状態で Markdown を編集しても、即時 full rebuild せず stale / dirty 状態になる。
- `[ ]` Home表示を契機に始まった自動build中に別tabへ移ると、次の処理区切りで停止し、Homeへ戻った時に再開される。
- `[ ]` `Index on startup`をONにしたbuildと手動Refreshは、別tabへ移っても意図どおり完了する。
- `[ ]` 起動時索引の待機中に`Index on startup`をOFFへ戻しても、Home表示中なら保存済み索引を再利用して通常のidle更新へ移る。
- `[ ]` Home tab に戻った時、既存 index の UI が先に使える状態になり、その後 dirty rebuild が走る。
- `[ ]` Obsidian起動直後はPalmWiki Homeの本文索引が始まらず、画面とタブの復元後のidle時に開始する。
- `[ ]` warm起動では保存済み索引が先に表示され、未変更のMarkdown本文を全件読み直さない。
- `[ ]` `index-cache.json`が破損または設定不一致でも、エラーで起動不能にならず通常索引へ戻る。
- `[ ]` 本文読み込みの同時実行数が2件を超えない。
- `[ ]` Home view を開いた状態で Markdown を編集すると、debounce 後に表示が更新される。
- `[ ]` Home view を開いた状態で複数の metadata / file change が連続しても、index rebuild が同時に複数本走らない。
- `[ ]` index rebuild 中に Refresh を押しても、同時 rebuild ではなく follow-up rebuild として処理される。
- `[ ]` Home表示直後の自動待機中にRefreshしても、完了後に不要な二重rebuildが始まらない。
- `[ ]` index rebuild 中にpinを切り替えても、build完了後に新しいpin状態が維持される。
- `[ ]` 既存 Home tab を command / ribbon から開く時、view が再生成されず既存 leaf が reveal される。
- `[ ]` pin 済み note を rename しても pin が維持される。
- `[ ]` pin 済みの一時 note を delete しても crash せず、古い pin が削除または無害に無視される。
- `[ ]` card 本体を mouse click すると、そのCardを表示していたHomeタブでnoteが開く。
- `[ ]` pin button を mouse click すると pin だけが切り替わり、note は開かない。
- `[ ]` card の title / body open area を keyboard で Enter / Space 操作すると同じHomeタブでnoteが開く。
- `[ ]` pin button を keyboard で Enter / Space 操作すると pin だけが切り替わり、note は開かない。
- `[ ]` card view は `Load more` なしで全 filtered page を scroll できる。
- `[ ]` card view では mounted card 数が visible range + overscan 程度に抑えられる。
- `[ ]` table view は `Load more` なしで全 filtered page を scroll できる。
- `[ ]` table view では mounted row 数が viewport + overscan 程度に抑えられる。
- `[ ]` table view の description と tags が固定行高内に収まり、行高が変動しない。
- `[ ]` Card/Table 切り替えで index rebuild log が出ない。
- `[ ]` Card/Table 切り替え後も PageRank / Inlinks / Outlinks 表示が維持される。
- `[ ]` Asc / Desc の direction だけを切り替えた時、full sort ではなく reverse 相当の軽い動作になる。
- `[ ]` pinned page が Asc / Desc のどちらでも先頭 group に残る。
- `[ ]` Page rank / Inlinks / Outlinks sort でも pinned page が先頭 group に残る。
- `[ ]` link target filter の候補は最大20件程度に抑えられ、7,000ページ規模でも入力が重くならない。
- `[ ]` link target filter の候補popoverが入力欄の下に出て、隣接controlやtoolbar layoutを崩さない。
- `[ ]` link target filter の候補popoverが Escape / outside click / selection で閉じる。
- `[ ]` folder / tag / quick / link target filters が AND 条件として組み合わさる。
- `[ ]` filter結果が0件でも、保存済み索引がある場合は索引開始待ちと誤表示されない。
- `[ ]` 大きく絞り込んだ後でも card/table virtualization の visible range が壊れず、空白表示にならない。
- `[ ]` `Index on startup` の下に永続索引キャッシュの保存内容説明と `Performance debug logging` が表示される。
- `[ ]` `Performance debug logging` を ON にすると `[PalmWiki Home perf]` の timing log が出る。
- `[ ]` `Performance debug logging` を ON にすると `graph build` と `page rank` の timing log が出る。
- `[ ]` `PageRank debug path` を設定して rebuild すると、top authority contributors が debug log に出る。
- `[ ]` sort / filter 操作だけでは `graph build` と `page rank` が再実行されない。
- `[ ]` `.obsidian/plugins` の中に `palmwiki-home.backup-*` のような古い plugin backup が残っていない。
- `[ ]` quick filter で `ＣＶＣ` が `CVC` に match するなど、全角 / 半角が正規化される。
- `[ ]` quick filter で空白区切り query が AND 条件として扱われる。

## 記録しておく観察項目

- Markdown file 数:
- 初回 index にかかった時間:
- 他 tab から PalmWiki Home に戻った時の待ち時間:
- Asc / Desc 切り替えの待ち時間:
- sort key 変更時の待ち時間:
- card / table 切り替えの待ち時間:
- 非アクティブ Home tab 中に full rebuild が走っていないこと:
- table mount window log の mountedCount:
- graph build log の node / edge / ms:
- page rank log の node / edge / ms:
- link target filter 入力時の操作感:
- image URL cache hit / miss:
- 1 file 編集後の refresh 体感:
- console error の有無:

## 大規模コピーVaultで確認済みの項目

- `[x]` 約7,000ページで、Home tabへの復帰とsort direction切り替えが実用的な速度で動作する。
- `[x]` virtual table導入後、Card/Table切り替えに目立つ引っかかりがない。
- `[x]` sort操作も軽快に動作する。
- `[x]` plugin backupを`.obsidian/plugins/`の外へ置くことで、古いplugin候補の誤検出を防げる。
- `[x]` `Index on startup` OFFで新規Vaultウィンドウを開き、復元Markdownタブ3枚に「ファイルがありません」が出ない。
- `[x]` Homeを開く前にfull index/cache writeが始まらず、保存済み7,145ページが検証buildより先に表示される。
- `[x]` warm検証buildで7,145件すべてを再利用し、本文read 0件、最大同時read 0件で完了する。
- `[x]` 1ファイルだけ状態が変わった時は7,144件を再利用し、本文read 1件だけで完了する。
- `[x]` toolbar Refreshが1回で完了し、pending follow-upや本文再readを発生させない。
- `[x]` Card/Table、PageRank/Inlinks/Outlinks、Asc/Descの切替でindex rebuildやerrorが発生しない。
- `[x]` Quick filterが0件の時に、索引開始待ちではなく「No pages match the current filters.」を表示する。
- `[x]` cardからnoteを開いた後、ribbon操作で既存Home leafが選択状態へ戻る。
