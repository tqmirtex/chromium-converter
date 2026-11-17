import { FATAL_ID, type WorkerRequest, type WorkerResponse } from '../core/messages';
import { handleRequest } from '../core/run';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
  addEventListener: (type: 'unhandledrejection', fn: (e: PromiseRejectionEvent) => void) => void;
};

scope.onmessage = (e) => {
  void handleRequest(e.data, (res) => scope.postMessage(res));
};

// ライブラリの内部で起きて、変換の処理まで届かなかったエラー(例: CSP で止められた処理)。
// そのままでは変換が終わらないまま待ち続けるので、処理中の変換をすべて失敗として返す。
scope.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
  scope.postMessage({ id: FATAL_ID, type: 'error', message: `変換処理の内部でエラーが起きました(${reason})` });
});
