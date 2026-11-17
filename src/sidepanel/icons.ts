/** 状態アイコン(16px、線のみ)。色だけで状態を伝えないよう、必ず文字ラベルと並べて使う。 */
const svg = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  waiting: svg('<circle cx="8" cy="8" r="6"/>'),
  converting: svg('<path d="M14 8a6 6 0 1 1-6-6"/>'),
  done: svg('<circle cx="8" cy="8" r="6"/><path d="M5.5 8.2l1.8 1.8 3.2-3.6"/>'),
  skipped: svg('<circle cx="8" cy="8" r="6"/><path d="M5.5 8h5"/>'),
  failed: svg('<circle cx="8" cy="8" r="6"/><path d="M6 6l4 4M10 6l-4 4"/>'),
  unsupported: svg('<circle cx="8" cy="8" r="6"/><path d="M3.8 12.2l8.4-8.4"/>'),
  excluded: svg('<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11.3v.2"/>'),
  remove: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  up: svg('<path d="M4.5 9.5L8 6l3.5 3.5"/>'),
  down: svg('<path d="M4.5 6.5L8 10l3.5-3.5"/>'),
  grip: svg('<path d="M6 4.5h.01M10 4.5h.01M6 8h.01M10 8h.01M6 11.5h.01M10 11.5h.01" stroke-width="2.2"/>'),
  upload: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>`,
} as const;
