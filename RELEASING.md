# Releasing Vex

## Cut a new release

1. Update version in `package.json` (e.g., `1.0.0` to `1.0.1`)
2. Commit: `git commit -am "Release v1.0.1"`
3. Tag: `git tag v1.0.1`
4. Push: `git push && git push --tags`
5. Build and publish:
   ```bash
   set GH_TOKEN=ghp_your_github_token_here
   npm run publish
   ```
6. Go to GitHub Releases, find the draft, add notes, publish.

## Getting a GitHub token

1. Go to https://github.com/settings/tokens
2. Generate new token (classic) with `repo` scope
3. Use as `GH_TOKEN` environment variable

## Installing from release

Download `Vex-Setup-X.Y.Z.exe` from GitHub Releases and run it.
Auto-updates handle all future versions.
