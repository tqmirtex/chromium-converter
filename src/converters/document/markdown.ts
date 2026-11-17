import MarkdownIt, { type Token } from 'markdown-it';

/**
 * Markdown の読み込み。
 * html: false … 文中の生の HTML(<script> など)はタグとして解釈せず、文字としてエスケープする。
 * markdown-it は既定で javascript: / vbscript: / file: / data:(画像以外)のリンクを無効にする。
 */
export const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

/** インライン要素を文字だけにする。リンクは「文字 (URL)」にする。 */
export function inlineText(children: Token[] | null, singleLine = false): string {
  if (!children) return '';
  let out = '';
  const hrefs: string[] = [];
  for (const t of children) {
    switch (t.type) {
      case 'text':
      case 'code_inline':
      case 'html_inline':
        out += t.content;
        break;
      case 'softbreak':
      case 'hardbreak':
        out += singleLine ? ' ' : '\n';
        break;
      case 'image':
        out += t.content || t.attrGet('alt') || '';
        break;
      case 'link_open':
        hrefs.push(String(t.attrGet('href') ?? ''));
        out += '\u0000';
        break;
      case 'link_close': {
        const href = hrefs.pop() ?? '';
        const start = out.lastIndexOf('\u0000');
        const label = out.slice(start + 1);
        out = out.slice(0, start) + label + (href && href !== label && !href.startsWith('mailto:') ? ` (${href})` : '');
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Markdown → 書式を外したテキスト */
export function markdownToText(src: string): string {
  const tokens = md.parse(src, {});
  const lines: string[] = [];
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let pendingPrefix = '';
  let quoteDepth = 0;
  let row: string[] | null = null;
  const indent = (): string => '  '.repeat(lists.length);
  const push = (s: string): void => {
    lines.push('> '.repeat(quoteDepth) + s);
  };
  for (const t of tokens) {
    switch (t.type) {
      case 'bullet_list_open':
        lists.push({ ordered: false, n: 0 });
        break;
      case 'ordered_list_open':
        lists.push({ ordered: true, n: Number(t.attrGet('start') ?? 1) });
        break;
      case 'bullet_list_close':
      case 'ordered_list_close':
        lists.pop();
        if (lists.length === 0) push('');
        break;
      case 'list_item_open': {
        const l = lists[lists.length - 1];
        pendingPrefix = '  '.repeat(lists.length - 1) + (l.ordered ? `${l.n++}. ` : '・');
        break;
      }
      case 'blockquote_open':
        quoteDepth++;
        break;
      case 'blockquote_close':
        quoteDepth--;
        break;
      case 'tr_open':
        row = [];
        break;
      case 'tr_close':
        if (row) push(row.join('\t'));
        row = null;
        break;
      case 'table_close':
        push('');
        break;
      case 'inline': {
        if (row) {
          row.push(inlineText(t.children, true));
          break;
        }
        const prefix = pendingPrefix || (lists.length ? indent() : '');
        pendingPrefix = '';
        inlineText(t.children)
          .split('\n')
          .forEach((s, i) => push((i === 0 ? prefix : ' '.repeat(prefix.length)) + s));
        break;
      }
      case 'paragraph_close':
      case 'heading_close':
        if (!t.hidden && lists.length === 0) push('');
        break;
      case 'fence':
      case 'code_block':
        for (const s of t.content.replace(/\n$/, '').split('\n')) push((lists.length ? indent() : '') + s);
        push('');
        break;
      case 'hr':
        push('―'.repeat(20));
        push('');
        break;
      default:
        break;
    }
  }
  return (
    lines
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

/** Markdown の中の表をすべて取り出す(1行目は見出し) */
export function markdownTables(src: string): string[][][] {
  const tables: string[][][] = [];
  let table: string[][] | null = null;
  let row: string[] | null = null;
  for (const t of md.parse(src, {})) {
    if (t.type === 'table_open') table = [];
    else if (t.type === 'table_close') {
      if (table) tables.push(table);
      table = null;
    } else if (t.type === 'tr_open') row = [];
    else if (t.type === 'tr_close') {
      if (table && row) table.push(row);
      row = null;
    } else if (t.type === 'inline' && row) {
      // セル内の <br>(表の中で改行を表す一般的な書き方)は改行に戻す
      row.push(inlineText(t.children, true).replace(/<br\s*\/?>/gi, '\n'));
    }
  }
  return tables;
}

const HTML_STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #171717; font: 16px/1.7 -apple-system, system-ui, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.6em; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; border-bottom: 1px solid #dcdee0; padding-bottom: 0.2em; }
a { color: #0d74ce; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
code { background: #f0f0f3; padding: 0.1em 0.3em; border-radius: 4px; }
pre { background: #f5f5f7; padding: 16px; border-radius: 8px; overflow-x: auto; line-height: 1.5; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0 1em; color: #60646c; border-left: 4px solid #dcdee0; }
table { border-collapse: collapse; margin: 1em 0; display: block; overflow-x: auto; }
th, td { border: 1px solid #dcdee0; padding: 6px 12px; text-align: left; }
th { background: #fafafa; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #dcdee0; margin: 2em 0; }
`.trim();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Markdown → 単体で開ける HTML(スタイルは埋め込み、外部の読み込みなし) */
export function markdownToHtml(src: string, fallbackTitle: string): string {
  const tokens = md.parse(src, {});
  const h1 = tokens.findIndex((t) => t.type === 'heading_open' && t.tag === 'h1');
  const title = h1 >= 0 ? inlineText(tokens[h1 + 1].children, true) : fallbackTitle;
  const body = md.renderer.render(tokens, md.options, {});
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${HTML_STYLE}
</style>
</head>
<body>
<main>
${body}</main>
</body>
</html>
`;
}
