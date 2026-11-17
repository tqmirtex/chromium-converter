import { ConvertError } from './types';

/** 想定外の例外を、利用者に見せる短い理由にする(握りつぶさない) */
export function toUserMessage(error: unknown): string {
  if (error instanceof ConvertError) return error.message;
  if (error instanceof RangeError || (error instanceof DOMException && error.name === 'QuotaExceededError')) {
    return 'メモリが足りず変換できませんでした。ファイルを小さくするか、数を減らしてください';
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `変換できませんでした(${detail})`;
}
