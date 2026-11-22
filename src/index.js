// 傾斜計修理 引継ぎツール：API（/api/*）。画面は public/ の静的ファイルを配信する。

const STATUSES = ["作業中", "部品待ち", "完了"];
const DIAGNOSES = ["ケーブル断線", "コネクタ不良", "IMU基板不良", "筐体破損・浸水", "その他"];
const STEP_JSON_FIELDS = ["step1_checked", "step2_checked", "step3_checked"];
const TEXT_LIMIT = 5000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const isDate = (s) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const text = (v, max, name) => {
  if (v == null) return "";
  if (typeof v !== "string") throw new HttpError(400, `${name} の形式が正しくありません`);
  if (v.length > max) throw new HttpError(400, `${name} は ${max} 文字以内にしてください`);
  return v;
};

function toCase(row) {
  if (!row) return null;
  const c = { ...row };
  for (const f of STEP_JSON_FIELDS) {
    try {
      c[f] = JSON.parse(row[f]);
    } catch {
      c[f] = { done: false };
    }
  }
  return c;
}

async function getCase(env, id) {
  return toCase(await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first());
}

async function readBody(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "送信内容の形式が正しくありません");
  }
}

// GET /api/cases?status=作業中&q=0002  /  GET /api/cases?serial=TEST-0001（同じシリアルの過去案件）
async function listCases(env, url) {
  const where = [];
  const binds = [];
  const status = url.searchParams.get("status");
  const q = (url.searchParams.get("q") || "").trim();
  const serial = url.searchParams.get("serial");
  if (status) {
    if (!STATUSES.includes(status)) throw new HttpError(400, "ステータスの指定が正しくありません");
    where.push("status = ?");
    binds.push(status);
  }
  if (q) {
    where.push("serial_number LIKE ? ESCAPE '\\'");
    binds.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  if (serial != null) {
    where.push("serial_number = ?");
    binds.push(serial.trim());
  }
  const sql = `SELECT * FROM cases ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC LIMIT 200`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ cases: results.map(toCase) });
}

// POST /api/cases  新規受付
async function createCase(env, request) {
  const body = await readBody(request);
  const serial = text(body.serial_number, 100, "シリアルナンバー").trim();
  const model = text(body.model_name, 100, "機種名").trim();
  const errors = {};
  if (!serial) errors.serial_number = "シリアルナンバーを入力してください";
  if (!model) errors.model_name = "機種を選んでください";
  const createdAt = body.created_at || new Date().toISOString().slice(0, 10);
  if (!isDate(createdAt)) errors.created_at = "受付日の形式が正しくありません";
  if (Object.keys(errors).length) return json({ error: "入力内容を確認してください", errors }, 400);

  const notes = text(body.notes, TEXT_LIMIT, "申し送り");
  const worker = text(body.worker, 50, "作業者名").trim();
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO cases (serial_number, model_name, created_at, notes, notes_updated_at, notes_updated_by)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(serial, model, createdAt, notes, notes ? now : null, notes ? worker : null)
    .first();
  return json(toCase(row), 201);
}

// PATCH /api/cases/:id  入力のたびの自動保存
async function updateCase(env, request, id) {
  const row = await getCase(env, id);
  if (!row) throw new HttpError(404, "案件が見つかりません");
  if (row.status === "完了") throw new HttpError(409, "完了した案件は修正できません");
  const body = await readBody(request);

  const sets = [];
  const binds = [];
  const set = (col, val) => {
    sets.push(`${col} = ?`);
    binds.push(val);
  };

  if ("diagnosis_result" in body) {
    const v = body.diagnosis_result || null;
    if (v !== null && !DIAGNOSES.includes(v)) throw new HttpError(400, "故障原因の値が正しくありません");
    set("diagnosis_result", v);
  }
  if ("used_parts_memo" in body) set("used_parts_memo", text(body.used_parts_memo, TEXT_LIMIT, "交換部品メモ"));
  if ("notes" in body) {
    set("notes", text(body.notes, TEXT_LIMIT, "引継ぎメモ"));
    set("notes_updated_at", new Date().toISOString());
    set("notes_updated_by", text(body.worker, 50, "作業者名").trim() || null);
  }
  for (const f of STEP_JSON_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.done !== "boolean") {
      throw new HttpError(400, "チェック内容の形式が正しくありません");
    }
    const s = JSON.stringify(v);
    if (s.length > 4000) throw new HttpError(400, "チェック内容が大きすぎます");
    set(f, s);
  }
  if ("current_step" in body) {
    const v = body.current_step;
    if (!Number.isInteger(v) || v < 1 || v > 4) throw new HttpError(400, "工程の値が正しくありません");
    set("current_step", v);
  }

  let arrival = row.expected_arrival_date;
  if ("expected_arrival_date" in body) {
    arrival = body.expected_arrival_date || null;
    if (arrival !== null) {
      if (!isDate(arrival)) throw new HttpError(400, "入荷予定日の形式が正しくありません");
      if (arrival < row.created_at) throw new HttpError(400, "入荷予定日は受付日以降の日付にしてください");
    }
    set("expected_arrival_date", arrival);
  }
  if ("status" in body) {
    // 「完了」は完了用の API からだけ設定できる
    if (!["作業中", "部品待ち"].includes(body.status)) throw new HttpError(400, "ステータスの値が正しくありません");
    if (body.status === "部品待ち" && !arrival) throw new HttpError(400, "部品待ちにするには入荷予定日が必要です");
    set("status", body.status);
  }

  if (sets.length) {
    await env.DB.prepare(`UPDATE cases SET ${sets.join(", ")} WHERE id = ? AND status != '完了'`)
      .bind(...binds, id)
      .run();
  }
  return json(await getCase(env, id));
}

// POST /api/cases/:id/complete  修理完了（角度テストの値は保存しない仕様のため、画面側の完了ロックで判定する）
async function completeCase(env, id) {
  const row = await getCase(env, id);
  if (!row) throw new HttpError(404, "案件が見つかりません");
  if (row.status === "完了") throw new HttpError(409, "この案件はすでに完了しています");
  if (row.current_step !== 4 || !row.step3_checked.done) {
    throw new HttpError(409, "③ 修理作業の必須チェックが終わっていないため完了できません");
  }
  const res = await env.DB.prepare(
    "UPDATE cases SET status = '完了', completed_at = ? WHERE id = ? AND status != '完了'"
  )
    .bind(new Date().toISOString(), id)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "この案件はすでに完了しています");
  return json(await getCase(env, id));
}

async function handleApi(request, env, url) {
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(2); // ["cases", id?, action?]
  if (parts[0] !== "cases") throw new HttpError(404, "見つかりません");
  const method = request.method;

  if (parts.length === 1) {
    if (method === "GET") return listCases(env, url);
    if (method === "POST") return createCase(env, request);
  } else {
    if (!/^\d+$/.test(parts[1])) throw new HttpError(404, "案件が見つかりません");
    const id = Number(parts[1]);
    if (parts.length === 2) {
      if (method === "GET") {
        const c = await getCase(env, id);
        if (!c) throw new HttpError(404, "案件が見つかりません");
        return json(c);
      }
      if (method === "PATCH") return updateCase(env, request, id);
    }
    if (parts.length === 3 && parts[2] === "complete" && method === "POST") return completeCase(env, id);
  }
  throw new HttpError(405, "この操作はできません");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: "サーバーでエラーが起きました。時間をおいてもう一度試してください" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
