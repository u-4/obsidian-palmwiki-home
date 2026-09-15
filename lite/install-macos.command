#!/bin/bash
# Installs three verified files into the standing test Vault only. No enabling,
# settings edits, note migration, remote calls or access to other Vaults.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
SRC="$HERE/palmwiki-home-lite"
if [[ "$(uname -s)" != Darwin ]]; then echo 'This installer is for macOS.'; exit 1; fi
if /usr/bin/pgrep -x Obsidian >/dev/null; then
  echo 'Obsidianを終了してから、もう一度実行してください。'; exit 1
fi
for name in main.js manifest.json styles.css; do
  [[ -f "$SRC/$name" && ! -L "$SRC/$name" ]] || { echo "配布ファイルがありません: $name"; exit 1; }
done
[[ -f "$HERE/SHA256SUMS" ]] || { echo 'SHA256SUMSがありません。'; exit 1; }
(cd "$SRC" && /usr/bin/shasum -a 256 -c "$HERE/SHA256SUMS")
VAULT="$(/usr/bin/osascript -e 'POSIX path of (choose folder with prompt "テスト用のPalmWiki_LocalTestフォルダを選択してください。日常用Vaultは選ばないでください。")')"
VAULT="$(cd "$VAULT" && pwd -P)"
[[ "$(basename "$VAULT")" == PalmWiki_LocalTest ]] || { echo 'PalmWiki_LocalTest以外には配置しません。'; exit 1; }
[[ -d "$VAULT/.obsidian" && ! -L "$VAULT/.obsidian" ]] || { echo '通常の.obsidianフォルダを持つテストVaultではありません。'; exit 1; }
[[ ! -L "$VAULT/.obsidian/plugins" ]] || { echo 'pluginsがシンボリックリンクのため停止しました。'; exit 1; }
DEST="$VAULT/.obsidian/plugins/palmwiki-home-lite"
[[ ! -L "$DEST" ]] || { echo '配置先がシンボリックリンクのため停止しました。'; exit 1; }
for name in main.js manifest.json styles.css; do
  [[ ! -L "$DEST/$name" ]] || { echo '配置先ファイルがシンボリックリンクのため停止しました。'; exit 1; }
  [[ ! -e "$DEST/$name" || -f "$DEST/$name" ]] || { echo '配置先ファイルの種類が不正です。'; exit 1; }
done
BACKUP_ROOT="$HOME/PalmWikiHomeLite-Backups"
mkdir -p "$BACKUP_ROOT"
BACKUP="$(mktemp -d "$BACKUP_ROOT/install-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
for name in main.js manifest.json styles.css; do
  if [[ -f "$DEST/$name" ]]; then cp -p "$DEST/$name" "$BACKUP/$name"; fi
done
printf 'Destination: %s\nOnly main.js, manifest.json and styles.css were backed up. Settings are unchanged.\n' "$DEST" > "$BACKUP/restore-info.txt"
mkdir -p "$DEST"
rollback() {
  echo '配置に失敗したため、今回の3ファイルだけを元へ戻します。'
  for name in main.js manifest.json styles.css; do
    if [[ -f "$BACKUP/$name" ]]; then cp -p "$BACKUP/$name" "$DEST/$name"; else rm -f "$DEST/$name"; fi
  done
}
trap rollback ERR
for name in main.js manifest.json styles.css; do cp "$SRC/$name" "$DEST/$name"; done
(cd "$DEST" && /usr/bin/shasum -a 256 -c "$HERE/SHA256SUMS")
trap - ERR
printf '\n配置完了: %s\n退避先: %s\n' "$DEST" "$BACKUP"
echo 'ObsidianでPalmWiki_LocalTestを開き、Basesを有効にしてください。'
echo '旧PalmWiki Homeを無効、新しいPalmWiki Home Liteを有効にしてテストしてください。'
echo '戻すときはLiteを無効、旧PalmWiki Homeを有効にします。ノートと旧版の設定は変更していません。'
