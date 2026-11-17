declare module 'pdfjs-dist/build/pdf.worker.mjs';

// File System Access API のフォルダ選択(TypeScript の DOM 型にまだ含まれていない部分)
interface Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | FileSystemHandle;
  }) => Promise<FileSystemDirectoryHandle>;
}

declare module 'gifenc' {
  type Palette = number[][];
  interface GifEncoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: Palette; delay?: number; repeat?: number; dispose?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: string }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
}

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: (options?: object) => Promise<unknown>;
  export default factory;
}
