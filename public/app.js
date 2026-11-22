// 傾斜計修理 引継ぎツール：画面（S-01〜S-06）
import {
  MODELS, MODEL_INFO, TOLERANCE, ANGLE_BASES, ANGLE_POSES, AGING_TIME,
  PARTS, PART_SETS, TOOLS, PROCEDURES, WATERPROOF, NG_GUIDE,
} from "./config.js";
import {
  CHECK_ITEMS, DIAGNOSES, diagnose, step1Progress, step2Done, appendPartToMemo,
  judgeAngle, formatError, lockState,
} from "./logic.js";

const STEP_NAMES = { 1: "① 初期診断", 2: "② 部品手配", 3: "③ 修理作業", 4: "④ 動作確認" };
const STATUS_COLOR = { 作業中: "blue", 部品待ち: "orange", 完了: "green" };

const app = document.getElementById("app");
const saveStateEl = document.getElementById("save-state");
const workerInput = document.getElementById("worker");

// ---------- 小さな道具 ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const caseNo = (id) => `C-${String(id).padStart(4, "0")}`;
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const fmtTime = (d) => d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const statusBadge = (s) => `<span class="badge ${STATUS_COLOR[s] || "gray"}">${esc(s)}</span>`;
const modelInfo = (c) => MODEL_INFO[c.model_name] || {};

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } },
};
workerInput.value = storage.get("worker") || "";
workerInput.addEventListener("input", () => storage.set("worker", workerInput.value.trim()));
const getWorker = () => workerInput.value.trim();

function setSaveState(msg, isError = false) {
  saveStateEl.textContent = msg;
  saveStateEl.classList.toggle("error", isError);
}

async function api(method, path, body, { keepalive = false } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    keepalive,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `通信エラー（${res.status}）`), { status: res.status, data });
  return data;
}

// ---------- 状態 ----------
let current = null;   // 開いている案件
let viewStep = 1;     // 表示中の工程
let tmpVoltage = "";  // ① 電源電圧（参考入力・保存しない）
let tmp4 = null;      // ④ 準備チェック・エージング時刻・角度（保存しない：仕様書 3.2）
const listState = { status: "作業中", q: "" };
const freshTmp4 = () => ({ connect: false, software: false, agingStart: null, agingEnd: null, angles: Object.fromEntries(ANGLE_BASES.map((b) => [b, ""])) });

// ---------- 自動保存（C-06） ----------
let pending = {};
let pendingId = null;
let saveTimer = null;
let chain = Promise.resolve(true);

function save(patch, { debounce = false } = {}) {
  if (!current) return Promise.resolve(false);
  if (pendingId !== null && pendingId !== current.id) flush();
  Object.assign(current, patch);
  pending = { ...pending, ...patch };
  pendingId = current.id;
  clearTimeout(saveTimer);
  if (debounce) {
    setSaveState("入力中…");
    saveTimer = setTimeout(() => flush(), 700);
    return chain;
  }
  return flush();
}

function flush(keepalive = false) {
  clearTimeout(saveTimer);
  if (!Object.keys(pending).length) return chain;
  const id = pendingId;
  const body = { ...pending, worker: getWorker() };
  pending = {};
  setSaveState("保存中…");
  chain = chain.then(async () => {
    try {
      const updated = await api("PATCH", `/cases/${id}`, body, { keepalive });
      if (current && current.id === id) {
        current.notes_updated_at = updated.notes_updated_at;
        current.notes_updated_by = updated.notes_updated_by;
        const meta = document.getElementById("notes-meta");
        if (meta) meta.textContent = notesMeta(current);
      }
      setSaveState(`保存しました ${fmtTime(new Date())}`);
      return true;
    } catch (e) {
      setSaveState(`保存できませんでした：${e.message}`, true);
      return false;
    }
  });
  return chain;
}
// タブを閉じる・画面を離れるときも残す
addEventListener("pagehide", () => flush(true));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });

