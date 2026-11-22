// 判定ロジック（画面から切り離してテストできるようにしている）

/** 工程① 初期診断のチェック項目（仕様書 5.1） */
export const CHECK_ITEMS = [
  { key: "case", group: "外観", label: "筐体の破損・変形", ok: "異常なし", ng: "異常あり", evidence: "筐体に破損・変形あり" },
  { key: "water", group: "外観", label: "浸水跡", ok: "異常なし", ng: "異常あり", evidence: "浸水跡あり" },
  { key: "sheath", group: "外観", label: "外部ケーブルの被覆破れ・根元（グランド部）の折れ", ok: "異常なし", ng: "異常あり", evidence: "被覆・根元に異常あり" },
  { key: "pin", group: "外観", label: "制御盤側コネクタのピン曲がり・腐食", ok: "異常なし", ng: "異常あり", evidence: "コネクタのピンに異常あり" },
  { key: "cont", group: "導通", label: "ケーブル導通（テスター）", ok: "導通あり", ng: "断線あり", evidence: "導通チェックで断線あり" },
  { key: "comm", group: "症状", label: "管理用PCとの通信", ok: "受信できる", ng: "通信不可", evidence: "管理用PCと通信不可" },
  { key: "output", group: "症状", label: "角度出力", ok: "正常", ng: "異常", evidence: "角度出力が異常" },
];

export const DIAGNOSES = ["ケーブル断線", "コネクタ不良", "IMU基板不良", "筐体破損・浸水", "その他"];

export const GUIDE_EMPTY = "チェックを入力すると推奨パターンが表示されます";
export const GUIDE_PARTIAL = "残りのチェックを入力すると推奨パターンが表示されます";
export const GUIDE_NO_FAULT = "異常が見つかりません。症状を再確認し、引継ぎメモに書いてください";

/**
 * 切り分けガイド（仕様書 5.1 G-1〜G-6）
 * @param {Record<string, "ok"|"ng">} items
 * @returns {{patterns: {id:string, diagnosis:string, title:string, action:string, reasons:string[]}[], message: string|null, suggestion: string|null}}
 */
export function diagnose(items = {}) {
  const ng = (k) => items[k] === "ng";
  const ok = (k) => items[k] === "ok";
  const ev = (...keys) => keys.filter(ng).map((k) => CHECK_ITEMS.find((i) => i.key === k).evidence);
  const patterns = [];

  if (ng("sheath") || ng("cont")) {
    patterns.push({ id: "G-1", diagnosis: "ケーブル断線", title: "ケーブル断線の可能性大", action: "ケーブル交換へ", reasons: ev("sheath", "cont") });
  }
  if (ng("pin")) {
    patterns.push({ id: "G-2", diagnosis: "コネクタ不良", title: "コネクタ不良の可能性", action: "コネクタの修正・交換へ", reasons: ev("pin") });
  }
  // ケーブルの異常が先。導通ありが確認できたときだけ IMU 基板を疑う
  if (ok("cont") && !ng("sheath") && (ng("comm") || ng("output"))) {
    patterns.push({
      id: "G-3",
      diagnosis: "IMU基板不良",
      title: "通信不可・出力異常（IMU基板不良）",
      action: "IMU基板交換へ",
      reasons: [...ev("comm", "output"), "導通チェックは導通あり"],
    });
  }
  if (ng("case") || ng("water")) {
    patterns.push({ id: "G-4", diagnosis: "筐体破損・浸水", title: "筐体・防水不良", action: "パッキン/Oリング・防水グランドを交換", reasons: ev("case", "water") });
  }

  const filled = CHECK_ITEMS.filter((i) => ok(i.key) || ng(i.key)).length;
  let message = null;
  if (!patterns.length) {
    if (filled === 0) message = GUIDE_EMPTY;
    else if (filled === CHECK_ITEMS.length) message = GUIDE_NO_FAULT;
    else message = GUIDE_PARTIAL;
  }
  return { patterns, message, suggestion: patterns[0]?.diagnosis ?? null };
}

/** 工程①の進み具合と完了条件 */
export function step1Progress(items = {}, diagnosis) {
  const total = CHECK_ITEMS.length;
  const filled = CHECK_ITEMS.filter((i) => items[i.key] === "ok" || items[i.key] === "ng").length;
  return { filled, total, remaining: total - filled, done: filled === total && !!diagnosis };
}

/** 工程②の完了条件：全部品が「用意した」 */
export function step2Done(partNames, prepared = {}) {
  return partNames.every((n) => prepared[n] === true);
}

/** 「用意した」部品名を交換部品メモに追記する（手で書いた内容は残す。同じ名前の行は重ねない） */
export function appendPartToMemo(memo, name) {
  const lines = (memo || "").split("\n");
  if (lines.some((l) => l.trim() === name)) return memo || "";
  const base = (memo || "").replace(/\n+$/, "");
  return base ? `${base}\n${name}` : name;
}

/**
 * 角度の誤差（仕様書 5.4）：((入力値 − 基準角度 + 540) mod 360) − 180
 * 0°/360° の境目をまたいでも正しく出る。浮動小数の誤差は 1e-6 で丸める
 */
export function angleError(value, base) {
  const m = (((value - base + 540) % 360) + 360) % 360;
  const e = Math.round((m - 180) * 1e6) / 1e6;
  return e === 0 ? 0 : e; // -0 を 0 にそろえる
}

/** @returns {{state: "none"} | {state: "ok"|"ng", error: number}} */
export function judgeAngle(raw, base, tolerance) {
  if (raw === "" || raw == null) return { state: "none" };
  const v = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (String(raw).trim() === "" || !Number.isFinite(v)) return { state: "none" };
  const error = angleError(v, base);
  return { state: Math.abs(error) <= tolerance + 1e-9 ? "ok" : "ng", error };
}

/** 「誤差 +0.12°」の形にする */
export function formatError(error) {
  return `誤差 ${error < 0 ? "-" : "+"}${Math.abs(error).toFixed(2)}°`;
}

/**
 * 完了ロック（仕様書 5.4）
 * @param {{connect:boolean, software:boolean, agingStart:any, agingEnd:any}} prep
 * @param {{state:string}[]} judgments 4角度ぶん
 */
export function lockState(prep, judgments) {
  const prepOk = !!(prep.connect && prep.software && prep.agingStart && prep.agingEnd);
  if (!prepOk) return { locked: true, message: "接続・エージング準備が未完了です" };
  const okCount = judgments.filter((j) => j.state === "ok").length;
  if (okCount < judgments.length) {
    return { locked: true, message: `角度テスト OK があと ${judgments.length - okCount} 件必要です` };
  }
  return { locked: false, message: "すべての条件がそろいました。修理完了にできます" };
}
