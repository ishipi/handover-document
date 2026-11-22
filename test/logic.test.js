// 判定ロジックのテスト（テスト仕様書 3.2 切り分けガイド、5.2 角度の境界値、5.3 完了ロック）
// 実行：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_ITEMS, diagnose, step1Progress, step2Done, appendPartToMemo,
  judgeAngle, formatError, lockState, GUIDE_EMPTY, GUIDE_NO_FAULT,
} from "../public/logic.js";

const TOL = 0.5;
// 表にない項目はすべて正常側（テスト仕様書 3.2）
const allOk = () => Object.fromEntries(CHECK_ITEMS.map((i) => [i.key, "ok"]));
const withNg = (over) => ({ ...allOk(), ...over });
const titles = (items) => diagnose(items).patterns.map((p) => p.diagnosis);

test("T-1-G01 何も入力しない", () => {
  const g = diagnose({});
  assert.equal(g.patterns.length, 0);
  assert.equal(g.message, GUIDE_EMPTY);
});
test("T-1-G02 全項目正常", () => {
  const g = diagnose(allOk());
  assert.equal(g.patterns.length, 0);
  assert.equal(g.message, GUIDE_NO_FAULT);
});
test("T-1-G03 sheath=異常 → ケーブル断線（根拠つき）", () => {
  const g = diagnose(withNg({ sheath: "ng" }));
  assert.deepEqual(titles(withNg({ sheath: "ng" })), ["ケーブル断線"]);
  assert.deepEqual(g.patterns[0].reasons, ["被覆・根元に異常あり"]);
});
test("T-1-G04 cont=断線 → ケーブル断線", () => {
  const g = diagnose(withNg({ cont: "ng" }));
  assert.deepEqual(titles(withNg({ cont: "ng" })), ["ケーブル断線"]);
  assert.deepEqual(g.patterns[0].reasons, ["導通チェックで断線あり"]);
});
test("T-1-G05 pin=異常 → コネクタ不良", () => assert.deepEqual(titles(withNg({ pin: "ng" })), ["コネクタ不良"]));
test("T-1-G06 comm=通信不可 → IMU基板不良", () => assert.deepEqual(titles(withNg({ comm: "ng" })), ["IMU基板不良"]));
test("T-1-G07 output=異常 → IMU基板不良", () => assert.deepEqual(titles(withNg({ output: "ng" })), ["IMU基板不良"]));
test("T-1-G08 cont=断線 + comm=通信不可 → ケーブル断線のみ", () =>
  assert.deepEqual(titles(withNg({ cont: "ng", comm: "ng" })), ["ケーブル断線"]));
test("T-1-G09 sheath=異常 + output=異常 → ケーブル断線のみ", () =>
  assert.deepEqual(titles(withNg({ sheath: "ng", output: "ng" })), ["ケーブル断線"]));
test("T-1-G10 cont 未入力 + comm=通信不可 → IMU基板不良は出ない", () => {
  const items = withNg({ comm: "ng" });
  delete items.cont;
  assert.ok(!titles(items).includes("IMU基板不良"));
});
test("T-1-G11 water=異常 → 筐体・防水不良", () => assert.deepEqual(titles(withNg({ water: "ng" })), ["筐体破損・浸水"]));
test("T-1-G12 case=異常 → 筐体・防水不良", () => assert.deepEqual(titles(withNg({ case: "ng" })), ["筐体破損・浸水"]));
test("T-1-G13 sheath + water → 2つ表示", () =>
  assert.deepEqual(titles(withNg({ sheath: "ng", water: "ng" })), ["ケーブル断線", "筐体破損・浸水"]));
test("T-1-G14 pin + comm → コネクタ不良と IMU基板不良", () =>
  assert.deepEqual(titles(withNg({ pin: "ng", comm: "ng" })), ["コネクタ不良", "IMU基板不良"]));
test("T-1-G15 自動提案は最初に当てはまったパターン", () =>
  assert.equal(diagnose(withNg({ sheath: "ng", water: "ng" })).suggestion, "ケーブル断線"));
test("T-1-G16 sheath を異常なしに戻すと消える", () => assert.deepEqual(titles(allOk()), []));

