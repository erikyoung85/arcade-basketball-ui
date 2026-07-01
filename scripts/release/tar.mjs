import { Buffer } from 'node:buffer';

const BLOCK = 512;

/**
 * Minimal, dependency-free USTAR tar writer.
 *
 * Implemented in pure Node so the pipeline behaves identically on macOS
 * (bsdtar) and Linux CI runners (GNU tar) — no shelling out, no flag-dialect
 * differences, and fully deterministic output for reproducible builds.
 *
 * Supports regular files with names up to 255 chars (via the USTAR name/prefix
 * split), which is sufficient for hashed Angular bundle filenames.
 */

function writeString(buf, str, offset, length) {
  const bytes = Buffer.from(str, 'utf8');
  if (bytes.length > length) {
    throw new Error(`tar field too long (${bytes.length} > ${length}): ${str}`);
  }
  bytes.copy(buf, offset);
}

/** Octal field, zero-padded, NUL-terminated (classic tar convention). */
function writeOctal(buf, value, offset, length) {
  const str = value.toString(8).padStart(length - 1, '0');
  writeString(buf, str, offset, length - 1);
  buf[offset + length - 1] = 0;
}

/** Split a >100 char name into USTAR name/prefix fields. */
function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  const idx = name.lastIndexOf('/', 154);
  if (idx <= 0 || Buffer.byteLength(name.slice(idx + 1)) > 100) {
    throw new Error(`path too long for USTAR tar: ${name}`);
  }
  return { name: name.slice(idx + 1), prefix: name.slice(0, idx) };
}

function buildHeader({ name, size, mtime, mode = 0o644 }) {
  const header = Buffer.alloc(BLOCK, 0);
  const { name: shortName, prefix } = splitName(name);

  writeString(header, shortName, 0, 100); // name
  writeOctal(header, mode, 100, 8); // mode
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, size, 124, 12); // size
  writeOctal(header, mtime, 136, 12); // mtime
  header.fill(' ', 148, 156); // checksum placeholder (spaces)
  header[156] = '0'.charCodeAt(0); // typeflag: regular file
  writeString(header, 'ustar', 257, 6); // magic
  header[263] = '0'.charCodeAt(0); // version
  header[264] = '0'.charCodeAt(0);
  writeString(header, 'root', 265, 32); // uname
  writeString(header, 'root', 297, 32); // gname
  if (prefix) writeString(header, prefix, 345, 155); // prefix

  // Checksum: sum of all header bytes with the checksum field taken as spaces.
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += header[i];
  writeOctal(header, sum, 148, 8);
  header[155] = ' '.charCodeAt(0); // trailing space after NUL, per convention

  return header;
}

/**
 * Build a tar archive in memory.
 *
 * @param {Array<{ name: string, data: Buffer, mtime?: number, mode?: number }>} entries
 * @returns {Buffer}
 */
export function createTar(entries) {
  const chunks = [];

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data);

    chunks.push(
      buildHeader({
        name: entry.name,
        size: data.length,
        mtime: entry.mtime ?? 0,
        mode: entry.mode,
      }),
    );
    chunks.push(data);

    // Pad file data to a 512-byte boundary.
    const remainder = data.length % BLOCK;
    if (remainder !== 0) chunks.push(Buffer.alloc(BLOCK - remainder, 0));
  }

  // Two zero blocks mark end-of-archive.
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(chunks);
}
