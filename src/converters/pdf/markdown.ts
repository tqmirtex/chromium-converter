import fontkit from '@pdf-lib/fontkit';
import fontUrl from '@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf?url';
import {
  PDFDocument,
  PDFString,
  StandardFonts,
  TextRenderingMode,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineWidth,
  setStrokingRgbColor,
  setTextRenderingMode,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import type { Token } from 'markdown-it';
import { baseName } from '../../core/filename';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult } from '../../core/types';
import { inlineText, md } from '../document/markdown';
import { readInputText } from '../document/read';
import { stripTrueType } from './ttfstrip';

/**
 * Markdown → PDF。pdf-lib で1行ずつ組版して描く(ブラウザの印刷機能は使わない)。
 * 日本語は同梱の Noto Sans JP で描き、PDF には使った文字だけを埋め込む(サブセット化)。
 * 太字は輪郭を描き足して太く見せる(Bold フォントを同梱しないため)。
 * 画像は外部から取得しない(完全ローカル)。代わりに説明文を表示する。
 */

// ---------- ページと文字の設定 ----------

const PAGE = { width: 595.28, height: 841.89 }; // A4(pt)
const MARGIN = { top: 56, bottom: 64, left: 56, right: 56 };
const CONTENT_RIGHT = PAGE.width - MARGIN.right;
const BODY = 10.5;
const LINE = 1.7;
const HEADING = [0, 20, 16, 13.5, 12, 11, 10.5];
const CODE = 9;
const TABLE = 9.5;
const INDENT = 18;
const QUOTE_INDENT = 14;

const COLOR = {
  ink: rgb(0x17 / 255, 0x17 / 255, 0x17 / 255),
  body: rgb(0x60 / 255, 0x64 / 255, 0x6c / 255),
  link: rgb(0x0d / 255, 0x74 / 255, 0xce / 255),
  hairline: rgb(0xdc / 255, 0xde / 255, 0xe0 / 255),
  codeBg: rgb(0xf0 / 255, 0xf0 / 255, 0xf3 / 255),
  blockBg: rgb(0xf5 / 255, 0xf5 / 255, 0xf7 / 255),
  headBg: rgb(0xfa / 255, 0xfa / 255, 0xfa / 255),
};

/** 行頭に来てはいけない文字(行末にぶら下げる) */
const NO_START = new Set([...'、。，．・：；？！ー）」』】〕〉》〟’”…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々゛゜,.)]}!?:;']);
/** 行末に来てはいけない文字(次の行へ送る) */
const NO_END = new Set([...'（「『【〔〈《〝‘“([{']);
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;

interface Style {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
  color?: RGB;
}

interface Run {
  text: string;
  style: Style;
}

interface Atom {
  text: string;
  style: Style;
  width: number;
  space: boolean;
  newline: boolean;
}

// ---------- 文字の幅と書体 ----------

class Fonts {
  private cache = new Map<string, number>();
  constructor(
    readonly jp: PDFFont,
    readonly mono: PDFFont,
    private readonly hasGlyph: (cp: number) => boolean,
  ) {}

  missing = new Set<string>();
  /** Noto Sans JP で描いた文字(フォントを小さくするときに使う) */
  used = new Set<number>();

  /** コードの英数字は等幅の Courier、それ以外は Noto Sans JP */
  fontFor(ch: string, style: Style): PDFFont {
    const cp = ch.codePointAt(0) ?? 0;
    if (style.code && cp >= 0x20 && cp < 0x7f) return this.mono;
    if (!this.hasGlyph(cp) && cp > 0x20) this.missing.add(ch);
    this.used.add(cp);
    return this.jp;
  }

  width(text: string, style: Style, size: number): number {
    let w = 0;
    for (const ch of text) {
      const font = this.fontFor(ch, style);
      const key = `${font === this.mono ? 'm' : 'j'}${ch}`;
      let unit = this.cache.get(key);
      if (unit === undefined) {
        unit = font.widthOfTextAtSize(ch, 1);
        this.cache.set(key, unit);
      }
      w += unit * size;
    }
    return w;
  }
}

// ---------- インライン要素 → 文字の並び ----------

