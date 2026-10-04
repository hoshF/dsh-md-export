#!/bin/sh
# Package dsh-md-export and install it into a DSH profile.
#
#   ./install.sh
#
# Pack -> install -> report the profile's dependency and bundle registration.
# Restart DSH for host changes and hard-refresh the page for client changes.
#
# Overridable environment:
#   DSH_HOME          DSH home                    (default: ~/.dsh)
#   DSH_PROFILE       profile name                (default: desktop)
#   DSH_PROFILE_DIR   profile directory           (default: $DSH_HOME/profiles/$DSH_PROFILE)
#   DSH_NODE          node executable             (default: auto-detected)
#   DSH_PNPM          pnpm executable or pnpm.mjs (default: auto-detected)
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-desktop}"
PROFILE_DIR="${DSH_PROFILE_DIR:-$DSH_HOME/profiles/$PROFILE}"
PACKAGE="dsh-md-export"

SRC="$(cd "$(dirname "$0")" && pwd)"
cd "$SRC"

# ------------------------------------------------------------------ probing

find_node() {
  [ -n "${DSH_NODE:-}" ] && { printf '%s\n' "$DSH_NODE"; return 0; }
  command -v node 2>/dev/null && return 0
  for candidate in "$DSH_HOME"/dsh-runtimes/*/dependencies/node/bin/node; do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

find_pnpm() {
  [ -n "${DSH_PNPM:-}" ] && { printf '%s\n' "$DSH_PNPM"; return 0; }
  command -v pnpm 2>/dev/null && return 0
  for candidate in \
    "$DSH_HOME"/dsh-runtimes/*/dependencies/pnpm/bin/pnpm.mjs \
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.mjs"
  do
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

NODE="$(find_node || true)"
PNPM="$(find_pnpm || true)"

[ -n "$NODE" ] || { echo "error: node not found; set DSH_NODE" >&2; exit 1; }
[ -n "$PNPM" ] || { echo "error: pnpm not found; set DSH_PNPM" >&2; exit 1; }
[ -d "$PROFILE_DIR" ] || { echo "error: profile directory not found: $PROFILE_DIR" >&2; exit 1; }

# pnpm may be a real executable or the bundled pnpm.mjs.
run_pnpm() {
  case "$PNPM" in
    *.mjs|*.cjs|*.js) "$NODE" "$PNPM" "$@" ;;
    *) "$PNPM" "$@" ;;
  esac
}

echo "node   : $NODE"
echo "pnpm   : $PNPM"
echo "profile: $PROFILE_DIR"

# ------------------------------------------------------------------ install

mkdir -p "$SRC/dist"
echo "-> packing"
run_pnpm pack --pack-destination "$SRC/dist" >/dev/null

TARBALL="$(ls -t "$SRC"/dist/"$PACKAGE"-*.tgz | head -1)"
echo "-> installing $(basename "$TARBALL")"
cd "$PROFILE_DIR"

# Remove the old spec before resolving a replacement local tarball.
run_pnpm remove "$PACKAGE" >/dev/null 2>&1 || true

# Refresh same-version packages while preserving the profile's lockfile.
run_pnpm add --force "file:$TARBALL" >/dev/null

# ------------------------------------------------------------------ register

# DSH loads installed bundles listed in dsh.profile.bundles.
echo "-> registering the bundle"
"$NODE" -e '
const fs = require("fs");
const path = require("path");
const [manifestPath, pkg, profileDir] = process.argv.slice(1);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const bundles = manifest.dsh?.profile?.bundles ?? [];

// Only a package that actually ships a bundle patch belongs in the layer list.
let declaresBundle = false;
try {
  const installed = JSON.parse(
    fs.readFileSync(path.join(profileDir, "node_modules", pkg, "package.json"), "utf8"));
  declaresBundle = installed.dsh?.bundle?.patch !== undefined;
} catch {
  // No readable bundle declaration: keep the profile unchanged.
}

if (!declaresBundle) {
  console.log(`   ! ${pkg} declares no dsh.bundle patch; not registering a layer`);
} else if (bundles.includes(pkg)) {
  console.log(`   ${pkg} is already registered`);
} else {
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, pkg] } };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`   registered ${pkg} in dsh.profile.bundles`);
}

const after = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
console.log("   deps   :", JSON.stringify(after.dependencies ?? {}));
console.log("   bundles:", (after.dsh?.profile?.bundles ?? []).join(", "));
' "$PROFILE_DIR/package.json" "$PACKAGE" "$PROFILE_DIR"

echo "done. Host-side changes need a DSH restart; client changes need a HARD refresh (Cmd/Ctrl+Shift+R)."
