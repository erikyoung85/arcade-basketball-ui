import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Remove `dir` if it exists, then recreate it empty. */
export function resetDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/** mkdir -p */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Recursively walk `root`, returning a sorted list of files. Each entry is
 * `{ absPath, relPath }` where `relPath` uses forward slashes so it is stable
 * across platforms (important for tar entry names and reproducibility).
 */
export function walkFiles(root) {
  const out = [];

  const recurse = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    // Sort for deterministic ordering across filesystems.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        recurse(abs);
      } else if (entry.isFile()) {
        out.push({
          absPath: abs,
          relPath: relative(root, abs).split(sep).join('/'),
        });
      }
    }
  };

  recurse(root);
  return out;
}

/** True when `path` exists and is a directory. */
export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