function cleanText(s: string, code: boolean): string {
  // 制御文字は描けないので除く。タブはスペースにする
  return s.replace(/\t/g, code ? '    ' : ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

function inlineRuns(children: Token[] | null, base: Style, notes: Set<string>): Run[] {
  const runs: Run[] = [];
  const stack: Style[] = [base];
  const cur = (): Style => stack[stack.length - 1];
  const push = (s: Partial<Style>): void => {
    stack.push({ ...cur(), ...s });
  };
  const list = children ?? [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    switch (t.type) {
      case 'text':
      case 'html_inline':
        runs.push({ text: cleanText(t.content, false), style: cur() });
        break;
      case 'code_inline':
        runs.push({ text: cleanText(t.content, true), style: { ...cur(), code: true } });
        break;
      case 'softbreak': {
        // 日本語どうしの改行は詰め、英語の単語の間は空白にする
        const prev = runs.at(-1)?.text.slice(-1) ?? '';
        const next = list[i + 1]?.content?.[0] ?? '';
        if (!(CJK.test(prev) && CJK.test(next))) runs.push({ text: ' ', style: cur() });
        break;
      }
      case 'hardbreak':
        runs.push({ text: '\n', style: cur() });
        break;
      case 'strong_open':
        push({ bold: true });
        break;
      case 'em_open':
        push({ italic: true });
        break;
      case 's_open':
        push({ strike: true });
        break;
      case 'link_open': {
        const href = String(t.attrGet('href') ?? '');
        push({ link: /^(https?:|mailto:)/i.test(href) ? href : undefined, color: COLOR.link });
        break;
      }
      case 'strong_close':
      case 'em_close':
      case 's_close':
      case 'link_close':
        if (stack.length > 1) stack.pop();
        break;
      case 'image': {
        const alt = inlineText(t.children, true) || t.attrGet('alt') || '';
        runs.push({ text: `[画像${alt ? `: ${alt}` : ''}]`, style: { ...cur(), color: COLOR.body } });
        notes.add('画像は読み込まず(外部への通信をしないため)、代わりに説明文を表示しました');
        break;
      }
      default:
        break;
    }
  }
  return runs;
}

function toAtoms(runs: Run[], fonts: Fonts, size: number): Atom[] {
  const atoms: Atom[] = [];
  const pattern = /\n|[  ]+|[^\s⺀-鿿豈-﫿＀-￯　-〿]+|./gsu;
  for (const run of runs) {
    for (const m of run.text.matchAll(pattern)) {
      const text = m[0];
      if (text === '\n') {
        atoms.push({ text: '', style: run.style, width: 0, space: false, newline: true });
        continue;
      }
      const space = /^[  ]+$/.test(text);
      atoms.push({ text, style: run.style, width: fonts.width(text, run.style, size), space, newline: false });
    }
  }
  return atoms;
}

/** 行に分ける(英単語は途中で切らない。日本語は1文字ずつ。禁則は簡易的に処理する) */
function breakLines(atoms: Atom[], maxWidth: number, fonts: Fonts, size: number, keepIndent = false): Atom[][] {
  const lines: Atom[][] = [];
  let cur: Atom[] = [];
  let curW = 0;
  const flush = (): void => {
    while (cur.length && cur[cur.length - 1].space) curW -= cur.pop()!.width;
    lines.push(cur);
    cur = [];
    curW = 0;
  };
  const queue = [...atoms];
  while (queue.length) {
    const a = queue.shift()!;
    if (a.newline) {
      flush();
      continue;
    }
    if (cur.length === 0 && a.space && !(keepIndent && lines.length === 0)) continue;
    if (curW + a.width <= maxWidth) {
      cur.push(a);
      curW += a.width;
      continue;
    }
    if (cur.length > 0 && NO_START.has(a.text[0])) {
      // 句読点などは行末にぶら下げる
      cur.push(a);
      curW += a.width;
      continue;
    }
    if (a.width > maxWidth && !a.space) {
      // 1行に収まらない長い単語(URL など)は文字単位で分ける
      const chars = [...a.text].map((ch) => ({ ...a, text: ch, width: fonts.width(ch, a.style, size) }));
      queue.unshift(...chars);
      if (cur.length && curW + chars[0].width > maxWidth) flush();
      continue;
    }
    const carry: Atom[] = [];
    while (cur.length > 1 && NO_END.has(cur[cur.length - 1].text.slice(-1))) carry.unshift(cur.pop()!);
    flush();
    for (const c of carry) {
      cur.push(c);
      curW += c.width;
    }
    if (!a.space) {
      cur.push(a);
      curW += a.width;
    }
  }
  if (cur.length || lines.length === 0) flush();
  return lines;
}

// ---------- 描画 ----------

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  quoteDepth = 0;
  indent = 0;

  constructor(
    private doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = PAGE.height - MARGIN.top;
  }

  get atTop(): boolean {
    return this.y >= PAGE.height - MARGIN.top - 0.01;
  }

  ensure(h: number): void {
    if (this.y - h < MARGIN.bottom && !this.atTop) this.newPage();
  }

  space(h: number): void {
    if (!this.atTop) this.y -= h;
  }

  get left(): number {
    return MARGIN.left + this.indent + this.quoteDepth * QUOTE_INDENT;
  }

  /** 引用の縦線を、いまの行の高さぶん描く */
  quoteBars(h: number): void {
    for (let d = 0; d < this.quoteDepth; d++) {
      const x = MARGIN.left + this.indent + d * QUOTE_INDENT + 3;
      this.page.drawLine({ start: { x, y: this.y }, end: { x, y: this.y - h }, thickness: 2.5, color: COLOR.hairline });
    }
  }

  /** 1行を描く。x は行の左端、baseline は文字の基準線 */
  drawLine(line: Atom[], x: number, baseline: number, size: number, defaultColor: RGB): void {
    let cx = x;
    for (const atom of line) {
      // 書体ごとに区切って描く
      let buf = '';
      let bufFont: PDFFont | undefined;
      const emit = (): void => {
        if (!buf || !bufFont) return;
        const w = this.fonts.width(buf, atom.style, size);
        this.drawSegment(buf, bufFont, cx, baseline, size, atom.style, defaultColor, w);
        cx += w;
        buf = '';
      };
      for (const ch of atom.text) {
        const f = this.fonts.fontFor(ch, atom.style);
        if (f !== bufFont) {
          emit();
          bufFont = f;
        }
        buf += ch;
      }
      emit();
    }
  }

  private drawSegment(
    text: string,
    font: PDFFont,
    x: number,
    baseline: number,
    size: number,
    style: Style,
    defaultColor: RGB,
    width: number,
  ): void {
    const page = this.page;
    const color = style.color ?? defaultColor;
    if (style.code) {
      page.drawRectangle({ x: x - 1, y: baseline - size * 0.28, width: width + 2, height: size * 1.3, color: COLOR.codeBg });
    }
    if (!text.trim()) return;
    if (style.bold) {
      page.pushOperators(
        pushGraphicsState(),
        setTextRenderingMode(TextRenderingMode.FillAndOutline),
        setLineWidth(size * 0.035),
        setStrokingRgbColor(color.red, color.green, color.blue),
      );
    }
    page.drawText(text, {
      x,
      y: baseline,
      size,
      font,
      color,
      // 斜体のフォントは同梱しないので、文字を傾けて表す
      ySkew: style.italic ? degrees(12) : undefined,
    });
    if (style.bold) page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill), popGraphicsState());
    if (style.link) {
      page.drawLine({ start: { x, y: baseline - 1.5 }, end: { x: x + width, y: baseline - 1.5 }, thickness: 0.5, color });
      this.addLink(x, baseline - size * 0.3, width, size * 1.3, style.link);
    }
    if (style.strike) {
      const y = baseline + size * 0.32;
      page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.6, color });
    }
  }

  private addLink(x: number, y: number, w: number, h: number, url: string): void {
    const ctx = this.doc.context;
    const annot = ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x, y, x + w, y + h],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    });
    this.page.node.addAnnot(ctx.register(annot));
  }

  /** 文章のまとまり(見出し・段落・リストの項目)を描く */
  text(
    runs: Run[],
    opts: { size: number; before: number; after: number; color?: RGB; marker?: string; underline?: boolean },
  ): void {
    const { size } = opts;
    const lh = size * LINE;
    const left = this.left;
    const width = CONTENT_RIGHT - left;
    const lines = breakLines(toAtoms(runs, this.fonts, size), width, this.fonts, size);
    this.space(opts.before);
    lines.forEach((line, i) => {
      this.ensure(lh);
      const baseline = this.y - (lh - size) / 2 - size * 0.86;
      this.quoteBars(lh);
      if (i === 0 && opts.marker) {
        const mw = this.fonts.width(opts.marker, {}, size);
        this.drawLine(toAtoms([{ text: opts.marker, style: {} }], this.fonts, size), left - mw - 5, baseline, size, opts.color ?? COLOR.ink);
      }
      this.drawLine(line, left, baseline, size, opts.color ?? COLOR.ink);
      this.y -= lh;
    });
    if (opts.underline) {
      this.page.drawLine({ start: { x: left, y: this.y }, end: { x: CONTENT_RIGHT, y: this.y }, thickness: 0.75, color: COLOR.hairline });
    }
    this.y -= opts.after;
  }

  /** コードブロック(背景つき、折り返しあり) */
  code(content: string): void {
    const size = CODE;
    const lh = size * 1.55;
    const pad = 8;
    const left = this.left;
    const width = CONTENT_RIGHT - left;
    const src = cleanText(content.replace(/\n$/, ''), true);
    // コードの英数字は等幅にするため code 扱いで測る(背景はブロック全体に描く)。行頭の字下げは残す
    const lines = src
      .split('\n')
      .flatMap((l) =>
        breakLines(toAtoms([{ text: l, style: { code: true } }], this.fonts, size), width - pad * 2, this.fonts, size, true),
      );
    this.space(6);
    const box = (h: number): void => {
      this.page.drawRectangle({ x: left, y: this.y - h, width, height: h, color: COLOR.blockBg });
    };
    this.ensure(pad + lh);
    box(pad);
    this.quoteBars(pad);
    this.y -= pad;
    for (const line of lines) {
      if (this.y - lh < MARGIN.bottom) {
        this.newPage();
      }
      box(lh);
      this.quoteBars(lh);
      const baseline = this.y - (lh - size) / 2 - size * 0.82;
      this.drawPlain(line, left + pad, baseline, size);
      this.y -= lh;
    }
    box(pad);
    this.quoteBars(pad);
    this.y -= pad + 8;
  }

  /** コードの1行(インラインコードの背景は描かない) */
  private drawPlain(line: Atom[], x: number, baseline: number, size: number): void {
    let cx = x;
    for (const atom of line) {
      for (const ch of atom.text) {
        const font = this.fonts.fontFor(ch, { code: true });
        const w = this.fonts.width(ch, { code: true }, size);
        if (ch.trim()) this.page.drawText(ch, { x: cx, y: baseline, size, font, color: COLOR.ink });
        cx += w;
      }
    }
  }

  hr(): void {
    this.space(8);
    this.ensure(10);
    this.page.drawLine({ start: { x: this.left, y: this.y - 4 }, end: { x: CONTENT_RIGHT, y: this.y - 4 }, thickness: 0.75, color: COLOR.hairline });
    this.y -= 16;
  }

  /** 表。列幅は内容に合わせ、入りきらなければ縮めて折り返す */
  table(rows: Array<{ header: boolean; cells: Array<{ runs: Run[]; align: string }> }>): void {
    if (rows.length === 0) return;
    const size = TABLE;
    const lh = size * 1.5;
    const pad = 5;
    const left = this.left;
    const avail = CONTENT_RIGHT - left;
    const cols = Math.max(...rows.map((r) => r.cells.length));
    const natural = Array<number>(cols).fill(pad * 2 + 8);
    const minimum = Array<number>(cols).fill(pad * 2 + 8);
    for (const r of rows) {
      r.cells.forEach((c, i) => {
        const atoms = toAtoms(c.runs, this.fonts, size);
        const total = atoms.reduce((s, a) => s + a.width, 0);
        const longest = atoms.reduce((m, a) => Math.max(m, a.space ? 0 : a.width), 0);
        natural[i] = Math.max(natural[i], Math.min(total, 260) + pad * 2);
        minimum[i] = Math.max(minimum[i], Math.min(longest, 80) + pad * 2);
      });
    }
    let widths = natural;
    const sumNatural = natural.reduce((a, b) => a + b, 0);
    if (sumNatural > avail) {
      const sumMin = minimum.reduce((a, b) => a + b, 0);
      if (sumMin >= avail) widths = minimum.map((m) => (m / sumMin) * avail);
      else {
        const extra = avail - sumMin;
        const flex = natural.map((n, i) => n - minimum[i]);
        const sumFlex = flex.reduce((a, b) => a + b, 0) || 1;
        widths = minimum.map((m, i) => m + (flex[i] / sumFlex) * extra);
      }
    }
    this.space(6);
    for (const row of rows) {
      const laid = widths.map((w, i) => {
        const cell = row.cells[i];
        const style: Style = row.header ? { bold: true } : {};
        const runs = (cell?.runs ?? []).map((r) => ({ ...r, style: { ...r.style, ...style } }));
        return { lines: breakLines(toAtoms(runs, this.fonts, size), w - pad * 2, this.fonts, size), align: cell?.align ?? '' };
      });
      const h = Math.max(...laid.map((c) => c.lines.length)) * lh + pad * 2;
      this.ensure(h);
      let x = left;
      laid.forEach((c, i) => {
        const w = widths[i];
        if (row.header) this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: COLOR.headBg });
        this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, borderColor: COLOR.hairline, borderWidth: 0.6 });
        c.lines.forEach((line, li) => {
          const lw = line.reduce((s, a) => s + a.width, 0);
          const lx = c.align === 'right' ? x + w - pad - lw : c.align === 'center' ? x + (w - lw) / 2 : x + pad;
          const baseline = this.y - pad - li * lh - (lh - size) / 2 - size * 0.86;
          this.drawLine(line, lx, baseline, size, COLOR.ink);
        });
        x += w;
      });
      this.quoteBars(h);
      this.y -= h;
    }
    this.y -= 10;
  }
}

