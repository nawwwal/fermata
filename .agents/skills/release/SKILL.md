---
name: release
description: Cut a Fermata release — bump manifest version, tag, push, and let CI build the signed CRX (GitHub Release) and publish to the Chrome Web Store. Use when asked to "cut/ship/push a release", "release Fermata", or "publish a new version".
---

# Release Fermata

Fermata ships through a tag-triggered pipeline (`.github/workflows/release.yml`).
Pushing a `vX.Y.Z` tag whose number matches `manifest.json` builds a signed
CRX3, attaches it to a GitHub Release, and — because the `CWS_*` secrets are
configured — zips the extension and auto-publishes it to the Chrome Web Store.

This skill performs that ritual safely. Do the steps in order; stop and report
if any check fails.

## Inputs

- `$ARGUMENTS` may contain an explicit version (e.g. `0.5.0`). If absent, bump
  the **patch** of the current `manifest.json` version.

## Background facts (do not re-derive)

- The extension has **two identities**: the Chrome Web Store item
  `faajhieeadooipnoijnecgeepfgcimho` (Google holds its key; the store path
  uploads a **ZIP** and re-signs) and the local CRX signed by `key.pem`
  (a *different* id `kfcpcnbhhiafbbebflpgmngnficnpnem`, used only for the
  GitHub-release download). Never make the store job upload the CRX.
- `key.pem` is gitignored and must never be committed. CI signs from the
  `CRX_PRIVATE_KEY` secret. All five secrets (`CRX_PRIVATE_KEY`,
  `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`)
  are already set.
- The store requires the new version to be **greater** than the published one.

## Steps

1. **Clean tree + on main.** Run `git status --porcelain` and `git rev-parse
   --abbrev-ref HEAD`. If there are uncommitted changes unrelated to the
   release, or the branch isn't `main`, stop and ask.

2. **Resolve the version.** Read `manifest.json`'s `version`. Use the explicit
   arg if given, else bump the patch. Confirm the chosen `vX.Y.Z` tag does not
   already exist: `git tag -l vX.Y.Z` must be empty (and pick a higher number
   than any existing `v*` tag).

3. **Sanity-check the source** (there is no test harness, so this is the floor):
   ```
   for f in src/page.js src/content.js src/background.js pages/storyboard.js; do node --check "$f"; done
   node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
   ```
   If `key.pem` exists locally, also do a real build to prove the package is
   valid before tagging: `./scripts/pack-crx.sh` (it asserts the `Cr24` magic
   internally). Skip the local build if there's no key — CI will build anyway.

4. **Bump `manifest.json`** to the chosen version (only the `version` field).

5. **Commit** on main:
   ```
   git add manifest.json
   git commit -m "Release X.Y.Z"
   ```
   End the commit message with the `Co-Authored-By: Claude …` trailer per repo
   convention. If other staged release changes were intended, include them.

6. **Tag and push** (tag number must match the manifest version exactly):
   ```
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z
   ```

7. **Watch CI** until both jobs finish:
   ```
   id=$(gh run list --workflow=release.yml --event=push --limit 1 --json databaseId -q '.[0].databaseId')
   gh run watch "$id" --exit-status
   gh run view "$id" --json conclusion,jobs -q '.conclusion, (.jobs[] | "\(.name): \(.conclusion)")'
   ```
   Expect `crx: success` and `publish-store: success`. If `publish-store` is
   skipped, the `CWS_*` secrets aren't set; if it fails, read the step log
   (`gh run view "$id" --log-failed`) — common causes: the version isn't higher
   than the published one, or the Web Store API token/scope is wrong.

8. **Verify the artifacts** and report links:
   ```
   gh release view vX.Y.Z --json name,url,assets -q '.name, .url, (.assets[] | "  \(.name) (\(.size) bytes)")'
   ```
   Confirm `fermata-X.Y.Z.crx` is attached. The store submission goes live
   after Google's review.

## Report

Tell the user: the version shipped, the GitHub Release URL + CRX asset, and
that the store publish was accepted (pending review). Note any non-fatal CI
annotations only if they matter.

## Guardrails

- Never commit `key.pem` or any `.pem`/secret.
- Never downgrade or reuse a version number; the store and the tag both reject it.
- Don't change the store job to upload the CRX — it must stay a ZIP.
- If `git push` to `main` is blocked or the tag exists, stop and surface it
  rather than forcing.
