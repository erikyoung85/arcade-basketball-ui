import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Placeholder used for the bundle hash before the archive exists. */
export const HASH_PLACEHOLDER = 'PENDING';

/** Read the semantic version from the project's package.json. */
export function readPackageVersion(projectRoot) {
  const pkg = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8'),
  );
  return pkg.version;
}

/**
 * Build the version manifest object.
 *
 * The manifest is embedded inside `bundle.tar.gz`, but its own `sha256` field
 * describes that very archive — a chicken-and-egg cycle. So the embedded copy
 * carries `HASH_PLACEHOLDER`; the orchestrator writes a second copy next to the
 * archive with the real hash filled in once the archive has been produced.
 *
 * @param {object} params
 * @param {string} params.version    semantic version from package.json
 * @param {string} params.timestamp  ISO-8601 build timestamp
 * @param {string[]} params.gzipFiles list of generated .gz files
 * @param {string} [params.sha256]   hash of the final bundle (or placeholder)
 */
export function buildVersionManifest({
  version,
  timestamp,
  gzipFiles,
  sha256 = HASH_PLACEHOLDER,
}) {
  return {
    name: 'arcade-basketball-ui',
    version,
    buildTimestamp: timestamp,
    archive: 'bundle.tar.gz',
    hashAlgorithm: 'sha256',
    sha256,
    gzipFileCount: gzipFiles.length,
    gzipFiles,
  };
}

/** Serialize a manifest to a newline-terminated JSON string. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