test("T-1-01/02/03/04 必須チェックの残り件数と完了条件", () => {
  assert.deepEqual(step1Progress({}, null), { filled: 0, total: 7, remaining: 7, done: false });
  assert.equal(step1Progress({ case: "ok", water: "ok", sheath: "ng" }, null).remaining, 4);
  assert.equal(step1Progress(allOk(), null).done, false); // 故障原因が未選択
  assert.equal(step1Progress(allOk(), "その他").done, true);
});

test("T-2-10/11 全部品の用意で②完了", () => {
  const names = ["a", "b", "c", "d"];
  assert.equal(step2Done(names, { a: true, b: true, c: true }), false);
  assert.equal(step2Done(names, { a: true, b: true, c: true, d: true }), true);
});
test("T-2-12 部品メモへの追記で手書きの内容は消えない", () => {
  let memo = "ロット 123 を使用";
  memo = appendPartToMemo(memo, "外部ケーブル");
  memo = appendPartToMemo(memo, "シリコングリス");
  memo = appendPartToMemo(memo, "外部ケーブル"); // 重ねない
  assert.equal(memo, "ロット 123 を使用\n外部ケーブル\nシリコングリス");
});

// テスト仕様書 5.2：[基準, 入力, 誤差表示, 判定]
const ANGLE_CASES = [
  ["T-4-A01", 0, "0.00", "誤差 +0.00°", "ok"],
  ["T-4-A02", 0, "0.50", "誤差 +0.50°", "ok"],
  ["T-4-A03", 0, "0.51", "誤差 +0.51°", "ng"],
  ["T-4-A04", 0, "-0.50", "誤差 -0.50°", "ok"],
  ["T-4-A05", 0, "359.50", "誤差 -0.50°", "ok"],
  ["T-4-A06", 0, "359.49", "誤差 -0.51°", "ng"],
  ["T-4-A07", 0, "360.00", "誤差 +0.00°", "ok"],
  ["T-4-A08", 90, "90.50", "誤差 +0.50°", "ok"],
  ["T-4-A09", 90, "89.49", "誤差 -0.51°", "ng"],
  ["T-4-A10", 180, "180.30", "誤差 +0.30°", "ok"],
  ["T-4-A11", 180, "-180.00", "誤差 +0.00°", "ok"],
  ["T-4-A12", 270, "-90.00", "誤差 +0.00°", "ok"],
  ["T-4-A13", 270, "270.51", "誤差 +0.51°", "ng"],
  ["T-4-A14", 90, "0.00", "誤差 -90.00°", "ng"],
];
for (const [id, base, input, shown, state] of ANGLE_CASES) {
  test(`${id} 基準${base}° 入力${input}`, () => {
    const j = judgeAngle(input, base, TOL);
    assert.equal(j.state, state);
    assert.equal(formatError(j.error), shown);
  });
}
test("T-4-A15/A16 空欄・数値でない入力は未入力", () => {
  assert.equal(judgeAngle("", 0, TOL).state, "none");
  assert.equal(judgeAngle("abc", 0, TOL).state, "none");
});
test("T-4-A17 0.2 → 0.8 で OK → NG", () => {
  assert.equal(judgeAngle("0.2", 0, TOL).state, "ok");
  assert.equal(judgeAngle("0.8", 0, TOL).state, "ng");
});
test("仕様書の例：基準0°で 359.8° は 誤差 -0.20°", () => assert.equal(formatError(judgeAngle("359.8", 0, TOL).error), "誤差 -0.20°"));

const prepAll = { connect: true, software: true, agingStart: 1, agingEnd: 2 };
const J = (...states) => states.map((state) => ({ state }));
test("T-4-03 接続チェックが外れているとロック", () =>
  assert.deepEqual(lockState({ ...prepAll, connect: false }, J("ok", "ok", "ok", "ok")),
    { locked: true, message: "接続・エージング準備が未完了です" }));
test("T-4-04 エージング終了なしだとロック", () =>
  assert.equal(lockState({ ...prepAll, agingEnd: null }, J("ok", "ok", "ok", "ok")).locked, true));
test("T-4-N04 OK が1件足りない", () =>
  assert.deepEqual(lockState(prepAll, J("ok", "ok", "ok", "none")), { locked: true, message: "角度テスト OK があと 1 件必要です" }));
test("T-4-N05 NG が残るとロック", () => assert.equal(lockState(prepAll, J("ok", "ok", "ok", "ng")).locked, true));
test("T-4-N06 すべてそろうと完了できる", () => assert.equal(lockState(prepAll, J("ok", "ok", "ok", "ok")).locked, false));
