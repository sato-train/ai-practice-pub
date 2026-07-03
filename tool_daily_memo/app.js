const steps = {
  morning: {
    number: "01", badge: "MORNING NOTE", title: "朝のメモ", subtitle: "2〜3分で、今日の方向を決める",
    prompts: ["今日のタスクで一番重要なもの", "今週中に解決したいこと", "最近モヤモヤしていること"]
  },
  noon: {
    number: "02", badge: "MIDDAY NOTE", title: "昼のメモ", subtitle: "2〜3分で、午前を振り返る",
    prompts: ["午前中に意外と時間がかかったこと", "うまくいったこと・気づいたこと", "午後に集中すること"]
  },
  night: {
    number: "03", badge: "EVENING NOTE", title: "夜のメモ", subtitle: "2〜3分で、今日を手放す",
    prompts: ["今日の一番の収穫", "明日に持ち越すこと", "なんかしんどかったこと・良かったこと"]
  },
  summary: { number: "04", badge: "DAILY REVIEW", title: "今日のまとめ", subtitle: "3つのメモから、明日につながるヒントを見つける" }
};

const stepOrder = Object.keys(steps);
const todayKey = new Date().toLocaleDateString("sv-SE");
const storageKey = `daily-memo:${todayKey}`;
let state = JSON.parse(localStorage.getItem(storageKey) || '{"morning":"","noon":"","night":"","summaryDone":false}');
let currentStep = "morning";
let recognition = null;
let isRecording = false;
let saveTimer;
let latestSummary = "";
let settingsRequired = false;

const $ = (id) => document.getElementById(id);
const memoInput = $("memoInput");
const tabs = [...document.querySelectorAll(".step-tab")];

