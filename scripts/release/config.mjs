import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root (two levels up from scripts/release). */
export const PROJECT_ROOT = resolve(here, '..', '..');

/**
 * Central configuration for the release packaging pipeline.
 *
 * Everything the pipeline touches is derived from these values, so the same
 * modules can be reused from any CI/CD runner by importing this file (or by
 * overriding fields via `resolveConfig`).
 */
export const DEFAULT_CONFIG = {
  projectRoot: PROJECT_ROOT,

  /**
   * Angular's build output. `@angular/build:application` emits into
   * dist/<project>/browser. This is the directory whose contents get packaged.
   */
  distDir: resolve(PROJECT_ROOT, 'dist', 'arcade-basketball-ui', 'browser'),

  /** Scratch working directory used for staging (deleted after each run). */
  releaseDir: resolve(PROJECT_ROOT, 'release'),

  /**
   * Vercel static-hosting output root. Everything the pipeline ships lives
   * under here as plain static files:
   *   public/releases/<version>/bundle.tar.gz   (+ .sha256, version.json)
   *   public/latest.json
   * `public/` is served at the site root by Vercel static hosting, so those
   * files resolve at /releases/<version>/bundle.tar.gz and /latest.json.
   */
  publicDir: resolve(PROJECT_ROOT, 'public'),

  /** Subdirectory (under publicDir) that holds one folder per version. */
  releasesSubdir: 'releases',

  /** Name of the "newest release" pointer served at the site root. */
  latestFileName: 'latest.json',

  /**
   * Base URL prepended to `download_url` in latest.json. Empty string yields a
   * root-relative path (/releases/<version>/bundle.tar.gz) which works as-is on
   * Vercel static hosting. Set RELEASE_BASE_URL (e.g. https://foo.vercel.app)
   * to emit absolute URLs — recommended for ESP32 OTA clients.
   */
  baseUrl: (process.env.RELEASE_BASE_URL ?? '').replace(/\/+$/, ''),

  /** Name of the final archive. */
  archiveName: 'bundle.tar.gz',

  /** Name of the metadata manifest. */
  versionFileName: 'version.json',

  /**
   * File extensions that are compressed to `.gz` with maximum compression.
   * These are text-based assets that gzip well and that an ESP32 web server
   * can serve directly with `Content-Encoding: gzip`.
   */
  compressibleExtensions: ['.html', '.js', '.css', '.svg'],

  /**
   * Extensions that are already compressed (or not worth compressing) and are
   * therefore copied through untouched. Listed explicitly for documentation /
   * sanity-checking; anything not in `compressibleExtensions` is left as-is.
   */
  skipCompressionExtensions: [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico',
    '.mp3', '.ogg', '.wav', '.m4a',
    '.woff', '.woff2', '.ttf', '.eot',
    '.gz', '.br', '.zip', '.wasm',
  ],

  /** zlib gzip level. 9 == maximum compression. */
  gzipLevel: 9,

  /**
   * Deterministic timestamp (epoch seconds) written into every tar header so
   * the archive is byte-for-byte reproducible for a given input tree.
   * Overridden per-run by the orchestrator with the build timestamp.
   */
  mtime: 0,
};

/** Merge caller overrides over the defaults. */
export function resolveConfig(overrides = {}) {
  return { ...DEFAULT_CONFIG, ...overrides };
}
