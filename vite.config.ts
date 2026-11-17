import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { defineConfig, type Plugin } from 'vite';

/**
 * pdf.js が実行時に読む資源(日本語などの CMap、標準フォント、画像デコーダーの wasm、色の ICC)を
 * dist/pdfjs/ にコピーする。外部の CDN からは取得しない。
 * PDF 内の JavaScript を動かすための quickjs は使わないのでコピーしない。
 */
export function copyPdfjsAssets(outDir: string): Plugin {
  return {
    name: 'copy-pdfjs-assets',
    apply: 'build',
    writeBundle() {
      const src = 'node_modules/pdfjs-dist';
      const dest = join(outDir, 'pdfjs');
      for (const dir of ['cmaps', 'standard_fonts', 'iccs']) cpSync(join(src, dir), join(dest, dir), { recursive: true });
      mkdirSync(join(dest, 'wasm'), { recursive: true });
      for (const f of readdirSync(join(src, 'wasm'))) {
        if (f.toLowerCase().includes('quickjs') || f.endsWith('.js')) continue;
        cpSync(join(src, 'wasm', f), join(dest, 'wasm', f));
      }
    },
  };
}

/**
 * Mediabunny の MP3 / FLAC / AAC エンコーダーは、Worker のコードを文字列で持ち、blob: URL から Worker を作る。
 * 拡張機能の CSP(script-src 'self')では blob: の Worker を作れないため、ビルド時にその文字列を
 * 独立したファイル(dist/assets/mediabunny-<種類>-encoder.worker.js)に書き出し、そのファイルから Worker を作るよう書き換える。
 * 中身(LAME / libFLAC / FFmpeg の AAC エンコーダーの wasm を含む)は変えない。
 */
export function mediabunnyEncoderWorkers(outDir: string): { transform: Plugin; write: Plugin } {
  const extracted = new Map<string, string>();
  const pattern = /@mediabunny[\\/](mp3|flac|aac)-encoder[\\/]dist[\\/]bundles[\\/][^\\/]+\.mjs$/;
  const marker = 'return inlineWorker(';
  const transform: Plugin = {
    name: 'mediabunny-encoder-workers',
    transform(code, id) {
      const m = pattern.exec(id);
      if (!m) return null;
      const at = code.indexOf(marker);
      if (at < 0 || code.indexOf(marker, at + 1) >= 0) {
        throw new Error(`${id}: Worker の作り方が想定と違います(ライブラリの更新を確認してください)`);
      }
      const start = at + marker.length;
      const quote = code[start];
      let i = start + 1;
      while (code[i] !== quote) i += code[i] === '\\' ? 2 : 1;
      // 文字列リテラルの中身を取り出す(ビルド時に Node で評価する。拡張機能の実行時には eval しない)
      const text = vm.runInNewContext(code.slice(start, i + 1)) as string;
      extracted.set(m[1], text);
      const end = code.indexOf(')', i);
      const file = `/assets/mediabunny-${m[1]}-encoder.worker.js`;
      return code.slice(0, at) + `return new Worker(new URL(${JSON.stringify(file)}, self.location.href))` + code.slice(end + 1);
    },
  };
  const write: Plugin = {
    name: 'mediabunny-encoder-workers-write',
    apply: 'build',
    writeBundle() {
      mkdirSync(join(outDir, 'assets'), { recursive: true });
      for (const [k, text] of extracted) writeFileSync(join(outDir, 'assets', `mediabunny-${k}-encoder.worker.js`), text);
    },
  };
  return { transform, write };
}

const encoderWorkers = mediabunnyEncoderWorkers('dist');

export default defineConfig({
  publicDir: 'public',
  plugins: [copyPdfjsAssets('dist'), encoderWorkers.transform, encoderWorkers.write],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome117',
    // 拡張機能の CSP ではインラインスクリプトを使えないため、modulepreload のポリフィルは入れない
    modulePreload: false,
    // HEIC(約2MB)や AVIF の wasm は使うときだけ読み込む別ファイルなので、大きくてもよい
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      input: {
        sidepanel: 'sidepanel.html',
        offscreen: 'offscreen.html',
        permission: 'permission.html',
        background: 'src/background/index.ts',
      },
      output: {
        // Service Worker は manifest から固定名で参照する
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  worker: {
    format: 'es',
    // 変換用 Worker の中で読み込むエンコーダーにも、同じ書き換えをする
    plugins: () => [encoderWorkers.transform],
  },
});
