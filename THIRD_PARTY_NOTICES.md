# サードパーティのライセンス

この拡張機能は、以下のソフトウェアをビルド成果物(`dist/`)に同梱しています(画面のフォントの Inter 以外は、変換に使うときだけ読み込む別ファイルになっています)。開発時だけに使うもの(Vite・TypeScript・型定義)は同梱していません。各ライセンスの全文は、括弧内のファイル(`npm install` 後の `node_modules/` 内)を参照してください。

| 名前 | バージョン | ライセンス | 用途 | 入手先 |
|---|---|---|---|---|
| @jsquash/avif | 2.1.1 | Apache-2.0 | AVIF の書き出し | https://github.com/jamsinclair/jSquash |
| └ libavif(上記の wasm に含まれる) | — | BSD-2-Clause | 同上 | https://github.com/AOMediaCodec/libavif |
| └ libaom(上記の wasm に含まれる) | — | BSD-2-Clause + AOMedia Patent License 1.0 | 同上 | https://aomedia.googlesource.com/aom |
| libheif-js | 1.23.5 | LGPL-3.0 | HEIC / HEIF の読み込み | https://github.com/catdad-experiments/libheif-js |
| └ libheif(上記に含まれる) | — | LGPL-3.0 | 同上 | https://github.com/strukturag/libheif |
| └ libde265(上記に含まれる) | — | LGPL-3.0 | 同上 | https://github.com/strukturag/libde265 |
| utif2 | 4.1.0 | MIT | TIFF の読み込み | https://github.com/photopea/UTIF.js |
| └ pako | 1.0.11 | MIT AND Zlib | TIFF の Deflate 圧縮の展開(utif2 が使用) | https://github.com/nodeca/pako |
| SheetJS(xlsx) | 0.20.3 | Apache-2.0 | Excel の読み書き | https://sheetjs.com/(npm の 0.18.5 は既知の脆弱性があるため、公式配布の 0.20.3 を使用) |
| markdown-it | 15.0.3 | MIT | Markdown の解析・HTML への変換 | https://github.com/markdown-it/markdown-it |
| └ entities | 8.1.0 | BSD-2-Clause | 同上(markdown-it が使用) | https://github.com/fb55/entities |
| └ linkify-it | 6.1.0 | MIT | 同上 | https://github.com/markdown-it/linkify-it |
| └ mdurl | 2.1.0 | MIT | 同上 | https://github.com/markdown-it/mdurl |
| └ uc.micro | 3.0.0 | MIT | 同上 | https://github.com/markdown-it/uc.micro |
| └ punycode.js | 2.3.1 | MIT | 同上 | https://github.com/mathiasbynens/punycode.js |
| turndown | 7.2.5 | MIT | HTML → Markdown | https://github.com/mixmark-io/turndown |
| yaml | 2.9.1 | ISC | YAML の読み書き | https://github.com/eemeli/yaml |
| smol-toml | 1.9.1 | BSD-3-Clause | TOML の読み書き | https://github.com/squirrelchat/smol-toml |
| pdf-lib | 1.17.1 | MIT | PDF の作成(画像 → PDF、Markdown → PDF) | https://github.com/Hopding/pdf-lib |
| └ @pdf-lib/standard-fonts | 1.0.0 | MIT | 同上(pdf-lib が使用) | https://github.com/Hopding/standard-fonts |
| └ @pdf-lib/upng | 1.0.1 | MIT | 同上(PNG の読み込み) | https://github.com/Hopding/upng |
| └ pako | 1.0.11 | MIT AND Zlib | 同上(圧縮) | https://github.com/nodeca/pako |
| └ tslib | 1.14.1 | 0BSD | 同上 | https://github.com/microsoft/tslib |
| @pdf-lib/fontkit | 1.1.1 | MIT | PDF へのフォントの埋め込み(pako 1.0.11 を共有) | https://github.com/Hopding/fontkit |
| pdfjs-dist(pdf.js) | 6.5.438 | Apache-2.0 | PDF の描画(PDF → 画像)・文字の取り出し(PDF → テキスト) | https://github.com/mozilla/pdf.js |
| └ CMap(`dist/pdfjs/cmaps`) | — | BSD-3-Clause(Adobe) | 日本語などの PDF の文字の対応表 | https://github.com/adobe-type-tools/cmap-resources |
| └ 標準フォント Foxit(`dist/pdfjs/standard_fonts`) | — | BSD-3-Clause(PDFium) | 埋め込みのない PDF の文字の描画 | https://pdfium.googlesource.com/pdfium/ |
| └ 標準フォント Liberation Sans(同上) | 1.x | GPL-2.0 + フォント例外(Red Hat) | 同上(Helvetica などの代わり) | https://github.com/liberationfonts |
| └ OpenJPEG(`dist/pdfjs/wasm/openjpeg.wasm`) | — | BSD-2-Clause | PDF 内の JPEG 2000 画像の展開 | https://github.com/uclouvain/openjpeg |
| └ JBIG2(`dist/pdfjs/wasm/jbig2.wasm`) | — | BSD-3-Clause(PDFium) | PDF 内の JBIG2 画像の展開 | https://pdfium.googlesource.com/pdfium/ |
| └ qcms(`dist/pdfjs/wasm/qcms_bg.wasm`) | — | MIT | 色の変換 | https://github.com/FirefoxGraphics/qcms |
| └ ICC プロファイル(`dist/pdfjs/iccs`) | — | CC0-1.0 | 色の変換 | — |
| Noto Sans JP(@expo-google-fonts/noto-sans-jp の Regular のみ) | 0.4.4 | フォント: SIL Open Font License 1.1 / パッケージ: MIT | Markdown → PDF の日本語フォント | https://fonts.google.com/noto/specimen/Noto+Sans+JP |
| Mediabunny | 1.66.0 | MPL-2.0 | 音声・動画の読み書き(WebCodecs と組み合わせて変換) | https://github.com/Vanilagy/mediabunny |
| @mediabunny/mp3-encoder | 1.66.0 | MPL-2.0 | MP3 の書き出し | 同上 |
| └ LAME(上記の wasm に含まれる) | 3.100 | LGPL-2.0 | 同上 | https://lame.sourceforge.io/ |
| @mediabunny/flac-encoder | 1.66.0 | MPL-2.0 | FLAC の書き出し | 同上 |
| └ libFLAC(上記の wasm に含まれる) | — | BSD-3-Clause(Xiph.Org) | 同上 | https://github.com/xiph/flac |
| @mediabunny/aac-encoder | 1.66.0 | MPL-2.0 | AAC の書き出し | 同上 |
| └ FFmpeg の AAC エンコーダー(上記の wasm に含まれる) | — | LGPL-2.1 | 同上 | https://ffmpeg.org/ |
| gifenc | 1.0.3 | MIT | アニメーション GIF の書き出し | https://github.com/mattdesl/gifenc |
| fflate | 0.8.3 | MIT | ZIP の作成(一括保存)、ZIP / TAR.GZ の圧縮・展開、WOFF の圧縮・展開 | https://github.com/101arrowz/fflate |
| brotli-wasm | 3.0.1 | Apache-2.0 | WOFF2 の圧縮・展開 | https://github.com/httptoolkit/brotli-wasm |
| └ Brotli(上記の wasm に含まれる) | — | MIT | 同上 | https://github.com/google/brotli |
| Inter(@fontsource/inter) | 5.3.0 | SIL Open Font License 1.1 | 画面のフォント(英数字) | https://github.com/rsms/inter |

