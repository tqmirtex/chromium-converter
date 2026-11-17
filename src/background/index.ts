import { formatOrder, getFormat } from '../core/formats';
import type {
  OffscreenConvertMessage,
  OffscreenConvertReply,
  OffscreenRevokeMessage,
  PermissionResultMessage,
} from '../core/messages';
import { HOST_PERMISSION } from '../core/permissions';
import { CONVERTERS } from '../core/registry';
import type { FormatId } from '../core/types';

const MENU_ROOT = 'file-convert';
const MENU_PREFIX = 'to:';
const OFFSCREEN_PATH = 'offscreen.html';

// ---------- サイドパネル ----------

function enablePanelOnActionClick(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('サイドパネルの設定に失敗しました', error));
}

// ---------- 右クリックメニュー(レジストリの画像コンバーターから作る) ----------

function imageTargets(): FormatId[] {
  const targets = new Set(
    CONVERTERS.filter((c) => getFormat(c.from).category === 'image' && getFormat(c.to).category === 'image').map(
      (c) => c.to,
    ),
  );
  return [...targets].sort((a, b) => formatOrder(a) - formatOrder(b));
}

function createMenu(props: chrome.contextMenus.CreateProperties): void {
  chrome.contextMenus.create(props, () => {
    if (chrome.runtime.lastError) console.error('メニューを作れませんでした', chrome.runtime.lastError.message);
  });
}

function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    createMenu({ id: MENU_ROOT, title: 'ファイル変換', contexts: ['image'] });
    for (const to of imageTargets()) {
      createMenu({
        id: `${MENU_PREFIX}${to}`,
        parentId: MENU_ROOT,
        title: `${getFormat(to).label}に変換`,
        contexts: ['image'],
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  enablePanelOnActionClick();
  createMenus();
});
chrome.runtime.onStartup.addListener(enablePanelOnActionClick);

// ---------- 通知 ----------

function notify(title: string, message: string): void {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 0,
  });
}

const notifyFailure = (reason: string): void => notify('変換できませんでした', reason);

// ---------- Offscreen Document ----------

let creating: Promise<void> | undefined;
let activeJobs = 0;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.BLOBS],
      justification: '右クリックした画像を変換する(Worker での変換、SVG の解析、保存用の Blob の作成)',
    })
    .finally(() => {
      creating = undefined;
    });
  await creating;
}

function jobFinished(): void {
  activeJobs = Math.max(0, activeJobs - 1);
  if (activeJobs === 0) {
    chrome.offscreen.closeDocument().catch(() => {
      // すでに閉じている
    });
  }
}

/** ダウンロードが終わるまで Blob URL(Offscreen Document が持つ)を生かしておく */
function releaseWhenDone(downloadId: number, blobUrl: string): void {
  const timer = setTimeout(done, 5 * 60 * 1000);
  function done(): void {
    clearTimeout(timer);
    chrome.downloads.onChanged.removeListener(listener);
    const msg: OffscreenRevokeMessage = { target: 'offscreen', type: 'revoke', blobUrl };
    chrome.runtime.sendMessage(msg).catch(() => {});
    jobFinished();
  }
  function listener(delta: chrome.downloads.DownloadDelta): void {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') done();
  }
  chrome.downloads.onChanged.addListener(listener);
}

