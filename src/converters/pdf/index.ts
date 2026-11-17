import type { Converter } from '../../core/types';

/** PDF 変換(画像 ⇔ PDF、PDF → テキスト、Markdown → PDF) */
export const pdfConverters: Converter[] = [
  ...(['png', 'jpeg', 'webp'] as const).map(
    (from): Converter => ({
      id: `${from}->pdf`,
      from,
      to: 'pdf',
      engine: 'pdf',
      mergeable: true,
      usage: '印刷・共有向け。画像を劣化させずにPDFのページにする',
    }),
  ),
  {
    id: 'pdf->png',
    from: 'pdf',
    to: 'png',
    engine: 'pdf',
    multiOutput: true,
    usage: 'ページごとの画像に。文字がくっきり(ファイルは大きめ)',
  },
  {
    id: 'pdf->jpeg',
    from: 'pdf',
    to: 'jpeg',
    engine: 'pdf',
    multiOutput: true,
    usage: 'ページごとの画像に。軽くて共有向け(写真の多いPDFに)',
  },
  {
    id: 'pdf->txt',
    from: 'pdf',
    to: 'txt',
    engine: 'pdf',
    usage: 'PDFの文字だけを取り出す(スキャンしたPDFは不可)',
  },
  {
    id: 'md->pdf',
    from: 'md',
    to: 'pdf',
    engine: 'pdf',
    usage: '見出し・表を整えて印刷・配布できる文書に(日本語対応)',
  },
];
