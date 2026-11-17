import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';

/** Inter(英数字)を同梱ファイルから読み込む。日本語は OS のフォントで表示する。 */
export function loadFonts(): void {
  const faces: Array<[string, string]> = [
    [inter400, '400'],
    [inter500, '500'],
    [inter600, '600'],
  ];
  for (const [url, weight] of faces) {
    const face = new FontFace('Inter', `url(${url}) format('woff2')`, { weight, display: 'swap' });
    document.fonts.add(face);
    face.load().catch((error: unknown) => console.warn('フォントを読み込めませんでした', error));
  }
}
