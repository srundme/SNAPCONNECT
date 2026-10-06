import { inflateRawSync } from "node:zlib";

/** Reads the text files out of a ZIP archive (stored or deflated entries), keyed by file name. */
export function unzipText(archive: Uint8Array, wanted: (name: string) => boolean): Map<string, string> {
  const data = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  const files = new Map<string, string>();
  let end = -1;
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65_557); index -= 1) {
    if (data.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP archive.");
  const count = data.readUInt16LE(end + 10);
  let cursor = data.readUInt32LE(end + 16);
  for (let entry = 0; entry < count; entry += 1) {
    if (data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP directory is damaged.");
    const method = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const name = data.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name) || name.endsWith("/")) continue;
    const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
    const raw = data.subarray(start, start + compressedSize);
    if (method === 0) files.set(name, raw.toString("utf8"));
    else if (method === 8) files.set(name, inflateRawSync(raw).toString("utf8"));
  }
  return files;
}
