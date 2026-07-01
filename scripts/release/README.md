# ESP32 Release Packaging Pipeline

Packages the production Angular build into a single, reproducible
`bundle.tar.gz` suitable for flashing to an ESP32 filesystem (LittleFS/SPIFFS)
and serving with `Content-Encoding: gzip`.

## Usage

```bash
# Full pipeline: production build + package
npm run release:esp32

# Package only (reuse an existing dist/)
npm run package:esp32
```

## Output — a Vercel-deployable static tree

Artifacts are written under `public/` (served at the site root by Vercel static
hosting — **pure static files, no backend**):

```
public/
├── latest.json                          # pointer to the newest version
└── releases/
    └── <version>/
        ├── bundle.tar.gz                 # the shippable archive
        ├── bundle.tar.gz.sha256          # shasum -a 256 compatible sidecar
        └── version.json                  # resolved manifest (real hash)
```

`latest.json` always points at the **highest semver** across all published
release folders, and contains exactly:

```json
{
  "version": "1.2.0",
  "download_url": "/releases/1.2.0/bundle.tar.gz",
  "sha256": "…"
}
```

- `download_url` defaults to a **root-relative** path (works on Vercel as-is).
  Set `RELEASE_BASE_URL=https://your-app.vercel.app` to emit **absolute** URLs —
  recommended for ESP32 OTA clients that need a full URL.
- `latest.json` is regenerated from the newest folder on every run, so building
  an older version after a newer one **does not** move `latest` backwards.
- [`vercel.json`](../../vercel.json) sets caching headers only (no functions):
  `latest.json` is always revalidated; `/releases/*` are `immutable`.

## What it does

1. Reads Angular's output from `dist/arcade-basketball-ui/browser`.
2. Copies every file into a staging tree, **preserving directory structure**.
3. Gzips text assets (`.html`, `.js`, `.css`, `.svg`) at **level 9**, writing a
   `<name>.gz` sibling next to each original. Binary/already-compressed assets
   (jpg, png, mp3, fonts, …) are left untouched.
4. Generates `version.json` (semantic version from `package.json`, ISO build
   timestamp, list of generated `.gz` files, and the bundle sha256).
5. Assembles `bundle.tar.gz` containing `version.json`, all `.gz` assets, and
   all original static assets.
6. Publishes the archive into `public/releases/<version>/` and refreshes
   `public/latest.json`.

> **Angular asset isolation:** `public/` is also Angular's asset source dir, so
> `angular.json` **ignores** `releases/**` and `latest.json` — otherwise every
> `ng build` would copy prior releases into `dist/` and the next bundle would
> recursively absorb them. The generated files are also git-ignored; generate
> them in CI and deploy the `public/` tree.

> **Hash chicken-and-egg:** `version.json` describes the archive it lives
> inside, so the *embedded* copy carries `"sha256": "PENDING"`. The per-version
> `version.json` (outside the archive) and the `.sha256` sidecar carry the real
> hash of the final bundle.

## Modules (reusable from CI/CD)

Each concern is a standalone ESM module; import `runRelease` for programmatic use.

| Module          | Responsibility                                              |
| --------------- | ----------------------------------------------------------- |
| `config.mjs`    | Paths, compressible extensions, gzip level (override-able). |
| `fs-utils.mjs`  | Deterministic recursive walk, dir reset/ensure.             |
| `compress.mjs`  | Stage + gzip text assets.                                   |
| `tar.mjs`       | Dependency-free, deterministic USTAR tar writer.            |
| `version.mjs`   | Version manifest construction.                              |
| `bundle.mjs`    | Tar + gzip assembly, sha256 hashing.                        |
| `publish.mjs`   | Vercel static tree layout + `latest.json` (semver-aware).   |
| `index.mjs`     | Orchestrator + CLI entry (`runRelease`).                    |

```js
import { runRelease } from './scripts/release/index.mjs';

// Override any config field, e.g. a different dist dir / base URL in CI:
const summary = runRelease({
  distDir: '/build/out/browser',
  baseUrl: 'https://your-app.vercel.app',
});
// => { version, timestamp, sha256, versionDir, latestPath, latest, gzipFiles }
```

The tar writer is pure JavaScript (no shelling out to `tar`), so output is
identical on macOS (bsdtar) and Linux CI runners, and byte-for-byte
reproducible for a given input tree.
