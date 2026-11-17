/** 形式の識別子(例: "png", "jpeg")。形式は増えていくので文字列で持つ。 */
export type FormatId = string;

export type FormatCategory = 'image' | 'document' | 'data' | 'pdf' | 'media' | 'font' | 'archive';

export interface FormatDef {
  id: FormatId;
  /** 一覧・候補に出す名前(文字コードなどの区別も含めた完全な名前) */
  label: string;
  /** 候補の一覧で2行に分けて出すときの、名前と補足(例: CSV / UTF-8 BOM付き)。省略時は label を1行で出す。 */
  short?: { name: string; variant: string };
  /** 出力時の拡張子(小文字、ドットなし) */
  ext: string;
  /** 入力として受け付ける拡張子 */
  extensions: string[];
  mime: string;
  category: FormatCategory;
  /** 候補の右側に出す用途文。この形式へ変換するときに表示する。 */
  usage: string;
  /** 先頭バイト(中身)で判定する。中身で判定できる形式は、拡張子より優先する。 */
  sniff?: (head: Uint8Array, ext: string) => boolean;
  /**
   * 中身だけでは決めにくいテキスト形式の判定(拡張子と中身の両方を見る)。
   * 省略時は extensions と MIME タイプで判定する。
   * head が先頭部分だけのとき complete=false。
   */
  textMatch?: (head: Uint8Array, ext: string, complete: boolean) => boolean;
  /** 出力専用の形式(入力としては判定しない)。例: Markdownテーブル */
  outputOnly?: boolean;
}

/** DOM が必要な前処理(Worker ではできないもの)。サイドパネルと Offscreen Document で実行する。 */
export type PrepareKind = 'rasterize-svg';

export interface ConvertInput {
  name: string;
  blob: Blob;
  format: FormatId;
  /** prepare で作った画像(SVG のラスタライズ結果など) */
  bitmap?: ImageBitmap;
}

export interface ConvertOutput {
  name: string;
  blob: Blob;
}

export interface ConvertResult {
  outputs: ConvertOutput[];
  /** 完了表示に添える一言(透過を白にした、最初のフレームを使った、など) */
  notes: string[];
  /** 複数の入力を1つにまとめる変換で、含められなかった入力(入力の並びでの位置と理由) */
  failed?: Array<{ index: number; message: string }>;
}

export interface ConvertContext {
  /** 0〜1 の進捗。detail は「12 / 40 ページ」のような補足 */
  progress: (ratio: number, detail?: string) => void;
}

export interface Converter {
  id: string;
  from: FormatId;
  to: FormatId;
  /** 形式ごとの用途文を、この組み合わせだけ上書きしたいとき */
  usage?: string;
  prepare?: PrepareKind;
  /** 1ファイルから複数のファイルができる変換(PDF → 画像など)。保存方法の選択を出す判断に使う。 */
  multiOutput?: boolean;
  /**
   * 複数の入力を1つのファイルにまとめられる変換(画像 → PDF の結合)。
   * まとめるかどうかは利用者が選び、まとめるときは Engine.convertMany を使う。
   */
  mergeable?: boolean;
  /** 変換を実行するエンジン。実装は実行側(Worker など)が engines.ts から動的 import で読み込む。 */
  engine: EngineId;
}

/**
 * 変換の実装のまとまり(画像・文書・PDF などの種類ごと)。
 * DOM_ENGINES に入るもの(html)は DOM が必要なため、Worker ではなく DOM のある側(サイドパネル)で動かす。
 */
export type EngineId = 'image' | 'text' | 'sheet' | 'html' | 'pdf' | 'media' | 'font' | 'archive';

export interface Engine {
  convert: (input: ConvertInput, to: FormatId, ctx: ConvertContext) => Promise<ConvertResult>;
  /** 複数の入力を1つにまとめる(mergeable な変換のみ)。出力名は最初の入力の名前から作る。 */
  convertMany?: (inputs: ConvertInput[], to: FormatId, ctx: ConvertContext) => Promise<ConvertResult>;
}

/** 利用者に見せる理由付きのエラー */
export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConvertError';
  }
}
