import { HOST_PERMISSION } from '../core/permissions';
import type { PermissionResultMessage } from '../core/messages';
import { loadFonts } from '../ui/fonts';

/**
 * 右クリックの処理(Service Worker)から権限を求められなかったときの予備の画面。
 * ボタンを押す操作の中で chrome.permissions.request を呼ぶ。
 */
const requestId = location.hash.slice(1);

async function reply(granted: boolean): Promise<void> {
  const msg: PermissionResultMessage = { target: 'background', type: 'permission-result', requestId, granted };
  try {
    await chrome.runtime.sendMessage(msg);
  } finally {
    window.close();
  }
}

loadFonts();
document.getElementById('allow')?.addEventListener('click', () => {
  chrome.permissions
    .request({ origins: [HOST_PERMISSION] })
    .then((granted) => reply(granted))
    .catch(() => reply(false));
});
document.getElementById('deny')?.addEventListener('click', () => void reply(false));
