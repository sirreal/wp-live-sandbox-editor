#!/usr/bin/env bash
#
# (Re)build live-sandbox-editor/vendor-prefixed/ with Strauss.
#
# Strauss is not a Composer dependency of the plugin: pulling it in as a
# require-dev drags ~50 transitive packages (symfony, league, monolog, …) into
# live-sandbox-editor/vendor/ on every install. Instead we use the
# self-contained release phar, downloaded on demand to .bin/ (gitignored) and
# pinned to a known version here.
#
# The phar reads the `extra.strauss` config and the installed packages from the
# directory it runs in, so the plugin's runtime dependencies must already be
# installed: composer install --working-dir=live-sandbox-editor.
set -euo pipefail

strauss_version="0.27.2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Version-stamped filename so bumping strauss_version triggers a fresh download
# instead of silently reusing a stale phar.
phar="$repo_root/.bin/strauss-${strauss_version}.phar"
plugin_dir="$repo_root/live-sandbox-editor"

if [ ! -f "$phar" ]; then
	echo "==> Downloading Strauss $strauss_version to .bin/"
	mkdir -p "$repo_root/.bin"
	curl -fsSL -o "$phar" \
		"https://github.com/BrianHenryIE/strauss/releases/download/${strauss_version}/strauss.phar"
fi

echo "==> Prefixing bundled dependencies into vendor-prefixed/"
( cd "$plugin_dir" && php "$phar" --no-interaction )
