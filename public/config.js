// 設定値（仕様書 7.1）。[ ] で囲んだ値は仮の値なので、実際の値に置き換えてください。

/** 機種一覧と、機種ごとの資料 */
export const MODELS = ["[機種A]", "[機種B]"];

export const MODEL_INFO = {
  "[機種A]": {
    manualUrl: "", // 診断マニュアルのURL（未設定なら表示しない）
    voltage: "DC 12V ±10%（仮）",
    // 規定トルク・はんだごて温度などの工具設定値
    tools: { driver: "+0 / +1", torque: "[値] N·m", iron: "[温度] ℃" },
    pins: [
      { no: 1, color: "赤", signal: "電源 +" },
      { no: 2, color: "黒", signal: "GND" },
      { no: 3, color: "白", signal: "RS-485 A" },
      { no: 4, color: "緑", signal: "RS-485 B" },
    ],
    // ネジの締め順（筐体を上から見て 左上・右上・右下・左下 の順に何番目に締めるか）
    screwOrder: [1, 3, 2, 4],
    zeroReset: ["専用ソフトの「設定」→「ゼロ点リセット」を開く", "水平台に置いて30秒待つ", "「実行」を押し、完了表示を確認する"],
  },
  "[機種B]": {
    manualUrl: "",
    voltage: "DC 24V ±10%（仮）",
    tools: { driver: "+1", torque: "[値] N·m", iron: "[温度] ℃" },
    pins: [
      { no: 1, color: "茶", signal: "電源 +" },
      { no: 2, color: "青", signal: "GND" },
      { no: 3, color: "黒", signal: "CAN H" },
      { no: 4, color: "白", signal: "CAN L" },
      { no: 5, color: "灰", signal: "シールド" },
    ],
    screwOrder: [1, 3, 2, 4],
    zeroReset: ["本体のリセットスイッチを5秒長押しする", "LEDが緑に変わるまで待つ", "専用ソフトで 0.00° 付近になっていることを確認する"],
  },
};

/** 角度判定の許容誤差（±度）。正式値が決まったら直す（未確定事項 Q-01） */
export const TOLERANCE = 0.5;

/** 角度テストの基準角度（未確定事項 Q-02） */
export const ANGLE_BASES = [0, 90, 180, 270];

/** 角度テストの置き方 */
export const ANGLE_POSES = {
  0: "底面を下にして、水平台に置く",
  90: "ケーブル口を上にして、右側面を下に置く",
  180: "天面を下にして置く（底面が上）",
  270: "ケーブル口を上にして、左側面を下に置く",
};

/** エージングの規定時間（未確定事項 Q-04） */
export const AGING_TIME = "[規定時間]";

/** 部品情報。stock は「あり」「残りわずか」「在庫切れ」のいずれか */
export const PARTS = {
  "外部ケーブル": { shelf: "A-01", stock: "あり", partNo: "[品番]", vendor: "[発注先]", approval: "[承認ルート]", leadTime: "[標準納期]" },
  "防水ケーブルグランド": { shelf: "A-02", stock: "残りわずか", partNo: "[品番]", vendor: "[発注先]", approval: "[承認ルート]", leadTime: "[標準納期]" },
  "ケース用パッキン/Oリング": { shelf: "B-01", stock: "あり", partNo: "[品番]", vendor: "[発注先]", approval: "[承認ルート]", leadTime: "[標準納期]" },
  "シリコングリス": { shelf: "B-05", stock: "あり", partNo: "[品番]", vendor: "[発注先]", approval: "[承認ルート]", leadTime: "[標準納期]" },
  "IMU基板Assy": { shelf: "C-01", stock: "在庫切れ", partNo: "[品番]", vendor: "[発注先]", approval: "課長承認 → 購買", leadTime: "約2週間（仮）" },
  "[コネクタ部品]": { shelf: "A-03", stock: "あり", partNo: "[品番]", vendor: "[発注先]", approval: "[承認ルート]", leadTime: "[標準納期]" },
};