function formatDate() {
  const d = new Date();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  $("headerDate").textContent = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}  ${weekdays[d.getDay()]}曜日`;
}

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  $("saveStatus").textContent = "保存しました";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => $("saveStatus").textContent = "入力内容は自動保存されます", 1500);
  updateProgress();
}

function buildPrompt() {
  return `以下は私の今日1日の音声メモです。\n以下の3点を整理してください。\n\n+ 今日の気づきの中で「明日以降に活かせること」\n+ 今日感じた課題の中で「AIや仕組みで解決できそうなもの」\n+ 今日の行動の中で「継続するべきこと・やめるべきこと」\n\n【朝のメモ】\n${state.morning || "（未入力）"}\n\n【昼のメモ】\n${state.noon || "（未入力）"}\n\n【夜のメモ】\n${state.night || "（未入力）"}`;
}

function render(step) {
  if (isRecording) stopRecording();
  currentStep = step;
  const data = steps[step];
  $("timeBadge").textContent = data.badge;
  $("panelTitle").textContent = data.title;
  $("panelDuration").textContent = data.subtitle;
  $("stepNumber").textContent = data.number;
  tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.step === step));

  const isSummary = step === "summary";
  $("entryView").hidden = isSummary;
  $("summaryView").hidden = !isSummary;
  if (isSummary) {
    $("summaryPreview").innerHTML = latestSummary ? renderMarkdown(latestSummary) : "";
    $("summaryPreview").classList.toggle("rendered", Boolean(latestSummary));
  } else {
    $("prompts").innerHTML = data.prompts.map((p, i) => `<div class="prompt"><span>${i+1}</span>${p}</div>`).join("");
    memoInput.value = state[step] || "";
    updateCount();
    const nextName = step === "morning" ? "昼" : step === "noon" ? "夜" : "まとめ";
    $("nextButton").innerHTML = `保存して${nextName}へ <span>→</span>`;
  }
}

function updateCount() { $("charCount").textContent = `${memoInput.value.length}文字`; }
function updateProgress() {
  const done = ["morning", "noon", "night"].filter(key => state[key]?.trim()).length + (state.summaryDone ? 1 : 0);
  $("progressText").textContent = `${done} / 4`;
  $("progressBar").style.width = `${done * 25}%`;
  tabs.forEach(tab => {
    const key = tab.dataset.step;
    tab.classList.toggle("complete", key === "summary" ? state.summaryDone : Boolean(state[key]?.trim()));
  });
}

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
}

function renderMarkdown(markdown) {
  markdown = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const escape = (value) => value
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const inline = (value) => escape(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let list = null;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { closeList(); const level = heading[1].length; html.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    const bullet = line.match(/^[-+*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (list !== type) { closeList(); list = type; html.push(`<${type}>`); }
      html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.join("");
}

function openSettings(required = false, currentValue = "") {
  settingsRequired = required;
  $("saveDirectoryInput").value = currentValue;
  $("settingsError").textContent = "";
  $("cancelSettingsButton").hidden = required;
  $("settingsOverlay").hidden = false;
  setTimeout(() => $("saveDirectoryInput").focus(), 0);
}

function closeSettings() {
  if (!settingsRequired) $("settingsOverlay").hidden = true;
}

function setupSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $("recordButton").disabled = true;
    $("recordButton").style.opacity = ".45";
    $("voiceNote").textContent = "このブラウザは音声入力に対応していません。手入力をご利用ください。";
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = "ja-JP";
  recognition.continuous = true;
  recognition.interimResults = true;
  let baseText = "";
  recognition.onstart = () => {
    isRecording = true;
    baseText = memoInput.value + (memoInput.value && !memoInput.value.endsWith("\n") ? "\n" : "");
    $("recordButton").classList.add("recording");
    $("recordLabel").textContent = "音声入力を停止する";
    $("voiceNote").textContent = "聞いています。自然に話してください。";
  };
  recognition.onresult = (event) => {
    let finalText = "", interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += text;
      else interimText += text;
    }
    if (finalText) baseText += finalText;
    memoInput.value = baseText + interimText;
    state[currentStep] = memoInput.value;
    updateCount();
    save();
  };
  recognition.onerror = (event) => {
    if (event.error !== "no-speech" && event.error !== "aborted") showToast("音声を認識できませんでした。マイク設定をご確認ください。");
  };
  recognition.onend = () => {
    isRecording = false;
    $("recordButton").classList.remove("recording");
    $("recordLabel").textContent = "音声入力をはじめる";
    $("voiceNote").textContent = "マイクへのアクセスを許可すると、話した内容がテキストになります。";
  };
}

function stopRecording() { if (recognition && isRecording) recognition.stop(); }

memoInput.addEventListener("input", () => {
  state[currentStep] = memoInput.value;
  updateCount();
  save();
});
tabs.forEach(tab => tab.addEventListener("click", () => render(tab.dataset.step)));
$("nextButton").addEventListener("click", () => {
  state[currentStep] = memoInput.value;
  save();
  const next = stepOrder[stepOrder.indexOf(currentStep) + 1];
  render(next);
  $("memoPanel").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("recordButton").addEventListener("click", () => isRecording ? stopRecording() : recognition?.start());
$("copyButton").addEventListener("click", async () => {
  if (!latestSummary) { showToast("先にAIでメモを整理してください"); return; }
  try {
    await navigator.clipboard.writeText(latestSummary);
    showToast("AIの整理結果をコピーしました");
  } catch { showToast("コピーできませんでした。テキストを選択してコピーしてください。"); }
});
$("summarizeButton").addEventListener("click", async () => {
  const button = $("summarizeButton");
  button.disabled = true;
  button.innerHTML = "Codexが整理しています…";
  $("apiStatus").className = "api-status";
  $("apiStatus").textContent = "Codexへ送信しています…";
  try {
    const response = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ morning: state.morning, noon: state.noon, night: state.night })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "処理に失敗しました。");
    latestSummary = result.markdown || result.summary;
    $("summaryPreview").innerHTML = renderMarkdown(latestSummary);
    $("summaryPreview").classList.add("rendered");
    $("apiStatus").className = "api-status ready";
    $("apiStatus").textContent = `保存しました: ${result.savedPath}`;
    state.summaryDone = true; save();
    showToast("Codexの整理とMarkdown保存が完了しました");
  } catch (error) {
    $("apiStatus").className = "api-status error";
    $("apiStatus").textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = "Codexで整理して保存 <span>✦</span>";
  }
});
$("resetButton").addEventListener("click", () => {
  if (!confirm("今日のメモをすべて消去しますか？この操作は元に戻せません。")) return;
  state = { morning: "", noon: "", night: "", summaryDone: false };
  save(); render("morning"); showToast("今日のメモをリセットしました");
});

formatDate();
setupSpeech();
updateProgress();
render("morning");

fetch("/api/status")
  .then(response => response.json())
  .then(status => {
    $("apiStatus").className = `api-status ${status.codexAvailable ? "ready" : "error"}`;
    $("apiStatus").textContent = status.codexAvailable
      ? `${status.provider} / 保存先: ${status.saveDirectory || "未設定"}`
      : "Codex CLIが見つかりません。";
    if (!status.saveDirectoryConfigured) openSettings(true);
    else $("saveDirectoryInput").value = status.saveDirectory;
  })
  .catch(() => {
    $("apiStatus").className = "api-status error";
    $("apiStatus").textContent = "APIサーバーに接続できません。ショートカットから起動してください。";
  });

fetch("/api/today")
  .then(response => response.json())
  .then(result => {
    if (!result.exists) return;
    latestSummary = result.markdown;
    $("summaryPreview").innerHTML = renderMarkdown(latestSummary);
    $("summaryPreview").classList.add("rendered");
    $("apiStatus").className = "api-status ready";
    $("apiStatus").textContent = `読み込みました: ${result.path}`;
    state.summaryDone = true;
    save();
  })
  .catch(() => {});

$("settingsButton").addEventListener("click", async () => {
  try {
    const status = await fetch("/api/status").then(response => response.json());
    openSettings(false, status.saveDirectory || "");
  } catch { openSettings(false); }
});

$("cancelSettingsButton").addEventListener("click", closeSettings);
$("browseDirectoryButton").addEventListener("click", async () => {
  const button = $("browseDirectoryButton");
  button.disabled = true;
  button.textContent = "選択中…";
  $("settingsError").textContent = "";
  try {
    const response = await fetch("/api/browse-directory", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "フォルダを選択できませんでした。");
    if (result.selected) $("saveDirectoryInput").value = result.path;
  } catch (error) {
    $("settingsError").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "フォルダを選択";
  }
});
$("saveSettingsButton").addEventListener("click", async () => {
  const button = $("saveSettingsButton");
  const saveDirectory = $("saveDirectoryInput").value.trim();
  if (!saveDirectory) { $("settingsError").textContent = "保存先を入力してください。"; return; }
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saveDirectory })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "設定を保存できませんでした。");
    settingsRequired = false;
    $("settingsOverlay").hidden = true;
    $("apiStatus").className = "api-status ready";
    $("apiStatus").textContent = `Codex CLI / ChatGPT / 保存先: ${result.saveDirectory}`;
    showToast("保存先を設定しました");
  } catch (error) {
    $("settingsError").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "保存して始める";
  }
});
