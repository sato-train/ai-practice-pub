# Daily Memo

朝・昼・夜の短い音声メモを記録し、一日分のAI整理用プロンプトを作るブラウザアプリです。

## 起動

CodexへChatGPTアカウントでログインした状態で、デスクトップの「Daily Memo 起動」をダブルクリックします。終了するときは「Daily Memo 停止」をダブルクリックします。

初回起動時にMarkdownの保存先設定が必須です。「フォルダを選択」からWindowsのフォルダ選択画面を開けます。設定後は画面右上の歯車ボタンから変更できます。設定内容は `%LOCALAPPDATA%\DailyMemo\config.json` に保存されます。Codexの整理結果は画面上でMarkdownとして整形表示されます。

PowerShellから直接起動する場合は、次を実行します。

```powershell
.\launch-app.ps1
```

入力内容は日付ごとにブラウザの `localStorage` へ保存され、外部には送信されません。

「Codexで整理して保存」を実行した場合のみ、朝・昼・夜のメモがCodexへ送信されます。整理結果は `H:\マイドライブ\Obsidian\docs\daily_memo\YYYY-MM-DD.md` に保存されます。