// ---------- 画面の切り替え ----------
async function route() {
  await flush();
  const h = location.hash.replace(/^#/, "") || "/";
  let m;
  try {
    if (h === "/") return await renderList();
    if (h === "/new") return renderNew();
    if ((m = h.match(/^\/case\/(\d+)\/([1-4])$/))) return await openCase(Number(m[1]), Number(m[2]));
    location.replace("#/");
  } catch (e) {
    app.innerHTML = `<div class="alert"><h3>表示できませんでした</h3><p>${esc(e.message)}</p><a class="btn" href="#/">案件一覧に戻る</a></div>`;
  }
}
addEventListener("hashchange", route);
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

// ======================================================================
// S-01 案件一覧
// ======================================================================
async function renderList() {
  current = null;
  document.title = "案件一覧 | 傾斜計修理 引継ぎツール";
  const filters = [["作業中", "作業中"], ["部品待ち", "部品待ち"], ["完了", "完了"], ["", "すべて"]];
  app.innerHTML = `
    <div class="list-top">
      <h1>案件一覧</h1>
      <a class="btn primary big" href="#/new">＋ 新規受付</a>
    </div>
    <form class="search" id="search-form" role="search">
      <label for="q" class="small">シリアルナンバーで検索</label>
      <input type="search" id="q" value="${esc(listState.q)}" placeholder="例：0002" autocomplete="off">
      <button class="btn" type="submit">検索</button>
    </form>
    <div class="filters" role="group" aria-label="ステータスで絞り込み">
      ${filters.map(([v, l]) => `<button type="button" class="btn filter" data-action="filter" data-status="${v}" aria-pressed="${listState.status === v}">${l}</button>`).join("")}
    </div>
    <div id="cards" class="cards" aria-live="polite"><p>読み込み中…</p></div>`;
  await loadCards();
}

async function loadCards() {
  const el = document.getElementById("cards");
  const params = new URLSearchParams();
  if (listState.status) params.set("status", listState.status);
  if (listState.q) params.set("q", listState.q);
  try {
    const { cases } = await api("GET", `/cases?${params}`);
    el.innerHTML = cases.length ? cases.map(caseCard).join("") : `<p class="empty">該当する案件がありません。</p>`;
  } catch (e) {
    el.innerHTML = `<div class="alert"><p>${esc(e.message)}</p></div>`;
  }
}

function bars(c) {
  return `<div class="bars" role="img" aria-label="工程の進み具合：${esc(STEP_NAMES[c.current_step])}">${[1, 2, 3, 4]
    .map((n) => {
      const st = c.status === "完了" || n < c.current_step ? "done" : n === c.current_step ? (c.status === "部品待ち" ? "wait" : "now") : "todo";
      return `<span class="bar ${st}"></span>`;
    })
    .join("")}</div>`;
}

function caseCard(c) {
  const stepText =
    c.status === "完了" ? `修理完了 ${fmtDateTime(c.completed_at)}`
    : c.status === "部品待ち" ? `${STEP_NAMES[2]}／入荷予定：${c.expected_arrival_date || "未定"}`
    : STEP_NAMES[c.current_step];
  const head = (c.notes || "").replace(/\s+/g, " ").trim();
  const done = c.status === "完了";
  return `<article class="card">
    <div class="small muted">${caseNo(c.id)}　受付 ${esc(c.created_at)}</div>
    <div class="card-serial">${esc(c.serial_number)}</div>
    <div>${esc(c.model_name)}</div>
    ${bars(c)}
    <div class="card-step">${esc(stepText)} ${statusBadge(c.status)}</div>
    <p class="card-notes">${head ? `申し送り：${esc(head.slice(0, 60))}${head.length > 60 ? "…" : ""}` : `<span class="muted">申し送りなし</span>`}</p>
    <a class="btn ${done ? "" : "primary"}" href="#/case/${c.id}/${done ? 4 : c.current_step}">${done ? "内容を見る" : "続きから作業"}</a>
  </article>`;
}

// ======================================================================
// S-02 新規受付
// ======================================================================
function renderNew() {
  current = null;
  document.title = "新規受付 | 傾斜計修理 引継ぎツール";
  app.innerHTML = `
    <h1>新規受付</h1>
    <form id="new-form" class="panel" novalidate>
      <div class="field">
        <label for="serial">シリアルナンバー<span class="req">必須</span></label>
        <input type="text" id="serial" maxlength="100" autocomplete="off" aria-describedby="err-serial">
        <p class="error" id="err-serial" hidden></p>
        <div id="history" aria-live="polite"></div>
      </div>
      <div class="field">
        <label for="model">機種名<span class="req">必須</span></label>
        <select id="model" aria-describedby="err-model">
          <option value="">選んでください</option>
          ${MODELS.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}
        </select>
        <p class="error" id="err-model" hidden></p>
      </div>
      <div class="field">
        <label for="created">受付日</label>
        <input type="date" id="created" value="${todayStr()}" aria-describedby="err-created">
        <p class="error" id="err-created" hidden></p>
      </div>
      <div class="field">
        <label for="init-notes">受付時の申し送り<span class="opt">任意</span></label>
        <textarea id="init-notes" rows="3" maxlength="5000" placeholder="お客様からの症状の連絡など"></textarea>
      </div>
      <div class="actions">
        <a class="btn" href="#/">キャンセル</a>
        <button class="btn primary" type="submit" id="new-submit">登録して初期診断へ</button>
      </div>
    </form>`;
  document.getElementById("serial").focus();
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

let historyTimer = null;
function lookupHistory(serial) {
  clearTimeout(historyTimer);
  const el = document.getElementById("history");
  const s = serial.trim();
  if (!s) { el.innerHTML = ""; return; }
  historyTimer = setTimeout(async () => {
    try {
      const { cases } = await api("GET", `/cases?serial=${encodeURIComponent(s)}`);
      if (document.getElementById("serial")?.value.trim() !== s) return;
      el.innerHTML = cases.length
        ? `<div class="history"><strong>このシリアルの過去の案件（${cases.length}件）</strong><ul>${cases
            .map((c) => `<li><a href="#/case/${c.id}/${c.status === "完了" ? 4 : c.current_step}">${caseNo(c.id)}</a>　受付 ${esc(c.created_at)}　${esc(c.model_name)}　${esc(c.diagnosis_result || "故障原因未確定")}　${statusBadge(c.status)}</li>`)
            .join("")}</ul></div>`
        : "";
    } catch { el.innerHTML = ""; }
  }, 300);
}

async function submitNew() {
  const serial = document.getElementById("serial").value.trim();
  const model = document.getElementById("model").value;
  const created = document.getElementById("created").value;
  showError("err-serial", serial ? "" : "シリアルナンバーを入力してください");
  showError("err-model", model ? "" : "機種を選んでください");
  showError("err-created", created ? "" : "受付日を入力してください");
  if (!serial) return document.getElementById("serial").focus();
  if (!model) return document.getElementById("model").focus();
  if (!created) return document.getElementById("created").focus();
  const btn = document.getElementById("new-submit");
  btn.disabled = true;
  try {
    const c = await api("POST", "/cases", {
      serial_number: serial, model_name: model, created_at: created,
      notes: document.getElementById("init-notes").value, worker: getWorker(),
    });
    go(`#/case/${c.id}/1`);
  } catch (e) {
    const errs = e.data?.errors || {};
    showError("err-serial", errs.serial_number);
    showError("err-model", errs.model_name);
    showError("err-created", errs.created_at || (!Object.keys(errs).length ? e.message : ""));
    btn.disabled = false;
  }
}

// ======================================================================
// 工程画面（S-03〜S-06）の共通部分
// ======================================================================
async function openCase(id, step) {
  current = await api("GET", `/cases/${id}`);
  const maxStep = current.status === "完了" ? 4 : current.current_step;
  if (step > maxStep) { location.replace(`#/case/${id}/${maxStep}`); return; }
  viewStep = step;
  tmpVoltage = "";
  if (step === 4) tmp4 = freshTmp4();
  renderCase();
  scrollTo(0, 0);
}

function renderCase() {
  const c = current;
  const ro = c.status === "完了";
  document.title = `${c.serial_number} ${STEP_NAMES[viewStep]} | 傾斜計修理 引継ぎツール`;
  const body = { 1: step1, 2: step2, 3: step3, 4: step4 }[viewStep](c, ro);
  app.innerHTML = `${caseBar(c)}${stepper(c)}<div class="layout"><div class="main">${body}</div>${handover(c, ro)}</div>`;
}

function caseBar(c) {
  return `<section class="casebar" aria-label="案件情報">
    <div><div class="small muted">シリアルナンバー</div><div class="serial">${esc(c.serial_number)}</div></div>
    <dl class="casemeta">
      <div><dt>機種</dt><dd>${esc(c.model_name)}</dd></div>
      <div><dt>案件ID</dt><dd>${caseNo(c.id)}</dd></div>
      <div><dt>受付日</dt><dd>${esc(c.created_at)}</dd></div>
      <div><dt>ステータス</dt><dd>${statusBadge(c.status)}</dd></div>
    </dl>
    <div class="manual-tag">表示中のマニュアル：${esc(c.model_name)} 用</div>
  </section>`;
}

function stepper(c) {
  return `<nav class="stepper" aria-label="工程">${[1, 2, 3, 4]
    .map((n) => {
      // 完了＝その工程を抜けていて必須チェックも済んでいる。抜けた後に未完了へ戻った工程は「要確認」
      const passed = n < c.current_step;
      const done = c.status === "完了" || (passed && !!c[`step${n}_checked`]?.done);
      const reachable = c.status === "完了" || n <= c.current_step;
      const state = done ? "done" : n === c.current_step ? "now" : "todo";
      const label = done ? "完了" : state === "now" ? (c.status === "部品待ち" ? "部品待ち" : "作業中") : passed ? "要確認" : "未着手";
      return `<button type="button" class="step ${state}${n === viewStep ? " current" : ""}" data-action="goto-step" data-step="${n}" ${reachable ? "" : "disabled"} ${n === viewStep ? 'aria-current="step"' : ""}>
        <span class="step-mark" aria-hidden="true">${done ? "✓" : n}</span>
        <span class="step-name">${STEP_NAMES[n].slice(2)}</span>
        <span class="step-state">${label}</span>
      </button>`;
    })
    .join("")}</nav>`;
}

function notesMeta(c) {
  return c.notes_updated_at ? `最終更新：${fmtDateTime(c.notes_updated_at)}　${c.notes_updated_by || "（作業者名なし）"}` : "最終更新：まだありません";
}

function handover(c, ro) {
  return `<aside class="handover" aria-label="引継ぎ">
    <h2>引継ぎ</h2>
    <dl>
      <dt>故障原因</dt><dd id="side-diag">${esc(c.diagnosis_result || "未確定")}</dd>
      <dt>交換部品</dt><dd id="side-parts" class="pre">${c.used_parts_memo ? esc(c.used_parts_memo) : `<span class="muted">なし</span>`}</dd>
    </dl>
    <label for="notes" class="label">作業・引継ぎメモ</label>
    <textarea id="notes" data-field="notes" rows="8" maxlength="5000" ${ro ? "disabled" : ""} placeholder="次の人に伝えること（例：エージング中、部品の入荷連絡待ち など）">${esc(c.notes)}</textarea>
    <p class="small muted" id="notes-meta">${esc(notesMeta(c))}</p>
    ${getWorker() ? "" : `<p class="small" style="color:var(--orange);font-weight:700">画面上の「作業者」に名前を入れると、メモの最終更新に名前が残ります。</p>`}
  </aside>`;
}

function footer({ progress, reason, nextLabel, nextAction, nextEnabled, ro, extra = "" }) {
  if (ro) {
    return `<div class="step-footer"><div class="actions"><a class="btn" href="#/">案件一覧に戻る</a></div></div>`;
  }
  return `<div class="step-footer">
    <div class="progress">${progress}</div>
    ${reason ? `<p class="reason" role="status">${esc(reason)}</p>` : `<p class="small" role="status" style="color:var(--green);font-weight:700;margin:4px 0 8px">必須チェックがそろいました</p>`}
    <div class="actions">
      <button type="button" class="btn" data-action="suspend">一時保存して中断</button>
      ${extra}
      <button type="button" class="btn primary" data-action="${nextAction}" ${nextEnabled ? "" : "disabled"}>${nextLabel}</button>
    </div>
  </div>`;
}

function photo(src, caption) {
  return `<figure class="photo">${src ? `<img src="${esc(src)}" alt="${esc(caption)}">` : `<div class="ph" role="img" aria-label="${esc(caption)}（写真準備中）">写真準備中<br>${esc(caption)}</div>`}<figcaption>${esc(caption)}</figcaption></figure>`;
}

// ======================================================================
// S-03 工程① 初期診断
// ======================================================================
function step1(c, ro) {
  const items = c.step1_checked.items || {};
  const g = diagnose(items);
  const p = step1Progress(items, c.diagnosis_result);
  const info = modelInfo(c);
  return `
    <section>
      <h2>① 初期診断</h2>
      ${info.manualUrl ? `<p><a href="${esc(info.manualUrl)}" target="_blank" rel="noopener">${esc(c.model_name)} の診断マニュアルを開く</a></p>` : ""}
      <p class="small muted">すべての項目を「押して選ぶ」で入力してください。</p>
      ${CHECK_ITEMS.map((it) => `
        <div class="check-row">
          <div class="check-label"><span class="tag">${it.group}</span>${esc(it.label)}</div>
          <div class="choice" role="group" aria-label="${esc(it.label)}">
            <button type="button" class="choice-btn ok" data-action="s1-set" data-key="${it.key}" data-val="ok" aria-pressed="${items[it.key] === "ok"}" ${ro ? "disabled" : ""}>${it.ok}</button>
            <button type="button" class="choice-btn ng" data-action="s1-set" data-key="${it.key}" data-val="ng" aria-pressed="${items[it.key] === "ng"}" ${ro ? "disabled" : ""}>${it.ng}</button>
          </div>
        </div>`).join("")}
      <div class="field" style="margin-top:16px">
        <label for="voltage">電源電圧（参考入力・保存しません）</label>
        <input type="number" id="voltage" step="0.01" inputmode="decimal" value="${esc(tmpVoltage)}" style="width:10em" ${ro ? "disabled" : ""}> V
        <span class="small muted">規定値：${esc(info.voltage || "[規定値]")}</span>
      </div>
    </section>
    <section class="guide" id="guide" aria-live="polite">
      <h2>切り分けガイド</h2>
      ${g.patterns.length
        ? g.patterns.map((pt) => `<div class="pattern"><strong>${esc(pt.title)}</strong> → ${esc(pt.action)}<div class="small">根拠：${esc(pt.reasons.join("、"))}</div></div>`).join("")
        : `<p>${esc(g.message)}</p>`}
    </section>
    <section>
      <div class="field" style="margin:0">
        <label for="diag">特定した故障原因<span class="req">必須</span></label>
        ${g.suggestion ? `<p class="suggest">自動提案：${esc(g.patterns[0].title)}</p>` : ""}
        <select id="diag" ${ro ? "disabled" : ""}>
          <option value="">選んでください</option>
          ${DIAGNOSES.map((d) => `<option value="${esc(d)}" ${c.diagnosis_result === d ? "selected" : ""}>${esc(d)}</option>`).join("")}
        </select>
      </div>
    </section>
    ${footer({
      ro,
      progress: `必須チェック ${p.filled} / ${p.total} 入力済み`,
      reason: p.remaining ? `未入力があと ${p.remaining} 項目あります` : !c.diagnosis_result ? "故障原因を選んでください" : "",
      nextLabel: "② 部品手配へ",
      nextAction: "s1-next",
      nextEnabled: p.done,
    })}`;
}

/** 故障原因が変わったら、② の完了状態を新しい部品リストで計算し直す */
function withStep2Recalc(patch, diagnosis) {
  const s2 = current.step2_checked || { done: false };
  const names = (PART_SETS[diagnosis] || []).map((p) => p.name);
  const done = !!diagnosis && step2Done(names, s2.prepared || {});
  if (done !== !!s2.done) patch.step2_checked = { ...s2, done };
  return patch;
}

function s1SetItem(key, val) {
  const s1 = current.step1_checked || {};
  const items = { ...(s1.items || {}), [key]: val };
  const g = diagnose(items);
  // 故障原因：自動提案で入れた値は提案に合わせて入れ替える。作業者が選んだ値はそのまま
  let diag = current.diagnosis_result || "";
  const auto = !diag || !!s1.diag_auto;
  if (auto) diag = g.suggestion || "";
  const patch = {};
  if ((diag || null) !== (current.diagnosis_result || null)) patch.diagnosis_result = diag || null;
  patch.step1_checked = { done: step1Progress(items, diag).done, items, diag_auto: auto && !!diag };
  save(withStep2Recalc(patch, diag));
  renderCase();
}

function s1SetDiagnosis(value) {
  const s1 = current.step1_checked || {};
  const items = s1.items || {};
  const patch = {
    diagnosis_result: value || null,
    step1_checked: { done: step1Progress(items, value).done, items, diag_auto: false },
  };
  save(withStep2Recalc(patch, value));
  renderCase();
}

// ======================================================================
// S-04 工程② 部品手配
// ======================================================================
function partsFor(c) {
  return (PART_SETS[c.diagnosis_result] || []).map((p) => ({ ...p, ...(PARTS[p.name] || { shelf: "—", stock: "あり" }) }));
}
const stockBadge = (s) => `<span class="badge ${s === "在庫切れ" ? "red" : s === "残りわずか" ? "orange" : "green"}">${esc(s)}</span>`;

function step2(c, ro) {
  if (!c.diagnosis_result) {
    return `<section><h2>② 部品手配</h2><p class="notice">先に ① 初期診断で故障原因を選んでください。</p></section>`;
  }
  const parts = partsFor(c);
  const s2 = c.step2_checked || {};
  const prepared = s2.prepared || {};
  const proc = c.status === "部品待ち" ? "order" : s2.procurement || "stock";
  const out = parts.filter((p) => p.stock === "在庫切れ");
  const n = parts.filter((p) => prepared[p.name]).length;
  const remaining = parts.length - n;

  let reason = "";
  if (proc === "order") reason = "部品発注中のため ③ には進めません。入荷したら「在庫あり」に切り替えてください";
  else if (remaining) reason = `未入力があと ${remaining} 項目あります（「用意した」が未チェックの部品）`;

  return `
    <section>
      <h2>② 部品手配</h2>
      <p>故障原因「<strong>${esc(c.diagnosis_result)}</strong>」の必要部品です。</p>
      ${parts.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>部品名</th><th>数量</th><th>保管棚</th><th>在庫目安</th><th>用意した</th></tr></thead>
        <tbody>${parts.map((p, i) => `
          <tr>
            <td><strong>${esc(p.name)}</strong></td>
            <td>${esc(p.qty)}</td>
            <td>${esc(p.shelf)}</td>
            <td>${stockBadge(p.stock)}</td>
            <td><label class="check"><input type="checkbox" data-action="s2-prep" data-name="${esc(p.name)}" ${prepared[p.name] ? "checked" : ""} ${ro ? "disabled" : ""} aria-label="${esc(p.name)} を用意した"><span>用意した</span></label></td>
          </tr>`).join("")}
        </tbody>
      </table></div>` : `<p class="notice">この故障原因には決まった部品がありません。使う部品は下の「交換部品メモ」に書いてください。</p>`}
      ${out.length ? `
      <div class="alert" role="alert">
        <h3>在庫切れの部品があります：発注してください</h3>
        ${out.map((p) => `
          <dl class="small" style="margin:8px 0">
            <dt style="font-weight:700;font-size:18px">${esc(p.name)}</dt>
            <dd style="margin:0">発注先：${esc(p.vendor)}　／　承認ルート：${esc(p.approval)}　／　品番：${esc(p.partNo)}　／　標準納期：${esc(p.leadTime)}</dd>
          </dl>`).join("")}
      </div>` : ""}
    </section>
    <section>
      <h2>手配状況</h2>
      <div class="choice" role="radiogroup" aria-label="手配状況">
        <button type="button" class="choice-btn ok" role="radio" data-action="s2-proc" data-val="stock" aria-pressed="${proc === "stock"}" aria-checked="${proc === "stock"}" ${ro ? "disabled" : ""}>在庫あり（すぐ作業できる）</button>
        <button type="button" class="choice-btn ng" role="radio" data-action="s2-proc" data-val="order" aria-pressed="${proc === "order"}" aria-checked="${proc === "order"}" ${ro ? "disabled" : ""}>部品発注中（入荷待ち）</button>
      </div>
      ${proc === "order" ? `
      <div class="field" style="margin-top:16px">
        <label for="arrival">入荷予定日<span class="req">必須</span></label>
        <input type="date" id="arrival" min="${esc(c.created_at)}" value="${esc(c.expected_arrival_date || "")}" ${ro ? "disabled" : ""} aria-describedby="err-arrival">
        <p class="error" id="err-arrival" hidden></p>
      </div>
      ${ro ? "" : `<button type="button" class="btn warn" data-action="s2-wait">部品待ちにして一覧へ戻る</button>`}` : ""}
    </section>
    <section>
      <label for="parts-memo" class="label">交換部品メモ<span class="opt">任意（品番・ロットなど）</span></label>
      <textarea id="parts-memo" data-field="used_parts_memo" rows="4" maxlength="5000" ${ro ? "disabled" : ""}>${esc(c.used_parts_memo)}</textarea>
      <p class="small muted">「用意した」にチェックした部品名は自動で追記されます。</p>
    </section>
    ${footer({
      ro,
      progress: parts.length ? `用意した部品 ${n} / ${parts.length}` : "必要部品なし",
      reason,
      nextLabel: "③ 修理作業へ",
      nextAction: "s2-next",
      nextEnabled: proc === "stock" && !!s2.done,
    })}`;
}

function s2Prepare(name, checked) {
  const s2 = current.step2_checked || {};
  const prepared = { ...(s2.prepared || {}), [name]: checked };
  const names = partsFor(current).map((p) => p.name);
  const patch = { step2_checked: { ...s2, prepared, done: step2Done(names, prepared) } };
  if (checked) {
    const memo = appendPartToMemo(current.used_parts_memo, name);
    if (memo !== current.used_parts_memo) patch.used_parts_memo = memo;
  }
  save(patch);
  renderCase();
}

function s2SetProcurement(val) {
  const s2 = current.step2_checked || {};
  const patch = { step2_checked: { ...s2, procurement: val } };
  if (val === "stock" && current.status === "部品待ち") patch.status = "作業中";
  save(patch);
  renderCase();
}

function validateArrival(value) {
  if (!value) return "入荷予定日を入力してください";
  if (value < current.created_at) return `入荷予定日は受付日（${current.created_at}）以降の日付にしてください`;
  return "";
}

// ======================================================================
// S-05 工程③ 修理作業
// ======================================================================
function screwSvg(order) {
  // 左上・右上・右下・左下 の位置に締め順を描く
  const pos = [[30, 30], [150, 30], [150, 110], [30, 110]];
  return `<svg viewBox="0 0 180 140" role="img" aria-label="ネジの締め順：${pos.map((_, i) => order[i]).join("、")}">
    <rect x="10" y="10" width="160" height="120" rx="12" fill="none" stroke="#5b6573" stroke-width="3"/>
    ${pos.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="15" fill="#0b57a4"/><text x="${x}" y="${y + 6}" text-anchor="middle" font-size="17" font-weight="700" fill="#fff">${order[i]}</text>`).join("")}
  </svg>`;
}

function step3(c, ro) {
  const info = modelInfo(c);
  const s3 = c.step3_checked || {};
  const tools = s3.tools || {};
  const wp = s3.waterproof || [];
  const n = WATERPROOF.filter((_, i) => wp[i]).length;
  const procs = PROCEDURES[c.diagnosis_result] || PROCEDURES.default;
  const pins = info.pins || [];
  return `
    <section>
      <h2>使用工具</h2>
      <p class="small muted">準備チェックは任意です。</p>
      ${TOOLS.map((t, i) => `
        <label class="check"><input type="checkbox" data-action="s3-tool" data-idx="${i}" ${tools[i] ? "checked" : ""} ${ro ? "disabled" : ""}>
          <span><strong>${esc(t.name)}</strong>　<span class="small">${esc(t.detail(info.tools || {}))}</span></span></label>`).join("")}
    </section>
    <section>
      <h2>作業手順（${esc(c.diagnosis_result || "共通")}）</h2>
      <ol class="procs">${procs.map((p, i) => `
        <li class="proc">
          <h3>手順${i + 1}　${esc(p.title)}</h3>
          <div class="proc-body">
            ${photo(p.photo, `${c.model_name} ${p.title}`)}
            <div>
              <p style="margin-top:0">${esc(p.text)}</p>
              ${p.caution ? `<div class="caution"><strong>注意</strong>${esc(p.caution)}</div>` : ""}
              ${p.pins ? `
                <h4 style="margin:12px 0 4px">ピンアサイン表（${esc(c.model_name)}）</h4>
                <div class="table-wrap"><table style="min-width:360px">
                  <thead><tr><th>端子番号</th><th>配線色</th><th>信号名</th></tr></thead>
                  <tbody>${pins.map((r) => `<tr><td>${esc(r.no)}</td><td>${esc(r.color)}</td><td>${esc(r.signal)}</td></tr>`).join("")}</tbody>
                </table></div>` : ""}
            </div>
          </div>
        </li>`).join("")}
      </ol>
    </section>
    <section>
      <h2>防水・気密の必須チェック</h2>
      ${WATERPROOF.map((label, i) => `
        <label class="check"><input type="checkbox" data-action="s3-wp" data-idx="${i}" ${wp[i] ? "checked" : ""} ${ro ? "disabled" : ""}>
          <span>${i + 1}. ${esc(label)}<span class="req">必須</span></span></label>
        ${i === WATERPROOF.length - 1 ? `<div class="screw"><p class="small" style="margin:4px 0">締め順（${esc(c.model_name)}・上から見た図）</p>${screwSvg(info.screwOrder || [1, 3, 2, 4])}</div>` : ""}`).join("")}
    </section>
    <section>
      <label for="parts-memo3" class="label">交換部品メモ<span class="opt">任意</span></label>
      <textarea id="parts-memo3" data-field="used_parts_memo" rows="3" maxlength="5000" ${ro ? "disabled" : ""}>${esc(c.used_parts_memo)}</textarea>
    </section>
    ${footer({
      ro,
      progress: `防水チェック ${n} / ${WATERPROOF.length}`,
      reason: n < WATERPROOF.length ? `未入力があと ${WATERPROOF.length - n} 項目あります` : "",
      nextLabel: "④ 動作確認へ",
      nextAction: "s3-next",
      nextEnabled: n === WATERPROOF.length,
    })}`;
}

function s3Toggle(kind, idx, checked) {
  const s3 = current.step3_checked || {};
  if (kind === "tool") {
    save({ step3_checked: { ...s3, tools: { ...(s3.tools || {}), [idx]: checked } } });
  } else {
    const wp = WATERPROOF.map((_, i) => (i === idx ? checked : !!(s3.waterproof || [])[i]));
    save({ step3_checked: { ...s3, waterproof: wp, done: wp.every(Boolean) } });
  }
  renderCase();
}

// ======================================================================
// S-06 工程④ 動作確認・エージング
// ======================================================================
const judgments = () => ANGLE_BASES.map((b) => judgeAngle(tmp4.angles[b], b, TOLERANCE));

function judgeHtml(j) {
  if (j.state === "none") return `<span class="badge gray">未入力</span>`;
  return `<span>${esc(formatError(j.error))}</span><span class="badge ${j.state === "ok" ? "green" : "red"}">${j.state === "ok" ? "OK" : "NG"}</span>`;
}

function ngGuideHtml(c) {
  const js = judgments();
  const ngCount = js.filter((j) => j.state === "ng").length;
  if (!ngCount) return "";
  const info = modelInfo(c);
  return `<div class="alert" role="alert">
    <h3>NG があります：次の順に確認してください</h3>
    ${ngCount === ANGLE_BASES.length ? `<p class="caution"><strong>注意</strong>全角度NGです。IMU基板の向き違いの可能性が大きいです。</p>` : ""}
    <ol>${NG_GUIDE.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <p style="margin-bottom:4px"><strong>ゼロ点リセット手順（${esc(c.model_name)}）</strong></p>
    <ol>${(info.zeroReset || ["[ゼロ点リセット手順書]"]).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <button type="button" class="btn danger" data-action="s4-back3">③ 修理作業に戻って直す</button>
  </div>`;
}

function lockHtml() {
  const ls = lockState(tmp4, judgments());
  return `<div class="lock ${ls.locked ? "locked" : "ready"}">
    <p role="status">${ls.locked ? "🔒 " : "✓ "}${esc(ls.message)}</p>
    <button type="button" class="btn primary big" data-action="s4-complete" ${ls.locked ? "disabled" : ""}>修理完了にする</button>
  </div>`;
}

function updateStep4Dynamic() {
  ANGLE_BASES.forEach((b, i) => {
    const el = document.getElementById(`judge-${b}`);
    if (el) el.innerHTML = judgeHtml(judgments()[i]);
  });
  const g = document.getElementById("ng-guide");
  if (g) g.innerHTML = ngGuideHtml(current);
  const l = document.getElementById("lock-area");
  if (l) l.innerHTML = lockHtml();
}

function step4(c, ro) {
  if (ro) {
    return `
      <div class="done-box" role="status">
        <h2>✓ 修理完了</h2>
        <p>完了日時：<strong>${esc(fmtDateTime(c.completed_at))}</strong></p>
        <p class="small">角度テストの値とエージング時刻は保存しない仕様のため、ここには表示されません。</p>
        <div class="actions">
          <a class="btn primary" href="#/">案件一覧に戻る</a>
          <button type="button" class="btn primary big" disabled>修理完了にする（完了済み）</button>
        </div>
      </div>`;
  }
  if (!tmp4) tmp4 = freshTmp4();
  return `
    <section>
      <h2>④ 動作確認：準備</h2>
      <p class="small muted">この画面の入力（準備チェック・エージング時刻・角度）は保存されません。画面を開き直したら最初からやり直してください。交代するときはエージング中であることを引継ぎメモに書いてください。</p>
      <div class="prep-grid">
        <label class="check"><input type="checkbox" data-action="s4-prep" data-key="connect" ${tmp4.connect ? "checked" : ""}><span>傾斜計のケーブルを専用制御盤へ接続した<span class="req">必須</span></span></label>
        <label class="check"><input type="checkbox" data-action="s4-prep" data-key="software" ${tmp4.software ? "checked" : ""}><span>管理用PCの専用ソフトを起動し、角度データを受信できている<span class="req">必須</span></span></label>
      </div>
      <h3>エージング（規定時間：${esc(AGING_TIME)}）</h3>
      <div class="aging">
        <button type="button" class="btn" data-action="s4-aging-start" ${tmp4.agingStart ? "disabled" : ""}>開始を記録</button>
        <span>開始：<span class="time" id="aging-start">${tmp4.agingStart ? fmtTime(tmp4.agingStart) : "未記録"}</span></span>
      </div>
      <div class="aging">
        <button type="button" class="btn" data-action="s4-aging-end" ${!tmp4.agingStart || tmp4.agingEnd ? "disabled" : ""}>終了を記録</button>
        <span>終了：<span class="time" id="aging-end">${tmp4.agingEnd ? fmtTime(tmp4.agingEnd) : tmp4.agingStart ? "未記録" : "未記録（先に開始を記録してください）"}</span></span>
      </div>
    </section>
    <section>
      <h2>90°ピッチ角度テスト</h2>
      <p class="small muted">管理用PCに表示された角度を入力してください。許容誤差 ±${TOLERANCE}° で自動判定します。</p>
      ${ANGLE_BASES.map((b, i) => `
        <div class="angle-row">
          <div><div class="angle-base">基準 ${b}°</div><div class="small">${esc(ANGLE_POSES[b] || "")}</div></div>
          ${photo("", `${c.model_name} ${b}° の置き方`)}
          <label class="small">PC表示値（°）
            <input type="number" step="any" inputmode="decimal" data-action="s4-angle" data-base="${b}" value="${esc(tmp4.angles[b])}" aria-describedby="judge-${b}">
          </label>
          <div class="judge" id="judge-${b}" aria-live="polite">${judgeHtml(judgments()[i])}</div>
        </div>`).join("")}
    </section>
    <div id="ng-guide">${ngGuideHtml(c)}</div>
    <section>
      <h2>修理完了</h2>
      <div id="lock-area">${lockHtml()}</div>
      <div class="actions" style="margin-top:12px"><button type="button" class="btn" data-action="suspend">一時保存して中断</button></div>
    </section>`;
}

async function completeCase() {
  const ls = lockState(tmp4, judgments());
  if (ls.locked) return;
  const ok = await flush();
  if (!ok) return;
  try {
    current = await api("POST", `/cases/${current.id}/complete`);
    tmp4 = null;
    setSaveState(`修理完了を記録しました ${fmtTime(new Date())}`);
    renderCase();
    scrollTo(0, 0);
  } catch (e) {
    setSaveState(`完了にできませんでした：${e.message}`, true);
    alert(`完了にできませんでした：${e.message}`);
  }
}

// ======================================================================
// 操作の受け付け
// ======================================================================
app.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  switch (a) {
    case "filter":
      listState.status = el.dataset.status;
      document.querySelectorAll(".filter").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      return loadCards();
    case "goto-step":
      return go(`#/case/${current.id}/${el.dataset.step}`);
    case "suspend":
      if (await flush()) go("#/");
      return;
    case "s1-set":
      return s1SetItem(el.dataset.key, el.dataset.val);
    case "s1-next":
      save({ current_step: Math.max(current.current_step, 2) });
      if (await flush()) go(`#/case/${current.id}/2`);
      return;
    case "s2-proc":
      return s2SetProcurement(el.dataset.val);
    case "s2-wait": {
      const value = document.getElementById("arrival").value;
      const err = validateArrival(value);
      showError("err-arrival", err);
      if (err) return document.getElementById("arrival").focus();
      const s2 = current.step2_checked || {};
      save({ expected_arrival_date: value, status: "部品待ち", current_step: 2, step2_checked: { ...s2, procurement: "order" } });
      if (await flush()) go("#/");
      return;
    }
    case "s2-next":
      save({ current_step: Math.max(current.current_step, 3) });
      if (await flush()) go(`#/case/${current.id}/3`);
      return;
    case "s3-next":
      save({ current_step: Math.max(current.current_step, 4) });
      if (await flush()) go(`#/case/${current.id}/4`);
      return;
    case "s4-aging-start":
      tmp4.agingStart = new Date();
      return renderCase();
    case "s4-aging-end":
      tmp4.agingEnd = new Date();
      return renderCase();
    case "s4-back3":
      save({ current_step: 3, status: "作業中" });
      if (await flush()) go(`#/case/${current.id}/3`);
      return;
    case "s4-complete":
      return completeCase();
  }
});

