import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { walkFiles } from './fs-utils.mjs';
import { createTar } from './tar.mjs';

/**
 * Assemble the final `bundle.tar.gz` from a staging directory.
 *
 * `versionEntry` (the version.json contents) is injected as the first entry so
 * it always lands at the archive root regardless of the staging layout. Every
 * file already in `stagingDir` — original static assets and the generated .gz
 * siblings — follows, with directory structure preserved.
 *
 * The tar is built in-memory (pure JS, deterministic) then gzipped at maximum
 * compression.
 *
 * @returns {{ archive: Buffer, sha256: string }}
 */
export function buildBundle(stagingDir, versionEntry, config) {
  const entries = [
    {
      name: config.versionFileName,
      data: Buffer.from(versionEntry, 'utf8'),
      mtime: config.mtime,
    },
  ];

  for (const { absPath, relPath } of walkFiles(stagingDir)) {
    entries.push({
      name: relPath,
      data: readFileSync(absPath),
      mtime: config.mtime,
    });
  }

  const tar = createTar(entries);
  const archive = gzipSync(tar, { level: config.gzipLevel });
  const sha256 = createHash('sha256').update(archive).digest('hex');

  return { archive, sha256 };
}
