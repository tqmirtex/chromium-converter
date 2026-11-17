import { decodeText } from '../../core/text';
import { ConvertError, type ConvertInput } from '../../core/types';

/** 入力をテキストとして読む(文字コードは自動判定) */
export async function readInputText(input: ConvertInput): Promise<string> {
  return decodeText(new Uint8Array(await input.blob.arrayBuffer())).text;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConvertError(`JSONの書式が正しくありません(${error instanceof Error ? error.message : String(error)})`);
  }
}
