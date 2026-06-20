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

2. **Resolve the version + gather the changes.** Read `manifest.json`'s
   `version`. Use the explicit arg if given, else bump the patch. Confirm the
   chosen `vX.Y.Z` tag does not already exist: `git tag -l vX.Y.Z` must be empty
   (and pick a higher number than any existing `v*` tag). Capture the commits
   since the previous tag — you'll need them for both README hygiene and the
   release notes:
   ```
   prev=$(git tag -l 'v*' --sort=-v:refname | head -1)   # the latest existing tag
   git log --no-merges --stat "$prev"..HEAD
   ```

3. **README hygiene.** Before shipping, make the docs honest. Read what changed
   (the `git log` above) and reconcile it against `README.md` — especially the
   **"What Fermata does not govern"** limits, the capability claims, and the
   **Permissions** note. The repo's Definition of Done requires that behavior
   matches README claims *or* README is updated. If a capability, limit, or
   permission drifted, update `README.md` now (and `CLAUDE.md` if a guardrail or
   architectural fact changed). Keep prose accurate and in voice — this is not
   the changelog, just truth-in-advertising. Stage any doc fixes so they ride in
   the release commit. If nothing drifted, say so and move on.

4. **Sanity-check the source** (there is no test harness, so this is the floor):
   ```
   for f in src/page.js src/content.js src/background.js pages/storyboard.js; do node --check "$f"; done
   node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
   ```
   If `key.pem` exists locally, also do a real build to prove the package is
   valid before tagging: `./scripts/pack-crx.sh` (it asserts the `Cr24` magic
   internally). Skip the local build if there's no key — CI will build anyway.

5. **Bump `manifest.json`** to the chosen version (only the `version` field).

6. **Commit** on main (include any README/CLAUDE.md fixes from step 3):
   ```
   git add manifest.json README.md CLAUDE.md
   git commit -m "Release X.Y.Z"
   ```
   End the commit message with the `Co-Authored-By: Claude …` trailer per repo
   convention.

7. **Tag and push** (tag number must match the manifest version exactly):
   ```
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z
   ```

8. **Watch CI** until both jobs finish:
   ```
   id=$(gh run list --workflow=release.yml --event=push --limit 1 --json databaseId -q '.[0].databaseId')
   gh run watch "$id" --exit-status
   gh run view "$id" --json conclusion,jobs -q '.conclusion, (.jobs[] | "\(.name): \(.conclusion)")'
   ```
   Expect `crx: success` and `publish-store: success`. If `publish-store` is
   skipped, the `CWS_*` secrets aren't set; if it fails, read the step log
   (`gh run view "$id" --log-failed`) — common causes: the version isn't higher
   than the published one, or the Web Store API token/scope is wrong.

9. **Write real release notes.** CI created the Release with `--generate-notes`
   (a raw commit dump) as a fallback — replace it with curated notes. Build them
   from the commits since the previous tag:
   ```
   git log --no-merges --pretty='%s' "$prev"..vX.Y.Z
   ```
   Sort the meaningful entries into three headings — **New**, **Improved**,
   **Fixed** — dropping pure chore/release/CI-plumbing commits. Write in
   Fermata's calm editorial voice (see `.agents/fermata-brand-psychology.md`):
   lead each line with what the user can now do or what no longer breaks, not
   the implementation. Skip empty headings. Then set them, keeping the CRX asset:
   ```
   gh release edit vX.Y.Z --title "Fermata X.Y.Z" --notes "$(cat <<'NOTES'
   ## New
   - …

   ## Improved
   - …

   ## Fixed
   - …
   NOTES
   )"
   ```

10. **Verify the artifacts** and report links:
    ```
    gh release view vX.Y.Z --json name,url,assets -q '.name, .url, (.assets[] | "  \(.name) (\(.size) bytes)")'
    ```
    Confirm `fermata-X.Y.Z.crx` is attached and the notes read well. The store
    submission goes live after Google's review.

## Report

Tell the user: the version shipped, the GitHub Release URL + CRX asset, the
curated release notes you wrote, any README/doc fixes you made for accuracy
(or that none were needed), and that the store publish was accepted (pending
review). Note any non-fatal CI annotations only if they matter.

## Guardrails

- Never commit `key.pem` or any `.pem`/secret.
- Never downgrade or reuse a version number; the store and the tag both reject it.
- Don't change the store job to upload the CRX — it must stay a ZIP.
- Don't ship with a README that contradicts the build — fix the prose or don't
  release.
- Release notes describe user-facing change, not commit churn — never just dump
  the raw `git log`.
- If `git push` to `main` is blocked or the tag exists, stop and surface it
  rather than forcing.
