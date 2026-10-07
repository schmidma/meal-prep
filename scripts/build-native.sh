#!/usr/bin/env bash
set -euo pipefail

# Run after npm ci and npm run build. Install runtime dependencies separately so
# packaging never prunes the developer's working installation.
cd "$(dirname "$0")/.."
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Native archives currently target Linux x64.' >&2; exit 1; }
version=$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || exit 1
name="meal-prep-$version-linux-x64"
output="$PWD/dist"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$name" "$output"
cp package.json package-lock.json "$staging/$name/"
# Optional framework integrations otherwise pull development tools into the archive.
# Required runtime dependencies remain installed; the extracted archive is smoke-tested.
npm ci --prefix "$staging/$name" --omit=dev --omit=optional --ignore-scripts
# Sharp's Linux x64 runtime is optional to npm, but required for image resizing.
# Copy the exact binaries installed from our lockfile without pulling in optional frameworks.
mkdir -p "$staging/$name/node_modules/@img"
cp -a node_modules/@img/sharp-linux-x64 node_modules/@img/sharp-libvips-linux-x64 "$staging/$name/node_modules/@img/"
cp -a build LICENSE README.md "$staging/$name/"
mkdir -p "$staging/$name/deploy"
cp -a deploy/native "$staging/$name/deploy/"
git rev-parse HEAD > "$staging/$name/REVISION"
tar -czf "$output/$name.tar.gz" -C "$staging" "$name"
(cd "$output" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
printf 'Created %s\n' "$output/$name.tar.gz"