ライセンス全文の場所:

- @jsquash/avif: `node_modules/@jsquash/avif/LICENSE`
- libheif-js / libheif / libde265: `node_modules/libheif-js/LICENSE`、`node_modules/libheif-js/libheif-wasm/LICENSE`
- fflate: `node_modules/fflate/LICENSE`
- Mediabunny: `node_modules/mediabunny/LICENSE`(MPL-2.0)
- MP3 / FLAC / AAC エンコーダー: `node_modules/@mediabunny/*-encoder/LICENSE`(MPL-2.0)。含まれるライブラリのライセンスは `node_modules/@mediabunny/mp3-encoder/licenses/lame/`、`node_modules/@mediabunny/flac-encoder/licenses/libflac/COPYING.Xiph`、`node_modules/@mediabunny/aac-encoder/licenses/ffmpeg/`
- gifenc: `node_modules/gifenc/LICENSE.md`
- pdf-lib と依存: `node_modules/pdf-lib/LICENSE.md`、`node_modules/@pdf-lib/standard-fonts/LICENSE.md`、`node_modules/@pdf-lib/upng/LICENSE`、`node_modules/pdf-lib/node_modules/pako/LICENSE`、`node_modules/pdf-lib/node_modules/tslib/LICENSE.txt`
- @pdf-lib/fontkit: パッケージに LICENSE ファイルは含まれていない(`package.json` の license は MIT。元の fontkit の著作権表示は https://github.com/foliojs/fontkit/blob/master/LICENSE)
- pdf.js: `node_modules/pdfjs-dist/LICENSE`。同梱する資源のライセンスは `dist/pdfjs/` 内の各 LICENSE ファイル(`cmaps/LICENSE`、`standard_fonts/LICENSE_FOXIT`・`LICENSE_LIBERATION`、`wasm/LICENSE_*`、`iccs/LICENSE`)
- Noto Sans JP: SIL Open Font License 1.1(https://openfontlicense.org/)。パッケージのライセンスは `node_modules/@expo-google-fonts/noto-sans-jp/LICENSE`
- SheetJS: `node_modules/xlsx/LICENSE`
- markdown-it と依存: `node_modules/markdown-it/LICENSE`、`node_modules/entities/LICENSE`、`node_modules/linkify-it/LICENSE`、`node_modules/mdurl/LICENSE`、`node_modules/uc.micro/LICENSE.txt`、`node_modules/punycode.js/LICENSE-MIT.txt`
- turndown: `node_modules/turndown/LICENSE`
- yaml: `node_modules/yaml/LICENSE`
- smol-toml: `node_modules/smol-toml/LICENSE`
- utif2: `node_modules/utif2/LICENSE`
- utif2 が使う pako: `node_modules/utif2/node_modules/pako/LICENSE`
- brotli-wasm: `node_modules/brotli-wasm/LICENSE`(含まれる Brotli は MIT)
- Inter: `node_modules/@fontsource/inter/LICENSE`

## MPL-2.0 の部品(Mediabunny)について

Mediabunny とそのエンコーダー拡張は MPL-2.0 です。MPL-2.0 はファイル単位のコピーレフトで、MIT のコードと一緒に配布できます。

- Mediabunny 本体は変更せずに同梱しています。
- MP3 / FLAC / AAC のエンコーダー拡張は、拡張機能の CSP で動かすため、ビルド時に「Worker を作る1か所」だけを書き換えています(blob: URL から作る代わりに、同梱した Worker ファイルから作る)。Worker のコード(wasm を含む)の中身は変えていません。この書き換えの処理は `vite.config.ts` の `mediabunnyEncoderWorkers` で、このリポジトリで公開しています。書き換えた部分は MPL-2.0 のままです。
- 元のソースは上の入手先(https://github.com/Vanilagy/mediabunny)から取得できます。

## LAME・FFmpeg(LGPL)のエンコーダーについて

MP3 の書き出しに使う LAME(LGPL-2.0)と、AAC の書き出しに使う FFmpeg の AAC エンコーダー(LGPL-2.1)は、それぞれ `dist/assets/mediabunny-mp3-encoder.worker.js`・`dist/assets/mediabunny-aac-encoder.worker.js` という独立した Worker ファイルにまとまっており、差し替えられます。LAME の作者の求めに従い、ここに記します:この拡張機能は MP3 の書き出しに LAME(https://lame.sourceforge.io/)を使っています。

## GPL-2.0 の標準フォント(Liberation Sans)について

pdf.js が、PDF に埋め込まれていない標準フォント(Helvetica など)の代わりに使う Liberation Sans 1.x は、GPL-2.0(フォントの例外付き)です。拡張機能のコードとは結び付けず、`dist/pdfjs/standard_fonts/` に独立したフォントファイルとして置き、ライセンス全文(`LICENSE_LIBERATION`)も一緒に配布しています。

## LGPL-3.0 の部品について

HEIC の読み込みに使う libheif・libde265 は LGPL-3.0 です。この拡張機能自体は MIT ライセンスですが、これらの部品は LGPL-3.0 のままです。

- これらは `dist/assets/heic-*.js` という独立したファイルにまとまっており、利用者が別のビルドに差し替えられます。
- ソースコードは上の表の入手先から取得できます。
- ビルド成果物を配布する場合は、このファイルと各ライセンスの全文を一緒に配布してください。

## このリポジトリ自体のライセンスとの関係

この拡張機能のソースコード(`src/` など)は MIT License です。上の部品はそれぞれのライセンスのまま同梱しており、MIT のコードとは独立したファイルになっています。コピーレフトのライセンス(LGPL・MPL-2.0・GPL-2.0 のフォント)の部品も、ソースの入手先とライセンス全文を示し、差し替えられる形で配布しているので、MIT で公開することと矛盾しません。ビルド成果物(`dist/`)を配布するときは、このファイルと各ライセンスの全文を一緒に配布してください。