/** 故障原因ごとの必要部品と数量（未確定事項 Q-03） */
export const PART_SETS = {
  "ケーブル断線": [
    { name: "外部ケーブル", qty: 1 },
    { name: "防水ケーブルグランド", qty: 1 },
    { name: "ケース用パッキン/Oリング", qty: 1 },
    { name: "シリコングリス", qty: 1 },
  ],
  "コネクタ不良": [
    { name: "[コネクタ部品]", qty: 1 },
    { name: "シリコングリス", qty: 1 },
  ],
  "IMU基板不良": [
    { name: "IMU基板Assy", qty: 1 },
    { name: "ケース用パッキン/Oリング", qty: 1 },
    { name: "シリコングリス", qty: 1 },
  ],
  "筐体破損・浸水": [
    { name: "ケース用パッキン/Oリング", qty: 1 },
    { name: "防水ケーブルグランド", qty: 1 },
    { name: "シリコングリス", qty: 1 },
  ],
  "その他": [],
};

/** 使用工具（tools のキーは MODEL_INFO.tools の設定値を差し込む） */
export const TOOLS = [
  { name: "精密ドライバー", detail: (t) => `サイズ：${t.driver}` },
  { name: "トルクドライバー", detail: (t) => `設定値：${t.torque}` },
  { name: "はんだごて", detail: (t) => `設定温度：${t.iron}` },
  { name: "静電気対策バンド", detail: () => "作業前に必ず手首に付ける" },
];

/** 作業手順（photo に画像のパスを入れると写真を表示する。空なら「写真準備中」の枠） */
const OPEN = { title: "筐体開封", text: "筐体ネジを外し、ふたをまっすぐ持ち上げて開ける。", caution: "内部配線を引っ張らない。ふたは配線の長さの範囲でゆっくり開ける。", photo: "" };
const IMU = { title: "IMU基板の向き", text: "基板の軸方向マークが、写真と同じ向きになるように取り付ける。", caution: "向きを間違えると ④ 動作確認で全項目NGになる。", photo: "" };
const WIRE = { title: "結線", text: "端子台にピンアサイン表どおりに配線する。", pins: true, photo: "" };

export const PROCEDURES = {
  "ケーブル断線": [
    OPEN,
    { title: "外部ケーブルの交換", text: "古いケーブルと防水ケーブルグランドを外し、新しいケーブルをグランドに通す。", photo: "" },
    { ...IMU, title: "IMU基板の向き確認", text: "ケーブル交換で基板に触れた場合は、軸方向マークの向きを確認する。" },
    WIRE,
  ],
  "コネクタ不良": [
    OPEN,
    { title: "コネクタの修正・交換", text: "曲がったピンを修正する。腐食や折れがある場合はコネクタを交換する。", photo: "" },
    IMU,
    WIRE,
  ],
  "IMU基板不良": [
    OPEN,
    { title: "IMU基板の取り外し", text: "固定ネジを外し、コネクタを抜いて基板を取り外す。", caution: "静電気対策バンドを付けてから基板に触る。", photo: "" },
    IMU,
    WIRE,
  ],
  "筐体破損・浸水": [
    OPEN,
    { title: "内部の乾燥・清掃", text: "浸水跡を拭き取り、内部を乾燥させる。腐食した部品があれば引継ぎメモに書く。", photo: "" },
    IMU,
    WIRE,
  ],
  default: [OPEN, IMU, WIRE],
};

/** 防水・気密の必須チェック（5項目） */
export const WATERPROOF = [
  "ケーブルグランドを規定トルク（[値] N·m）で締め付けた",
  "パッキン（Oリング）を溝にねじれなくセットした",
  "Oリングにシリコングリスを薄く均一に塗布した",
  "パッキンへの噛み込み・異物がないことを目視で確認した",
  "筐体ネジを指定の順番（対角順）で締めた",
];

/** ④でNGが出たときのリカバリー手順 */
export const NG_GUIDE = [
  "IMU基板の取り付け浮き・傾きを確認する（固定ネジの締め付け、基板の下に異物がないか）",
  "IMU基板の固定向きが工程③の写真と同じか確認する（全角度NGなら向き違いの可能性大）",
  "ゼロ点リセットを実施する（下の機種別手順）",
  "もう一度角度テストを入力する",
];
