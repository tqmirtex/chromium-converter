import { sanitizeFileName } from '../core/filename';
import type { ConvertOutput } from '../core/types';

/**
 * 保存方法
 * - individual: 1ファイルずつダウンロード先に保存(chrome.downloads)
 * - folder: 選んだフォルダにまとめて書き込む(File System Access API)
 * - zip: 選んだフォルダに ZIP を1つ書き込む
 *
 * 一括保存で chrome.downloads を使うと、Chrome の「ダウンロード前に各ファイルの保存場所を確認する」設定が
 * オンのとき、ファイルごとに保存ダイアログが出てしまう(拡張機能からは止められない)。
 * そのため一括保存は、最初に保存先のフォルダを1回選んでもらい、そこへ直接書き込む。
 * フォルダを選べない環境(API がない場合)だけ、ダウンロード先の「ファイル変換/日付_時刻」に chrome.downloads で保存する。
 */
export type SaveMode = 'individual' | 'folder' | 'zip';

const ROOT_FOLDER = 'ファイル変換';

export interface SaveFailure {
  output: ConvertOutput;
  message: string;
}

export interface SaveResult {
  saved: number;
  failures: SaveFailure[];
  /** 一括のとき、保存先(フォルダ名やファイル名) */
  location?: string;
}

export interface SaveOptions {
  mode: SaveMode;
  /** ZIP を作る関数(UI を止めないよう Worker で作るものを渡す) */
  zip: (files: ConvertOutput[]) => Promise<Blob>;
  /** 一括保存の保存先(利用者が選んだフォルダ) */
  directory?: FileSystemDirectoryHandle;
  now?: Date;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** ZIP 名などに使う「日付_時刻」(例: 20261117_103015) */
function batchName(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------- 保存先のフォルダを選ぶ ----------

export function canPickDirectory(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/**
 * 保存先のフォルダを選んでもらう。ボタンを押した操作の中で、ほかの await より先に呼ぶこと(ブラウザの制約)。
 * 選ばれなかったときは null。前回選んだ場所から開く。
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!window.showDirectoryPicker) return null;
    return await window.showDirectoryPicker({ id: 'file-convert-bulk', mode: 'readwrite', startIn: 'downloads' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** 同じ名前があれば「名前 (1).拡張子」のように番号を付けて、上書きせずに書き込む */
async function writeFile(dir: FileSystemDirectoryHandle, name: string, blob: Blob, reserved: Set<string>): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let n = 1; reserved.has(candidate.toLowerCase()) || (await exists(dir, candidate)); n++) {
    candidate = `${stem} (${n})${ext}`;
  }
  reserved.add(candidate.toLowerCase());
  const handle = await dir.getFileHandle(candidate, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return candidate;
}

// ---------- chrome.downloads ----------

/** ダウンロードが終わったら Blob URL を解放する(終わらない場合に備えて時間でも解放する) */
function revokeWhenDone(downloadId: number, url: string): void {
  const timer = setTimeout(done, 5 * 60 * 1000);
  function done(): void {
    clearTimeout(timer);
    chrome.downloads.onChanged.removeListener(listener);
    URL.revokeObjectURL(url);
  }
  function listener(delta: chrome.downloads.DownloadDelta): void {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') done();
  }
  chrome.downloads.onChanged.addListener(listener);
}

/** filename はダウンロード先からの相対パス。同名は番号を付けて保存する。 */
async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    revokeWhenDone(id, url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * 変換結果のリストを保存する共通の入口。
 * 1ファイルから複数の出力ができる変換(PDF → 画像など)も、このリストに入れて渡す。
 * 一部の保存に失敗しても、残りは保存する。
 */
export async function saveOutputs(outputs: ConvertOutput[], options: SaveOptions): Promise<SaveResult> {
  const result: SaveResult = { saved: 0, failures: [] };
  if (outputs.length === 0) return result;
  const batch = batchName(options.now ?? new Date());
  const dir = options.directory;

  switch (options.mode) {
    case 'individual':
      for (const out of outputs) {
        try {
          await downloadBlob(out.blob, sanitizeFileName(out.name));
          result.saved++;
        } catch (error) {
          result.failures.push({ output: out, message: `保存に失敗しました(${errorText(error)})` });
        }
      }
      break;
    case 'folder': {
      const reserved = new Set<string>();
      result.location = dir ? dir.name : `${ROOT_FOLDER}/${batch}`;
      for (const out of outputs) {
        const name = sanitizeFileName(out.name);
        try {
          if (dir) await writeFile(dir, name, out.blob, reserved);
          else await downloadBlob(out.blob, `${ROOT_FOLDER}/${batch}/${name}`);
          result.saved++;
        } catch (error) {
          result.failures.push({ output: out, message: `保存に失敗しました(${errorText(error)})` });
        }
      }
      break;
    }
    case 'zip': {
      try {
        const zip = await options.zip(outputs.map((o) => ({ name: sanitizeFileName(o.name), blob: o.blob })));
        if (dir) {
          const name = await writeFile(dir, `${ROOT_FOLDER}_${batch}.zip`, zip, new Set());
          result.location = `${dir.name}/${name}`;
        } else {
          result.location = `${ROOT_FOLDER}/${batch}.zip`;
          await downloadBlob(zip, result.location);
        }
        result.saved = outputs.length;
      } catch (error) {
        const message = `ZIPの作成・保存に失敗しました(${errorText(error)})`;
        result.failures = outputs.map((output) => ({ output, message }));
      }
      break;
    }
  }
  return result;
}
