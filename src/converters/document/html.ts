import TurndownService from 'turndown';
import { ConvertError, type ConvertContext, type ConvertInput, type ConvertResult, type FormatId } from '../../core/types';
import { outputNames, textOutput } from './output';
import { readInputText } from './read';

/**
 * HTML → Markdown / テキスト。DOM(DOMParser)が必要なので、Worker ではなくサイドパネル側で動かす。
 * DOMParser で作った文書は表示されないため、スクリプトは実行されず、画像などの外部リソースも読み込まれない。
 * 実際のページには挿入しない。
 */

/** 内容として不要・危険な要素は、変換前に取り除く */
const REMOVE = 'script, style, noscript, template, iframe, object, embed, link, meta, base, svg, canvas, form button';

function parseHtml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  for (const el of doc.querySelectorAll(REMOVE)) el.remove();
  return doc;
}

function cellText(cell: Element): string {
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

/** 表は GFM の表にする(セル内の書式は文字だけにする) */
function tableToMarkdown(table: HTMLTableElement): string {
  const rows = [...table.rows].map((r) => [...r.cells].map(cellText));
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]): string => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const [header, ...body] = rows;
  return `\n\n${[line(header), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join('\n')}\n\n`;
}

function toMarkdown(doc: Document): string {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
  });
  service.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => tableToMarkdown(node as HTMLTableElement),
  });
  const title = doc.title.trim();
  const hasH1 = doc.body.querySelector('h1') !== null;
  const body = service.turndown(doc.body).trim();
  return `${title && !hasH1 ? `# ${title}\n\n` : ''}${body}\n`;
}

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER',
  'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TR', 'UL', 'CAPTION', 'DETAILS', 'SUMMARY',
]);

/** 見た目の改行を保ちながら、文字だけを取り出す */
function toText(doc: Document): string {
  let out = '';
  const newline = (): void => {
    if (out && !out.endsWith('\n')) out += '\n';
  };
  const walk = (node: Node, pre: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? '';
      out += pre ? t : t.replace(/\s+/g, ' ');
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    const block = BLOCK.has(tag);
    if (block) newline();
    if (/^H[1-6]$/.test(tag) || tag === 'P') out += out ? '\n' : '';
    if (tag === 'LI') out += '・';
    if (tag === 'HR') out += '―'.repeat(20);
    if (tag === 'TD' || tag === 'TH') {
      if (node.previousElementSibling) out += '\t';
    }
    if (tag === 'IMG') out += (node as HTMLImageElement).alt;
    for (const child of node.childNodes) walk(child, pre || tag === 'PRE');
    if (block) newline();
  };
  walk(doc.body, false);
  return (
    out
      .split('\n')
      .map((l) => l.replace(/[  ]+$/g, '').replace(/^ +/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertResult> {
  ctx.progress(0.1);
  const doc = parseHtml(await readInputText(input));
  ctx.progress(0.5);
  let text: string;
  if (to === 'md') text = toMarkdown(doc);
  else if (to === 'txt') text = toText(doc);
  else throw new ConvertError(`HTML から ${to} への変換には対応していません`);
  return { outputs: [textOutput(text, to, outputNames(input, to, [])[0])], notes: [] };
}
