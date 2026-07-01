import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { ensureDir, walkFiles } from './fs-utils.mjs';

/**
 * Stage the build output for packaging.
 *
 * 1. Copies every file from `distDir` into `stagingDir`, preserving the exact
 *    directory structure (requirement: "preserve directory structure exactly").
 * 2. For each text asset whose extension is in `compressibleExtensions`, writes
 *    a sibling `<name>.gz` compressed at maximum level. The original file is
 *    left in place unchanged so the archive contains both the raw asset and its
 *    gzipped variant.
 * 3. Already-compressed / binary assets (jpg, png, mp3, fonts, …) are copied
 *    through untouched.
 *
 * @returns {{ gzipFiles: string[], staticFiles: string[] }}
 *   `gzipFiles`  – forward-slash relative paths of every generated `.gz` file.
 *   `staticFiles` – forward-slash relative paths of every original file copied.
 */
export function stageAndCompress(distDir, stagingDir, config) {
  const files = walkFiles(distDir);
  const compressible = new Set(
    config.compressibleExtensions.map((e) => e.toLowerCase()),
  );

  const gzipFiles = [];
  const staticFiles = [];

  for (const { absPath, relPath } of files) {
    const dest = join(stagingDir, relPath);
    ensureDir(join(dest, '..'));

    const contents = readFileSync(absPath);
    // Copy the original through unchanged.
    copyFileSync(absPath, dest);
    staticFiles.push(relPath);

    // Add a maximally-compressed sibling for text assets.
    if (compressible.has(extname(relPath).toLowerCase())) {
      const gz = gzipSync(contents, { level: config.gzipLevel });
      writeFileSync(`${dest}.gz`, gz);
      gzipFiles.push(`${relPath}.gz`);
    }
  }

  gzipFiles.sort();
  staticFiles.sort();
  return { gzipFiles, staticFiles };
}