async function convertImageUrl(srcUrl: string, to: FormatId): Promise<void> {
  activeJobs++;
  let keepAlive = false;
  try {
    await ensureOffscreen();
    const msg: OffscreenConvertMessage = { target: 'offscreen', type: 'convert-url', srcUrl, to };
    const reply = (await chrome.runtime.sendMessage(msg)) as OffscreenConvertReply | undefined;
    if (!reply) {
      notifyFailure('変換処理から応答がありませんでした');
      return;
    }
    if (reply.status === 'skipped') {
      notify('変換不要', reply.message);
      return;
    }
    if (reply.status === 'failed') {
      notifyFailure(reply.message);
      return;
    }
    try {
      const id = await chrome.downloads.download({
        url: reply.blobUrl,
        filename: reply.filename,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      keepAlive = true;
      releaseWhenDone(id, reply.blobUrl);
      // 保存ダイアログが出る設定では、この時点ではまだ保存されていないため、変換の完了だけを知らせる
      notify('変換が完了しました', [`「${reply.filename}」への変換が完了しました。`, ...reply.notes].join('\n'));
    } catch (error) {
      notifyFailure(`保存に失敗しました(${error instanceof Error ? error.message : String(error)})`);
    }
  } catch (error) {
    console.error(error);
    notifyFailure(error instanceof Error ? error.message : String(error));
  } finally {
    if (!keepAlive) jobFinished();
  }
}

// ---------- 権限(初回の右クリック変換のときに求める) ----------

/** Service Worker から権限を求められなかったとき、確認ページでの返事を待つ依頼 */
const pendingPermission = new Map<string, { srcUrl: string; to: FormatId }>();

function openPermissionPage(srcUrl: string, to: FormatId): void {
  const id = crypto.randomUUID();
  pendingPermission.set(id, { srcUrl, to });
  chrome.windows
    .create({ url: chrome.runtime.getURL(`permission.html#${id}`), type: 'popup', width: 440, height: 360 })
    .catch((error: unknown) => {
      pendingPermission.delete(id);
      notifyFailure(`権限の確認画面を開けませんでした(${error instanceof Error ? error.message : String(error)})`);
    });
}

const DENIED_MESSAGE = '画像の取得が許可されなかったため、変換できませんでした';

/**
 * 右クリックの操作の中で権限を求める。すでに許可されていれば確認は出ない。
 * ここで求められない環境(ユーザー操作として扱われない場合)は、確認ページを開いてそこで求める。
 */
function requestHostAndConvert(srcUrl: string, to: FormatId): void {
  let request: Promise<boolean>;
  try {
    // ユーザー操作の扱いを失わないよう、await を挟まずに呼ぶ
    request = chrome.permissions.request({ origins: [HOST_PERMISSION] });
  } catch (error) {
    request = Promise.reject(error);
  }
  request.then(
    (granted) => (granted ? convertImageUrl(srcUrl, to) : notifyFailure(DENIED_MESSAGE)),
    async (error: unknown) => {
      console.warn('右クリックの処理から権限を求められませんでした。確認画面を開きます', error);
      if (await chrome.permissions.contains({ origins: [HOST_PERMISSION] })) await convertImageUrl(srcUrl, to);
      else openPermissionPage(srcUrl, to);
    },
  );
}

chrome.contextMenus.onClicked.addListener((info) => {
  const id = String(info.menuItemId);
  if (!id.startsWith(MENU_PREFIX)) return;
  const to = id.slice(MENU_PREFIX.length);
  const srcUrl = info.srcUrl;
  if (!srcUrl) {
    notifyFailure('画像のURLを取得できませんでした');
    return;
  }
  const scheme = srcUrl.slice(0, srcUrl.indexOf(':') + 1).toLowerCase();
  if (scheme === 'data:') {
    // data: URL は画像そのものなので、権限なしで変換できる
    void convertImageUrl(srcUrl, to);
  } else if (scheme === 'http:' || scheme === 'https:') {
    requestHostAndConvert(srcUrl, to);
  } else if (scheme === 'file:') {
    notifyFailure('パソコン内の画像は、サイドパネルにドラッグして変換してください');
  } else {
    notifyFailure(`この画像は取得できない種類のURL(${scheme})のため、変換できません`);
  }
});

chrome.runtime.onMessage.addListener((msg: PermissionResultMessage | { target?: string }) => {
  if (msg.target !== 'background') return undefined;
  const m = msg as PermissionResultMessage;
  if (m.type !== 'permission-result') return undefined;
  const pending = pendingPermission.get(m.requestId);
  pendingPermission.delete(m.requestId);
  if (!pending) {
    if (m.granted) notify('許可しました', 'もう一度、画像を右クリックして変換してください');
    return undefined;
  }
  if (m.granted) void convertImageUrl(pending.srcUrl, pending.to);
  else notifyFailure(DENIED_MESSAGE);
  return undefined;
});