// ---------- 全体 ----------

let fontBytes: Promise<ArrayBuffer> | undefined;

async function loadFont(): Promise<ArrayBuffer> {
  fontBytes ??= fetch(fontUrl).then((r) => {
    if (!r.ok) throw new ConvertError('日本語フォントを読み込めませんでした');
    return r.arrayBuffer();
  });
  return fontBytes;
}

function alignOf(t: Token): string {
  const style = String(t.attrGet('style') ?? '');
  return /text-align:\s*(left|right|center)/.exec(style)?.[1] ?? '';
}

/** ページ番号に使う文字(1回目の組版では描かないので、あらかじめ含める) */
const PAGE_NUMBER_CHARS = '0123456789 /';

interface Built {
  doc: PDFDocument;
  fonts: Fonts;
  title: string;
  notes: Set<string>;
}

/** 文書を組版して PDF を作る(保存はしない) */
async function build(
  tokens: Token[],
  fontData: Uint8Array,
  hasGlyph: (cp: number) => boolean,
  onProgress: (ratio: number) => void,
): Promise<Built> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // サブセット化は pdf-lib の不具合があるため使わない(フォントはあらかじめ小さくしてから渡す)
  const jp = await doc.embedFont(fontData, { subset: false });
  const mono = await doc.embedFont(StandardFonts.Courier);
  const fonts = new Fonts(jp, mono, hasGlyph);
  const w = new Writer(doc, fonts);
  const notes = new Set<string>();
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let marker: string | undefined;
  let title = '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i % 50 === 0) onProgress(i / tokens.length);
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1));
        const inline = tokens[i + 1];
        if (level === 1 && !title) title = inlineText(inline.children, true);
        const size = HEADING[level];
        w.text(inlineRuns(inline.children, { bold: true }, notes), {
          size,
          before: size * (level <= 2 ? 1.1 : 0.9),
          after: size * 0.5,
          underline: level <= 2,
        });
        i += 2;
        break;
      }
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        w.text(inlineRuns(inline.children, {}, notes), {
          size: BODY,
          before: 0,
          after: t.hidden ? 1 : BODY * 0.7,
          color: w.quoteDepth > 0 ? COLOR.body : undefined,
          marker,
        });
        marker = undefined;
        i += 2;
        break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open':
        lists.push({ ordered: t.type === 'ordered_list_open', n: Number(t.attrGet('start') ?? 1) });
        w.indent += INDENT;
        break;
      case 'bullet_list_close':
      case 'ordered_list_close':
        lists.pop();
        w.indent -= INDENT;
        if (lists.length === 0) w.y -= BODY * 0.5;
        break;
      case 'list_item_open': {
        const l = lists[lists.length - 1];
        marker = l.ordered ? `${l.n++}.` : lists.length % 2 === 1 ? '•' : '◦';
        break;
      }
      case 'blockquote_open':
        w.quoteDepth++;
        w.space(2);
        break;
      case 'blockquote_close':
        w.quoteDepth--;
        break;
      case 'fence':
      case 'code_block':
        w.code(t.content);
        break;
      case 'hr':
        w.hr();
        break;
      case 'table_open': {
        const rows: Array<{ header: boolean; cells: Array<{ runs: Run[]; align: string }> }> = [];
        let header = false;
        let j = i + 1;
        for (; j < tokens.length && tokens[j].type !== 'table_close'; j++) {
          const tj = tokens[j];
          if (tj.type === 'thead_open') header = true;
          else if (tj.type === 'thead_close') header = false;
          else if (tj.type === 'tr_open') rows.push({ header, cells: [] });
          else if (tj.type === 'th_open' || tj.type === 'td_open') {
            rows[rows.length - 1].cells.push({ runs: inlineRuns(tokens[j + 1].children, {}, notes), align: alignOf(tj) });
          }
        }
        w.table(rows);
        i = j;
        break;
      }
      default:
        break;
    }
  }

  // ページ番号(下中央)
  const total = w.pages.length;
  w.pages.forEach((page, idx) => {
    const label = `${idx + 1} / ${total}`;
    const lw = jp.widthOfTextAtSize(label, 8.5);
    page.drawText(label, { x: (PAGE.width - lw) / 2, y: 30, size: 8.5, font: jp, color: COLOR.body });
  });
  return { doc, fonts, title, notes };
}

