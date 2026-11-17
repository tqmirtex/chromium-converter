import { detectFormat } from '../core/detect';
import { getFormat } from '../core/formats';
import { MAX_FILE_BYTES, formatBytes } from '../core/limits';
import { isDomEngine } from '../core/engines';
import { toUserMessage } from '../core/errors';
import { CONVERTERS, candidateTargets, findConverter, type Candidate } from '../core/registry';
import type { ConvertOutput, ConvertResult, FormatId } from '../core/types';
import { CancelledError, ConvertClient } from '../dom/client';
import { DOM_ENGINES } from '../dom/engines';
import { prepare } from '../dom/prepare';
import { canPickDirectory, pickDirectory, saveOutputs, type SaveMode } from '../dom/save';
import { loadFonts } from '../ui/fonts';
import { ICONS } from './icons';

type Status = 'waiting' | 'converting' | 'done' | 'skipped' | 'failed' | 'unsupported' | 'excluded';

const STATUS_LABEL: Record<Status, string> = {
  waiting: '待機',
  converting: '変換中',
  done: '完了',
  skipped: '変換不要',
  failed: '失敗',
  unsupported: '未対応',
  excluded: '対象外',
};

interface Item {
  id: number;
  file: File;
  format: FormatId | null;
  status: Status;
  message: string;
  tone: 'normal' | 'error';
  el: HTMLLIElement;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} がありません`);
  return el as T;
};

const ui = {
  dropzone: $('dropzone'),
  dropIcon: $('drop-icon'),
  fileInput: $<HTMLInputElement>('file-input'),
  filesSection: $('files-section'),
  filesCount: $('files-count'),
  clearAll: $<HTMLButtonElement>('clear-all'),
  fileList: $<HTMLUListElement>('file-list'),
  mixedWarning: $('mixed-warning'),
  targetsSection: $('targets-section'),
  targetList: $('target-list'),
  actionSection: $('action-section'),
  progress: $('progress'),
  progressText: $('progress-text'),
  progressBar: $('progress-bar'),
  cancel: $<HTMLButtonElement>('cancel'),
  saveSection: $('save-section'),
  zipRow: $('zip-row'),
  zip: $<HTMLInputElement>('zip'),
  mergeSection: $('merge-section'),
  convert: $<HTMLButtonElement>('convert'),
  summary: $('summary'),
  announce: $('announce'),
};

const client = new ConvertClient();
let items: Item[] = [];
let nextId = 1;
let target: FormatId | null = null;
let candidates: Candidate[] = [];
let running = false;
let cancelled = false;

// ---------- 保存方法(前回の選択をこのパネルの localStorage に覚える) ----------

const SAVE_KEY = 'saveMode';
let bulk = false;
let zipChecked = false;

function loadSaveMode(): void {
  try {
    const saved = localStorage.getItem(SAVE_KEY) as SaveMode | null;
    bulk = saved === 'folder' || saved === 'zip';
    zipChecked = saved === 'zip';
  } catch {
    // 保存できない環境では既定(個別)のまま
  }
}

function currentSaveMode(): SaveMode {
  if (!bulk) return 'individual';
  return zipChecked ? 'zip' : 'folder';
}

function storeSaveMode(): void {
  try {
    localStorage.setItem(SAVE_KEY, currentSaveMode());
  } catch {
    // 覚えられなくても動作には影響しない
  }
}

function renderSaveMode(): void {
  for (const input of ui.saveSection.querySelectorAll<HTMLInputElement>('input[name=save-mode]')) {
    input.checked = input.value === (bulk ? 'folder' : 'individual');
    input.disabled = running;
  }
  ui.zipRow.hidden = !bulk;
  ui.zip.checked = zipChecked;
  ui.zip.disabled = running;
}

// ---------- PDF の作り方(画像ごと / 1つにまとめる) ----------

const MERGE_KEY = 'pdfMerge';
let mergePdf = false;

function loadMergeMode(): void {
  try {
    mergePdf = localStorage.getItem(MERGE_KEY) === 'merge';
  } catch {
    // 既定(画像ごと)のまま
  }
}

/** 変換する(変換不要ではない)ファイル */
function workItems(): Item[] {
  return items.filter((i) => convertible(i) && i.format !== target);
}

/** まとめられる変換の対象(画像 → PDF) */
function mergeableItems(): Item[] {
  if (!target) return [];
  return workItems().filter((i) => findConverter(i.format as FormatId, target as FormatId)?.mergeable);
}

/** まとめる選択を出すのは、まとめられるファイルが2つ以上あるときだけ */
function willMerge(): boolean {
  return mergePdf && mergeableItems().length > 1;
}

function renderMergeMode(): void {
  ui.mergeSection.hidden = mergeableItems().length < 2;
  for (const input of ui.mergeSection.querySelectorAll<HTMLInputElement>('input[name=pdf-merge]')) {
    input.checked = input.value === (mergePdf ? 'merge' : 'separate');
    input.disabled = running;
  }
}

/** 出力が複数になりうるときだけ、保存方法の選択を出す */
function expectsMultipleOutputs(): boolean {
  if (!target) return false;
  const work = workItems();
  const count = willMerge() ? work.length - mergeableItems().length + 1 : work.length;
  return count > 1 || work.some((i) => findConverter(i.format as FormatId, target as FormatId)?.multiOutput);
}

// ---------- 一覧 ----------

function convertible(item: Item): boolean {
  return item.format !== null && item.status !== 'unsupported' && item.status !== 'excluded';
}

function iconButton(className: string, icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `button-icon ${className}`;
  b.innerHTML = icon;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', onClick);
  return b;
}

function createItemElement(item: Item): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'file-item';
  li.dataset.id = String(item.id);
  setupDrag(li, item);

  const head = document.createElement('div');
  head.className = 'file-head';
  const grip = document.createElement('span');
  grip.className = 'drag-handle';
  grip.innerHTML = ICONS.grip;
  grip.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = item.file.name || '(名前なし)';
  name.title = item.file.name;
  head.append(grip, name);

  const actions = document.createElement('div');
  actions.className = 'file-actions';
  actions.append(
    iconButton('move-up', ICONS.up, `${item.file.name} を上へ移動`, () => moveItem(item.id, -1)),
    iconButton('move-down', ICONS.down, `${item.file.name} を下へ移動`, () => moveItem(item.id, 1)),
    iconButton('remove', ICONS.remove, `${item.file.name} を一覧から削除`, () => removeItem(item.id)),
  );

  const meta = document.createElement('div');
  meta.className = 'file-meta';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = item.format ? getFormat(item.format).label : '不明';
  const size = document.createElement('span');
  size.textContent = formatBytes(item.file.size);
  const status = document.createElement('span');
  status.className = 'status';
  meta.append(badge, size, status);

  const message = document.createElement('p');
  message.className = 'file-message';

  li.append(head, actions, meta, message);
  return li;
}

function updateItemElement(item: Item): void {
  const status = item.el.querySelector<HTMLElement>('.status');
  const message = item.el.querySelector<HTMLElement>('.file-message');
  const remove = item.el.querySelector<HTMLButtonElement>('.remove');
  const index = items.indexOf(item);
  const up = item.el.querySelector<HTMLButtonElement>('.move-up');
  const down = item.el.querySelector<HTMLButtonElement>('.move-down');
  const reorderable = items.length > 1;
  if (up) {
    up.hidden = !reorderable;
    up.disabled = running || index <= 0;
  }
  if (down) {
    down.hidden = !reorderable;
    down.disabled = running || index >= items.length - 1;
  }
  item.el.draggable = reorderable && !running;
  item.el.querySelector<HTMLElement>('.drag-handle')?.toggleAttribute('hidden', !reorderable);
  if (status) {
    status.dataset.status = item.status;
    status.innerHTML = `${ICONS[item.status]}<span>${STATUS_LABEL[item.status]}</span>`;
  }
  if (message) {
    message.textContent = item.message;
    message.hidden = !item.message;
    message.dataset.tone = item.tone;
  }
  if (remove) remove.disabled = running;
}

function setStatus(item: Item, status: Status, message = '', tone: Item['tone'] = 'normal'): void {
  item.status = status;
  item.message = message;
  item.tone = tone;
  updateItemElement(item);
}

async function addFiles(files: Iterable<File>): Promise<void> {
  if (running) return;
  const added: Item[] = [];
  for (const file of files) {
    const item: Item = {
      id: nextId++,
      file,
      format: null,
      status: 'waiting',
      message: '',
      tone: 'normal',
      el: document.createElement('li'),
    };
    try {
      item.format = await detectFormat(file, file.name);
    } catch (error) {
      item.message = `ファイルを読み込めませんでした(${toUserMessage(error)})`;
    }
    if (!item.format) {
      item.status = 'unsupported';
      item.message ||= '未対応の形式のため、変換の対象から外しました';
    } else if (!CONVERTERS.some((c) => c.from === item.format)) {
      item.status = 'unsupported';
      item.message = `${getFormat(item.format).label}からの変換には対応していません`;
    } else {
      const limit = MAX_FILE_BYTES[getFormat(item.format).category];
      if (file.size > limit) {
        item.status = 'excluded';
        item.message = `サイズが上限(${formatBytes(limit)})を超えているため、変換の対象から外しました`;
      }
    }
    item.el = createItemElement(item);
    updateItemElement(item);
    added.push(item);
  }
  if (added.length === 0) return;
  items.push(...added);
  ui.fileList.append(...added.map((i) => i.el));
  ui.summary.textContent = '';
  refresh();
}

function removeItem(id: number): void {
  if (running) return;
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const index = items.indexOf(item);
  items = items.filter((i) => i.id !== id);
  item.el.remove();
  refresh();
  // 削除したボタンにあったフォーカスを、隣の項目か追加領域へ移す
  const next = items[index] ?? items[index - 1];
  (next?.el.querySelector<HTMLButtonElement>('.remove') ?? ui.dropzone).focus();
}

// ---------- 並べ替え(上下ボタン・ドラッグ) ----------

function announce(text: string): void {
  ui.announce.textContent = '';
  // 同じ文言でも読み上げられるよう、少し遅らせて入れる
  setTimeout(() => (ui.announce.textContent = text), 50);
}

function syncListOrder(): void {
  ui.fileList.append(...items.map((i) => i.el));
  for (const item of items) updateItemElement(item);
}

function moveItem(id: number, delta: -1 | 1): void {
  if (running) return;
  const from = items.findIndex((i) => i.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  syncListOrder();
  // 押したボタンにフォーカスを残す(端に着いて押せなくなったら、反対向きのボタンへ)
  const same = item.el.querySelector<HTMLButtonElement>(delta < 0 ? '.move-up' : '.move-down');
  const other = item.el.querySelector<HTMLButtonElement>(delta < 0 ? '.move-down' : '.move-up');
  (same && !same.disabled ? same : other)?.focus();
  announce(`${item.file.name} を ${to + 1} 番目に移動しました`);
}

const DRAG_TYPE = 'application/x-file-convert-item';
let draggingId: number | null = null;

function clearDropMarks(): void {
  for (const el of ui.fileList.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after');
  }
}

function setupDrag(li: HTMLLIElement, item: Item): void {
  li.addEventListener('dragstart', (e) => {
    if (running || !e.dataTransfer) return;
    draggingId = item.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, String(item.id));
    li.classList.add('is-dragging');
  });
  li.addEventListener('dragend', () => {
    draggingId = null;
    li.classList.remove('is-dragging');
    clearDropMarks();
  });
  li.addEventListener('dragover', (e) => {
    if (draggingId === null || draggingId === item.id) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    clearDropMarks();
    li.classList.add(before ? 'drop-before' : 'drop-after');
  });
  li.addEventListener('drop', (e) => {
    if (draggingId === null) return;
    e.preventDefault();
    e.stopPropagation();
    const moving = items.find((i) => i.id === draggingId);
    const before = li.classList.contains('drop-before');
    clearDropMarks();
    if (!moving || moving === item) return;
    items.splice(items.indexOf(moving), 1);
    items.splice(items.indexOf(item) + (before ? 0 : 1), 0, moving);
    syncListOrder();
    announce(`${moving.file.name} を ${items.indexOf(moving) + 1} 番目に移動しました`);
  });
}

function clearAll(): void {
  if (running) return;
  items = [];
  ui.fileList.replaceChildren();
  ui.summary.textContent = '';
  refresh();
  ui.dropzone.focus();
}

// ---------- 変換先の候補 ----------

function renderTargets(): void {
  const formats = items.filter(convertible).map((i) => i.format as FormatId);
  const next = candidateTargets(formats);
  const changed = next.map((c) => c.to).join() !== candidates.map((c) => c.to).join();
  candidates = next;
  if (target && !candidates.some((c) => c.to === target)) target = null;
  ui.mixedWarning.hidden = !(formats.length > 0 && candidates.length === 0 && new Set(formats).size > 1);
  if (!changed) return;

  ui.targetList.replaceChildren(
    ...candidates.map((c) => {
      const label = document.createElement('label');
      label.className = 'target';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'target';
      input.value = c.to;
      input.checked = c.to === target;
      input.addEventListener('change', () => {
        target = c.to;
        ui.summary.textContent = '';
        refresh();
      });
      const name = document.createElement('span');
      name.className = 'target-label';
      name.textContent = c.name;
      if (c.variant) {
        const variant = document.createElement('span');
        variant.className = 'target-variant';
        variant.textContent = c.variant;
        name.append(variant);
      }
      const usage = document.createElement('span');
      usage.className = 'target-usage';
      usage.textContent = c.usage;
      label.append(input, name, usage);
      return label;
    }),
  );
}

function refresh(): void {
  const hasItems = items.length > 0;
  ui.filesSection.hidden = !hasItems;
  ui.filesCount.textContent = hasItems ? `(${items.length})` : '';
  renderTargets();
  ui.targetsSection.hidden = candidates.length === 0;
  ui.actionSection.hidden = candidates.length === 0;
  ui.saveSection.hidden = candidates.length === 0 || !expectsMultipleOutputs();
  renderSaveMode();
  renderMergeMode();
  ui.convert.disabled = running || target === null;
  ui.clearAll.disabled = running;
  for (const input of ui.targetList.querySelectorAll('input')) input.disabled = running;
  for (const item of items) updateItemElement(item);
}

// ---------- 変換 ----------

function setProgress(ratio: number, text: string): void {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  ui.progressBar.style.width = `${pct}%`;
  ui.progressBar.setAttribute('aria-valuenow', String(pct));
  ui.progressText.textContent = text;
}

async function convertAll(): Promise<void> {
  if (running || !target) return;
  const to = target;
  const mode: SaveMode = expectsMultipleOutputs() ? currentSaveMode() : 'individual';
  // 一括保存は、最初に保存先のフォルダを1回選んでもらう(ボタンを押した操作の中で、ほかの処理より先に開く必要がある)
  let directory: FileSystemDirectoryHandle | undefined;
  if (mode !== 'individual' && canPickDirectory()) {
    running = true; // フォルダを選んでいる間の二重押しを防ぐ
    try {
      const picked = await pickDirectory();
      if (!picked) {
        running = false;
        ui.summary.textContent = '保存先のフォルダが選ばれなかったため、変換しませんでした。';
        return;
      }
      directory = picked;
    } catch (error) {
      running = false;
      ui.summary.textContent = `保存先のフォルダを開けませんでした(${error instanceof Error ? error.message : String(error)})。`;
      return;
    }
  }
  const merging = willMerge() ? mergeableItems() : [];
  const queue = items.filter(convertible);
  running = true;
  cancelled = false;
  ui.summary.textContent = '';
  ui.progress.hidden = false;
  for (const item of queue) setStatus(item, 'waiting');
  refresh();

  const outputs: ConvertOutput[] = [];
  const outputOwner = new Map<ConvertOutput, Item>();
  const work = queue.filter((i) => i.format !== to);
  let finished = 0;
  let failed = 0;

  for (const item of queue) {
    if (item.format === to) setStatus(item, 'skipped', `すでに${getFormat(to).label}のため、変換しません`);
  }

  // 画像 → PDF をまとめる場合は、一覧の順に1回で変換する
  if (merging.length > 1) {
    for (const item of merging) setStatus(item, 'converting');
    const label = `${merging.length}枚の画像を1つのPDFにまとめています`;
    setProgress(0, label);
    try {
      const converter = findConverter(merging[0].format as FormatId, to)!;
      const result = await client.runMany(
        converter.id,
        merging.map((i) => ({ name: i.file.name, blob: i.file, format: i.format as FormatId })),
        (r, detail) => setProgress((r * merging.length) / work.length, detail ? `${label}(${detail})` : label),
      );
      const failedIdx = new Map((result.failed ?? []).map((f) => [f.index, f.message]));
      const owner = merging.find((_, idx) => !failedIdx.has(idx)) ?? merging[0];
      for (const out of result.outputs) {
        outputs.push(out);
        outputOwner.set(out, owner);
      }
      merging.forEach((item, idx) => {
        const msg = failedIdx.get(idx);
        if (msg) {
          failed++;
          setStatus(item, 'failed', `${msg}(まとめたPDFには含めていません)`, 'error');
        } else {
          setStatus(item, 'done', idx === 0 ? result.notes.join('。') : '1つのPDFにまとめました');
        }
      });
    } catch (error) {
      if (error instanceof CancelledError) {
        for (const item of merging) setStatus(item, 'waiting');
      } else {
        const message = error instanceof Error ? error.message : toUserMessage(error);
        for (const item of merging) setStatus(item, 'failed', message, 'error');
        failed += merging.length;
      }
    }
    finished += merging.length;
  }

  for (const item of work) {
    if (cancelled) break;
    if (merging.includes(item)) continue;
    const converter = findConverter(item.format as FormatId, to);
    const label = `${finished + 1} / ${work.length} 件を変換中`;
    setProgress(finished / work.length, label);
    if (!converter) {
      setStatus(item, 'failed', 'この組み合わせの変換には対応していません', 'error');
      failed++;
      finished++;
      continue;
    }
    setStatus(item, 'converting');
    try {
      // 「12 / 40 ページ」のような補足があれば添える
      const onProgress = (r: number, detail?: string): void =>
        setProgress((finished + r) / work.length, detail ? `${label}(${detail})` : label);
      let result: ConvertResult;
      if (isDomEngine(converter.engine)) {
        // DOM が必要な変換(HTML)はこのパネルで行う。途中では止められないので、終わってからキャンセルを反映する
        const engine = await DOM_ENGINES[converter.engine]();
        result = await engine.convert(
          { name: item.file.name, blob: item.file, format: item.format as FormatId },
          to,
          { progress: onProgress },
        );
        if (cancelled) throw new CancelledError();
      } else {
        const bitmap = converter.prepare ? await prepare(converter.prepare, item.file) : undefined;
        result = await client.run(
          { converterId: converter.id, name: item.file.name, blob: item.file, format: item.format as FormatId, bitmap },
          onProgress,
        );
      }
      for (const out of result.outputs) {
        outputs.push(out);
        outputOwner.set(out, item);
      }
      setStatus(item, 'done', result.notes.join('。'));
    } catch (error) {
      if (error instanceof CancelledError) {
        setStatus(item, 'waiting');
        break;
      }
      failed++;
      setStatus(item, 'failed', error instanceof Error ? error.message : toUserMessage(error), 'error');
    }
    finished++;
  }

  if (cancelled) {
    for (const item of work) if (item.status === 'converting') setStatus(item, 'waiting');
    finishRun('キャンセルしました。ファイルは保存していません。');
    return;
  }

  setProgress(1, outputs.length > 1 && mode === 'zip' ? 'ZIPにまとめています' : '保存しています');
  // 出力が1つだけなら、そのままダウンロードする(保存先のフォルダを選んだときは、そこに保存する)
  const saved = await saveOutputs(outputs, {
    mode: outputs.length > 1 || directory ? mode : 'individual',
    zip: (files) => client.zip(files),
    directory,
  });
  for (const f of saved.failures) {
    const owner = outputOwner.get(f.output);
    if (owner && owner.status === 'done') {
      setStatus(owner, 'failed', f.message, 'error');
      failed++;
    }
  }
  const skipped = queue.length - work.length;
  const parts: string[] = [];
  if (saved.saved > 0) {
    // 選んだフォルダへの書き込みは、この時点で保存まで終わっている。
    // ダウンロード(個別など)は、Chrome の設定によってはまだ保存ダイアログの途中なので、変換の完了だけを伝える
    if (directory && saved.location) {
      parts.push(
        mode === 'zip'
          ? `${saved.saved}件を変換し、「${saved.location}」にまとめて保存しました`
          : `${saved.saved}件を変換し、「${saved.location}」に保存しました`,
      );
    } else {
      parts.push(`${saved.saved}件を変換しました`);
    }
  } else {
    parts.push(outputs.length === 0 ? '変換できたファイルはありません' : '保存できたファイルはありません');
  }
  if (skipped > 0) parts.push(`${skipped}件は変換不要でした`);
  if (failed > 0) parts.push(`${failed}件は失敗しました(一覧に理由があります)`);
  finishRun(`${parts.join('。')}。`);
}

function finishRun(summary: string): void {
  running = false;
  ui.progress.hidden = true;
  setProgress(0, '');
  ui.summary.textContent = summary;
  refresh();
}

function cancel(): void {
  if (!running) return;
  cancelled = true;
  client.cancel();
}

// ---------- 入力(ドロップ・ペースト・選択) ----------

function setupInputs(): void {
  ui.dropIcon.innerHTML = ICONS.upload;

  const openPicker = (): void => {
    if (!running) ui.fileInput.click();
  };
  ui.dropzone.addEventListener('click', openPicker);
  ui.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  });
  ui.fileInput.addEventListener('change', () => {
    const files = [...(ui.fileInput.files ?? [])];
    ui.fileInput.value = '';
    void addFiles(files);
  });

  // パネル全体でドロップを受け付ける(外れた場所に落としてもページ遷移しないように)
  let depth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    ui.dropzone.classList.add('is-dragover');
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) ui.dropzone.classList.remove('is-dragover');
  });
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = running ? 'none' : 'copy';
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes(DRAG_TYPE)) return; // 一覧の並べ替え
    depth = 0;
    ui.dropzone.classList.remove('is-dragover');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void addFiles(files);
  });

  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  });

  ui.clearAll.addEventListener('click', clearAll);
  ui.convert.addEventListener('click', () => void convertAll());
  ui.cancel.addEventListener('click', cancel);

  for (const input of ui.saveSection.querySelectorAll<HTMLInputElement>('input[name=save-mode]')) {
    input.addEventListener('change', () => {
      bulk = input.value === 'folder';
      storeSaveMode();
      renderSaveMode();
    });
  }
  ui.zip.addEventListener('change', () => {
    zipChecked = ui.zip.checked;
    storeSaveMode();
  });

  for (const input of ui.mergeSection.querySelectorAll<HTMLInputElement>('input[name=pdf-merge]')) {
    input.addEventListener('change', () => {
      mergePdf = input.value === 'merge';
      try {
        localStorage.setItem(MERGE_KEY, mergePdf ? 'merge' : 'separate');
      } catch {
        // 覚えられなくても動作には影響しない
      }
      refresh();
    });
  }
}

loadFonts();
loadSaveMode();
loadMergeMode();
setupInputs();
refresh();
