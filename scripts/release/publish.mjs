import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureDir } from './fs-utils.mjs';
import { serializeManifest } from './version.mjs';

/** Parse an `x.y.z[-pre]` version; returns null if it doesn't look like semver. */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}

/**
 * Compare two version strings. Newer sorts greater. Non-semver strings fall
 * back to lexicographic comparison. A release (no prerelease) outranks the same
 * core version with a prerelease tag (1.0.0 > 1.0.0-rc.1).
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

/**
 * Publish a built release into the Vercel-deployable static tree and refresh
 * the `latest.json` pointer.
 *
 * Writes:
 *   public/releases/<version>/bundle.tar.gz
 *   public/releases/<version>/bundle.tar.gz.sha256
 *   public/releases/<version>/version.json   (resolved manifest, real hash)
 *   public/latest.json                        (points at the newest version)
 *
 * `latest.json` is derived by scanning every version directory and selecting
 * the highest semver — so it is always correct even when an older version is
 * (re)built after a newer one already exists.
 *
 * @returns {{ versionDir: string, latestPath: string, latest: object, newest: string }}
 */
export function publishToVercel({ version, archive, sha256, manifest }, config) {
  const releasesRoot = join(config.publicDir, config.releasesSubdir);
  const versionDir = join(releasesRoot, version);
  ensureDir(versionDir);

  writeFileSync(join(versionDir, config.archiveName), archive);
  writeFileSync(
    join(versionDir, `${config.archiveName}.sha256`),
    `${sha256}  ${config.archiveName}\n`,
  );
  // Per-version resolved manifest carries the real hash; also the source of
  // truth latest.json reads back from when selecting the newest version.
  writeFileSync(join(versionDir, config.versionFileName), manifest);

  // Select the newest version across all published releases.
  const versions = readdirSync(releasesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(compareSemver);
  const newest = versions[versions.length - 1] ?? version;

  // Pull the newest version's hash from its own manifest (it may not be the one
  // we just built).
  const newestManifest = JSON.parse(
    readFileSync(join(releasesRoot, newest, config.versionFileName), 'utf8'),
  );

  const downloadUrl =
    `${config.baseUrl}/${config.releasesSubdir}/${newest}/${config.archiveName}`;

  const latest = {
    version: newest,
    download_url: downloadUrl,
    sha256: newestManifest.sha256,
  };

  const latestPath = join(config.publicDir, config.latestFileName);
  writeFileSync(latestPath, serializeManifest(latest));

  return { versionDir, latestPath, latest, newest };
}
