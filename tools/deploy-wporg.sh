#!/usr/bin/env bash
#
# Upload the built Live Sandbox Editor plugin to the WordPress.org plugin SVN.
#
# Consumes the clean tree produced by tools/build-zip.sh
# (dist/live-sandbox-editor/) and commits it to both trunk/ and
# tags/<version>/ in a single SVN revision. It does NOT build, tag git, or
# create GitHub releases — it only does the wordpress.org upload.
#
# Runs identically on a developer machine and in CI.
#
# Required environment:
#   SVN_USERNAME   wordpress.org SVN username
#   SVN_PASSWORD   wordpress.org SVN password
# Optional:
#   VERSION        override the version (default: derived from the plugin
#                  header, must match readme.txt "Stable tag")
set -euo pipefail

slug="live-sandbox-editor"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

stage_dir="dist/$slug"
svn_url="https://plugins.svn.wordpress.org/$slug"

die() {
	echo "::error::$*" >&2
	exit 1
}

echo "==> Checking prerequisites"
command -v svn >/dev/null 2>&1 || die "svn (subversion) is not installed. On macOS: brew install subversion."
command -v rsync >/dev/null 2>&1 || die "rsync is not installed."
[ -d "$stage_dir" ] || die "$stage_dir not found. Run tools/build-zip.sh first."
[ -n "${SVN_USERNAME:-}" ] || die "SVN_USERNAME is not set."
[ -n "${SVN_PASSWORD:-}" ] || die "SVN_PASSWORD is not set."

echo "==> Resolving version"
# In CI the workflow passes VERSION (already checked against readme there).
# For standalone/local runs, derive it from the plugin header and confirm it
# matches the readme "Stable tag".
version="${VERSION:-}"
if [ -z "$version" ]; then
	version="$(grep -oE '^[[:space:]]*\*[[:space:]]*Version:[[:space:]]*[^[:space:]]+' "$slug/live-sandbox-editor.php" | awk '{print $NF}')"
	readme_version="$(grep -oE '^Stable tag:[[:space:]]*[^[:space:]]+' "$slug/readme.txt" | awk '{print $NF}')"
	[ -n "$version" ] || die "Could not read Version from $slug/live-sandbox-editor.php."
	[ "$version" = "$readme_version" ] || die "Version mismatch: header='$version' readme Stable tag='$readme_version'."
fi
echo "    version: $version"

echo "==> Guarding against an already-released tag"
if svn ls "$svn_url/tags/$version" >/dev/null 2>&1; then
	die "tags/$version already exists on WordPress.org. Bump the version before deploying."
fi

echo "==> Checking out SVN repository"
svn_dir="$(mktemp -d)"
trap 'rm -rf "$svn_dir"' EXIT
svn checkout --quiet --depth immediates "$svn_url" "$svn_dir"
svn update --quiet --set-depth infinity "$svn_dir/trunk"

echo "==> Syncing build into trunk"
# --exclude='.svn' protects the working-copy metadata that --delete would
# otherwise prune (the staged tree carries no .svn directories).
rsync -a --delete --exclude='.svn' "$stage_dir/" "$svn_dir/trunk/"

cd "$svn_dir"

echo "==> Reconciling additions and deletions"
# Schedule every unversioned file under trunk for addition.
svn add --force --quiet trunk
# Schedule files rsync removed (status '!') for deletion.
svn status trunk | sed -n 's/^!  *//p' | while IFS= read -r missing; do
	svn rm --quiet "$missing"
done

echo "==> Creating tags/$version from trunk"
svn cp --quiet trunk "tags/$version"

echo "==> Committing to WordPress.org"
svn commit --quiet --non-interactive --no-auth-cache \
	--username "$SVN_USERNAME" --password "$SVN_PASSWORD" \
	--message "Deploy version $version" \
	trunk "tags/$version"

echo "==> Done: committed trunk and tags/$version to $svn_url"
