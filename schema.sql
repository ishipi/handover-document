-- 傾斜計修理 引継ぎツール：案件テーブル（1案件＝1行）
CREATE TABLE IF NOT EXISTS cases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,          -- 案件ID（自動採番。画面では C-0001 の形で表示）
  serial_number         TEXT    NOT NULL,                           -- シリアルナンバー（前後の空白は除去して保存）
  model_name            TEXT    NOT NULL,                           -- 機種名
  current_step          INTEGER NOT NULL DEFAULT 1
                        CHECK (current_step BETWEEN 1 AND 4),       -- 1:初期診断 2:部品手配 3:修理作業 4:動作確認
  status                TEXT    NOT NULL DEFAULT '作業中'
                        CHECK (status IN ('作業中', '部品待ち', '完了')),
  diagnosis_result      TEXT
                        CHECK (diagnosis_result IS NULL OR diagnosis_result IN
                          ('ケーブル断線', 'コネクタ不良', 'IMU基板不良', '筐体破損・浸水', 'その他')),
  used_parts_memo       TEXT    NOT NULL DEFAULT '',                -- 交換した部品メモ
  expected_arrival_date TEXT,                                       -- 入荷予定日（YYYY-MM-DD）
  step1_checked         TEXT    NOT NULL DEFAULT '{"done":false,"items":{}}',  -- ①必須チェック（完了フラグ＋入力状態のJSON）
  step2_checked         TEXT    NOT NULL DEFAULT '{"done":false}',             -- ②必須チェック
  step3_checked         TEXT    NOT NULL DEFAULT '{"done":false}',             -- ③必須チェック
  notes                 TEXT    NOT NULL DEFAULT '',                -- 作業・引継ぎメモ（全工程で共通）
  notes_updated_at      TEXT,                                       -- 引継ぎメモの最終更新日時（ISO 8601）
  notes_updated_by      TEXT,                                       -- 引継ぎメモを最後に更新した作業者名
  created_at            TEXT    NOT NULL,                           -- 受付日（YYYY-MM-DD）
  completed_at          TEXT                                        -- 完了日時（ISO 8601）
);

CREATE INDEX IF NOT EXISTS idx_cases_serial ON cases (serial_number);
CREATE INDEX IF NOT EXISTS idx_cases_status_created ON cases (status, created_at);
