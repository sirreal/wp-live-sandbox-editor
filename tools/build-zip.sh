#!/usr/bin/env bash
#
# Build a WordPress.org-ready zip of the Live Sandbox Editor plugin.
#
# Produces:
#   dist/live-sandbox-editor/      clean plugin tree
#   dist/live-sandbox-editor.zip   zip with a top-level live-sandbox-editor/ folder
#
# Runs identically on a developer machine and in CI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

plugin_src="live-sandbox-editor"
dist_dir="dist"
stage_dir="$dist_dir/$plugin_src"

echo "==> Installing PHP dependencies (runs Strauss prefixing)"
composer install --working-dir="$plugin_src" --optimize-autoloader --no-interaction

echo "==> Building front-end assets"
npm run build

echo "==> Staging plugin files"
rm -rf "$dist_dir"
mkdir -p "$stage_dir"

cp "$plugin_src/live-sandbox-editor.php" "$stage_dir/"
cp "$plugin_src/readme.txt"              "$stage_dir/"
cp "$plugin_src/style.css"               "$stage_dir/"
cp -R "$plugin_src/inc"                  "$stage_dir/inc"
cp -R "$plugin_src/templates"            "$stage_dir/templates"
cp -R "$plugin_src/vendor-prefixed"      "$stage_dir/vendor-prefixed"
rsync -a --exclude='*.map' "$plugin_src/build/" "$stage_dir/build/"

echo "==> Pruning development files from bundled dependencies"
# Bundled packages carry test fixtures, dev metadata, and helper scripts that
# must not ship. WordPress.org rejects plugins that contain shell scripts and
# similar non-runtime files (see issue #72), so strip them here in addition to
# the obvious dev artifacts. LICENSE files are kept for GPL compliance.
find "$stage_dir/vendor-prefixed" -type d \
	\( -name 'Tests' -o -name 'tests' -o -name '.github' \) \
	-prune -exec rm -rf {} +
find "$stage_dir/vendor-prefixed" -type f \
	\( -name '*.md' ! -iname 'license*' \
	-o -name '*.sh' \
	-o -name 'Makefile' \
	-o -name '*.dist' \
	-o -name '*.neon' \
	-o -name '*.yml' -o -name '*.yaml' \
	-o -name '.gitignore' -o -name '.gitattributes' -o -name '.editorconfig' \
	-o -name 'composer.json' \
	-o -name 'phpunit.xml*' \) \
	-delete

echo "==> Verifying no disallowed files remain"
# WordPress.org rejects plugins containing scripts and executables (issue #72).
# Fail the build if the prune above missed any, e.g. when a new dependency
# introduces a file type the patterns do not cover.
disallowed="$(find "$stage_dir" -type f \
	\( -name '*.sh' -o -name '*.exe' -o -name '*.bat' -o -name '*.cmd' \
	-o -name '*.phar' -o -name '*.bin' \) )"
if [ -n "$disallowed" ]; then
	echo "::error::Disallowed files present in the build:" >&2
	printf '%s\n' "$disallowed" >&2
	exit 1
fi

echo "==> Creating zip"
( cd "$dist_dir" && zip -r -X "$plugin_src.zip" "$plugin_src" >/dev/null )

echo "==> Done: $dist_dir/$plugin_src.zip"
