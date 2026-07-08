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
function emptyEntry(step) {
  return {
    answers: steps[step].prompts.map(() => ""),
    free: ""
  };
}

function normalizeEntry(step, value) {
  if (value && typeof value === "object" && Array.isArray(value.answers)) {
    return {
      answers: steps[step].prompts.map((_, index) => value.answers[index] || ""),
      free: value.free || ""
    };
  }
  if (typeof value === "string") {
    return { answers: steps[step].prompts.map(() => ""), free: value };
  }
  return emptyEntry(step);
}

function normalizeState(raw) {
  const parsed = JSON.parse(raw || '{}');
  return {
    morning: normalizeEntry("morning", parsed.morning),
    noon: normalizeEntry("noon", parsed.noon),
    night: normalizeEntry("night", parsed.night),
    summaryDone: Boolean(parsed.summaryDone)
  };
}

let state = normalizeState(localStorage.getItem(storageKey));
let currentStep = "morning";
let recognition = null;
let isRecording = false;
let saveTimer;
let latestSummary = "";
let settingsRequired = false;

const $ = (id) => document.getElementById(id);
const memoFields = $("memoFields");
const tabs = [...document.querySelectorAll(".step-tab")];
let activeMemoInput = null;

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

function entryToText(step) {
  const entry = normalizeEntry(step, state[step]);
  const lines = steps[step].prompts.map((prompt, index) => {
    const answer = entry.answers[index]?.trim() || "（未入力）";
    return `- ${prompt}\n${answer}`;
  });
  lines.push(`- 自由記入欄\n${entry.free?.trim() || "（未入力）"}`);
  return lines.join("\n\n");
}

function entryHasText(step) {
  const entry = normalizeEntry(step, state[step]);
  return [...entry.answers, entry.free].some(value => value?.trim());
}

function buildPrompt() {
  return `以下は私の今日1日の音声メモです。\n以下の3点を整理してください。\n\n+ 今日の気づきの中で「明日以降に活かせること」\n+ 今日感じた課題の中で「AIや仕組みで解決できそうなもの」\n+ 今日の行動の中で「継続するべきこと・やめるべきこと」\n\n【朝のメモ】\n${entryToText("morning")}\n\n【昼のメモ】\n${entryToText("noon")}\n\n【夜のメモ】\n${entryToText("night")}`;
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
    const entry = normalizeEntry(step, state[step]);
    memoFields.innerHTML = [
      ...data.prompts.map((prompt, index) => `
        <div class="memo-field">
          <label for="memoInput-${index}"><span>${index + 1}</span>${prompt}</label>
          <textarea id="memoInput-${index}" data-field-type="answer" data-index="${index}" rows="4" placeholder="ここに入力してください…"></textarea>
        </div>`),
      `<div class="memo-field memo-field-free">
        <label for="memoInput-free"><span>＋</span>自由記入欄</label>
        <textarea id="memoInput-free" data-field-type="free" rows="5" placeholder="項目に収まらないことを自由に書いてください…"></textarea>
      </div>`
    ].join("");
    [...memoFields.querySelectorAll("textarea")].forEach(input => {
      if (input.dataset.fieldType === "free") input.value = entry.free || "";
      else input.value = entry.answers[Number(input.dataset.index)] || "";
      input.addEventListener("focus", () => activeMemoInput = input);
      input.addEventListener("input", handleMemoInput);
    });
    activeMemoInput = memoFields.querySelector("textarea");
    updateCount();
    const nextName = step === "morning" ? "昼" : step === "noon" ? "夜" : "まとめ";
    $("nextButton").innerHTML = `保存して${nextName}へ <span>→</span>`;
  }
}

function getCurrentEntryText() {
  const entry = normalizeEntry(currentStep, state[currentStep]);
  return [...entry.answers, entry.free].join("");
}

function updateCount() { $("charCount").textContent = `${getCurrentEntryText().length}文字`; }
function updateProgress() {
  const done = ["morning", "noon", "night"].filter(entryHasText).length + (state.summaryDone ? 1 : 0);
  $("progressText").textContent = `${done} / 4`;
  $("progressBar").style.width = `${done * 25}%`;
  tabs.forEach(tab => {
    const key = tab.dataset.step;
    tab.classList.toggle("complete", key === "summary" ? state.summaryDone : entryHasText(key));
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
    activeMemoInput ||= memoFields.querySelector("textarea");
    baseText = activeMemoInput.value + (activeMemoInput.value && !activeMemoInput.value.endsWith("\n") ? "\n" : "");
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
    activeMemoInput.value = baseText + interimText;
    handleMemoInput({ target: activeMemoInput });
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

function handleMemoInput(event) {
  const input = event.target;
  const entry = normalizeEntry(currentStep, state[currentStep]);
  if (input.dataset.fieldType === "free") entry.free = input.value;
  else entry.answers[Number(input.dataset.index)] = input.value;
  state[currentStep] = entry;
  activeMemoInput = input;
  updateCount();
  save();
}
tabs.forEach(tab => tab.addEventListener("click", () => render(tab.dataset.step)));
$("nextButton").addEventListener("click", () => {
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
      body: JSON.stringify({ morning: entryToText("morning"), noon: entryToText("noon"), night: entryToText("night") })
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
  state = { morning: emptyEntry("morning"), noon: emptyEntry("noon"), night: emptyEntry("night"), summaryDone: false };
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
