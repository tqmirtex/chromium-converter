export function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

export function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

/** ISO BMFF(AVIF / HEIC)の ftyp ボックスにあるブランドを返す */
export function ftypBrands(bytes: Uint8Array): string[] {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp') return [];
  const size = Math.min(readU32BE(bytes, 0), bytes.length);
  const brands = [ascii(bytes, 8, 4)];
  for (let off = 16; off + 4 <= size; off += 4) {
    brands.push(ascii(bytes, off, 4));
  }
  return brands;
}