app.addEventListener("change", (ev) => {
  const el = ev.target;
  const a = el.dataset.action;
  if (a === "s2-prep") return s2Prepare(el.dataset.name, el.checked);
  if (a === "s3-tool") return s3Toggle("tool", Number(el.dataset.idx), el.checked);
  if (a === "s3-wp") return s3Toggle("wp", Number(el.dataset.idx), el.checked);
  if (a === "s4-prep") { tmp4[el.dataset.key] = el.checked; return updateStep4Dynamic(); }
  if (el.id === "diag") return s1SetDiagnosis(el.value);
  if (el.id === "arrival") {
    const err = validateArrival(el.value);
    showError("err-arrival", el.value ? err : "");
    if (el.value && !err) save({ expected_arrival_date: el.value });
  }
});

app.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.field && current) {
    save({ [el.dataset.field]: el.value }, { debounce: true });
    if (el.dataset.field === "used_parts_memo") {
      const side = document.getElementById("side-parts");
      if (side) side.innerHTML = el.value ? esc(el.value) : `<span class="muted">なし</span>`;
    }
    return;
  }
  if (el.dataset.action === "s4-angle") { tmp4.angles[el.dataset.base] = el.value; return updateStep4Dynamic(); }
  if (el.id === "voltage") { tmpVoltage = el.value; return; }
  if (el.id === "serial") { showError("err-serial", ""); return lookupHistory(el.value); }
  if (el.id === "model") showError("err-model", "");
});

app.addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (ev.target.id === "search-form") {
    listState.q = document.getElementById("q").value.trim();
    return loadCards();
  }
  if (ev.target.id === "new-form") return submitNew();
});

route();
