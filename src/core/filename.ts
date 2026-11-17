/** 拡張子を除いた名前。拡張子がなければそのまま。 */
export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** 拡張子だけを変える */
export function replaceExt(name: string, ext: string): string {
  return `${baseName(name)}.${ext.toLowerCase()}`;
}

/** 重なった名前に「 (1)」「 (2)」… を付けて一意にする(ZIP の中など、uniquify が効かない場所で使う) */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** URL からファイル名を取り出す。取れないときは「image」 */
export function fileNameFromUrl(url: string, fallback = 'image'): string {
  if (url.startsWith('data:')) return fallback;
  let last: string;
  try {
    last = new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    return fallback;
  }
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // 不正な %エスコープはそのまま使う
  }
  decoded = decoded.trim();
  return baseName(decoded) ? decoded : fallback;
}

/** chrome.downloads が受け付けない文字を置き換える */
export function sanitizeFileName(name: string): string {
  let s = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').trim();
  // 先頭・末尾のドットや空白は保存に失敗することがある
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  return s || 'file';
}