export async function markdownToPdf(input: ConvertInput, ctx: ConvertContext): Promise<ConvertResult> {
  ctx.progress(0.05);
  const [src, bytes] = await Promise.all([readInputText(input), loadFont()]);
  const full = new Uint8Array(bytes);
  const glyphs = fontkit.create(full);
  const hasGlyph = (cp: number): boolean => glyphs.hasGlyphForCodePoint(cp);
  const tokens = md.parse(src, {});
  ctx.progress(0.15);

  // 1回目: 組版して、使う文字を集める
  const first = await build(tokens, full, hasGlyph, (r) => ctx.progress(0.15 + r * 0.3));
  const map = new Map<number, number>();
  for (const cp of [...first.fonts.used, ...[...PAGE_NUMBER_CHARS].map((c) => c.codePointAt(0)!)]) {
    const g = glyphs.glyphForCodePoint(cp);
    if (g && g.id) map.set(cp, g.id);
  }
  // 2回目: 使う文字だけにしたフォントで同じように組版する(字幅は同じなので、結果も同じになる)
  const small = stripTrueType(full, map);
  const { doc, fonts, title, notes } = await build(tokens, small, hasGlyph, (r) => ctx.progress(0.45 + r * 0.4));

  doc.setTitle(title || baseName(input.name));
  doc.setCreator('ファイル変換');
  doc.setProducer('ファイル変換');
  doc.setLanguage('ja');
  ctx.progress(0.9);
  const out = await doc.save();
  if (fonts.missing.size > 0) {
    notes.add(`フォントにない文字(「${[...fonts.missing].slice(0, 3).join('」「')}」など)は、空白や四角で表示されます`);
  }
  return {
    outputs: [{ name: `${baseName(input.name)}.pdf`, blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }) }],
    notes: [...notes],
  };
}
