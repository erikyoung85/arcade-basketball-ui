import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundle } from './bundle.mjs';
import { stageAndCompress } from './compress.mjs';
import { resolveConfig } from './config.mjs';
import { ensureDir, isDirectory, resetDir } from './fs-utils.mjs';
import { publishToVercel } from './publish.mjs';
import {
  HASH_PLACEHOLDER,
  buildVersionManifest,
  readPackageVersion,
  serializeManifest,
} from './version.mjs';

/**
 * Run the full release packaging pipeline end-to-end.
 *
 * Steps: validate build output → stage + gzip text assets → generate the
 * version manifest → assemble bundle.tar.gz → hash it → publish into the
 * Vercel-deployable static tree (public/releases/<version>/…) and refresh
 * public/latest.json.
 *
 * Pure orchestration over the modules in this directory. Final side effects are
 * confined to `config.publicDir`; `config.releaseDir` is scratch and removed.
 * Returns a summary object for CI consumers.
 *
 * @param {object} [overrides] fields to override on DEFAULT_CONFIG
 */
export function runRelease(overrides = {}) {
  const config = resolveConfig(overrides);
  const timestamp = new Date().toISOString();
  config.mtime = Math.floor(new Date(timestamp).getTime() / 1000);

  const log = (msg) => console.log(`  ${msg}`);
  console.log('\n📦 Building ESP32 release bundle\n');

  // 1. Validate build output exists.
  if (!isDirectory(config.distDir)) {
    throw new Error(
      `Build output not found at ${config.distDir}\n` +
        'Run `ng build --configuration production` first.',
    );
  }

  // 2. Reset release dir + staging area.
  const stagingDir = join(config.releaseDir, 'staging');
  resetDir(config.releaseDir);
  ensureDir(stagingDir);
  log(`dist   : ${relative(config.projectRoot, config.distDir)}`);

  // 3. Copy + compress text assets (originals preserved, .gz added alongside).
  const { gzipFiles, staticFiles } = stageAndCompress(
    config.distDir,
    stagingDir,
    config,
  );
  log(`static : ${staticFiles.length} files copied`);
  log(`gzip   : ${gzipFiles.length} files compressed (level ${config.gzipLevel})`);

  // 4. Build the version manifest (embedded copy carries a hash placeholder —
  //    it cannot contain the hash of the archive that contains it).
  const version = readPackageVersion(config.projectRoot);
  const embeddedManifest = serializeManifest(
    buildVersionManifest({
      version,
      timestamp,
      gzipFiles,
      sha256: HASH_PLACEHOLDER,
    }),
  );

  // 5. Assemble + gzip the archive, hashing the final bytes.
  const { archive, sha256 } = buildBundle(stagingDir, embeddedManifest, config);

  // 6. Publish into the Vercel-deployable static tree + refresh latest.json.
  //    The resolved manifest (real hash) is stored per-version.
  const resolvedManifest = serializeManifest(
    buildVersionManifest({ version, timestamp, gzipFiles, sha256 }),
  );
  const { versionDir, latestPath, latest } = publishToVercel(
    { version, archive, sha256, manifest: resolvedManifest },
    config,
  );

  // 7. Remove scratch staging; the public/ tree is the deliverable.
  rmSync(config.releaseDir, { recursive: true, force: true });

  const rel = (p) => relative(config.projectRoot, p);
  console.log('\n✅ Release published (Vercel static)');
  log(`version : ${version}`);
  log(`archive : ${rel(join(versionDir, config.archiveName))} (${archive.length} bytes)`);
  log(`sha256  : ${sha256}`);
  log(`latest  : ${rel(latestPath)} -> ${latest.version} (${latest.download_url})`);
  console.log('');

  return {
    version,
    timestamp,
    sha256,
    versionDir,
    latestPath,
    latest,
    gzipFiles,
  };
}

// CLI entry point.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runRelease();
  } catch (err) {
    console.error(`\n❌ Release failed: ${err.message}\n`);
    process.exit(1);
  }
}
