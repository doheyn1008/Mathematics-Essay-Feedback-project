#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec bash "${script_dir}/sites-env.sh" -- bash "${script_dir}/$(basename "$0")" "$@"
fi

command -v flock || {
  echo "install-ci.sh requires Linux flock." >&2
  exit 69
}
command -v timeout || {
  echo "install-ci.sh requires GNU timeout." >&2
  exit 69
}
command -v sha256sum || {
  echo "install-ci.sh requires sha256sum for cache and install verification." >&2
  exit 69
}

runtime_root="${SITES_RUNTIME_ROOT:-${SITES_PROJECT_ROOT}/.sites-runtime}"
expected_home="${runtime_root}/home"
expected_cache="${runtime_root}/npm-cache"

echo "[sites] validating writable install environment"
if [[ "${HOME}" != "${expected_home}" ]]; then
  echo "Expected HOME=${expected_home}, got HOME=${HOME}." >&2
  exit 78
fi
actual_cache="$(npm --prefix "${SITES_PROJECT_ROOT}" --workspaces=false config get cache)"
if [[ "${actual_cache}" != "${expected_cache}" ]]; then
  echo "Expected npm cache ${expected_cache}, got ${actual_cache}." >&2
  exit 78
fi
touch "${HOME}/.sites-write-test" "${expected_cache}/.sites-write-test"
rm -f "${HOME}/.sites-write-test" "${expected_cache}/.sites-write-test"
echo "[sites] environment passed: HOME=${HOME}, cache=${expected_cache}"

lock_file="${runtime_root}/install.lock"
exec 9>"${lock_file}"
if ! flock -n 9; then
  echo "Another dependency install is already running for ${SITES_PROJECT_ROOT}." >&2
  exit 75
fi

# Catch an installer started outside this helper. Linux exposes both its command
# line and working directory through /proc, so avoid broad process-name matches.
for process in /proc/[0-9]*; do
  pid="${process##*/}"
  [[ "${pid}" != "$$" && "${pid}" != "${PPID}" ]] || continue
  process_cwd="$(readlink -f "${process}/cwd" || true)"
  [[ "${process_cwd}" == "${SITES_PROJECT_ROOT}" ]] || continue
  process_command="$(tr '\0' ' ' <"${process}/cmdline" || true)"
  if [[ "${process_command}" == *"npm ci"* ]]; then
    echo "Another npm ci is visible in ${SITES_PROJECT_ROOT}; refusing to overlap installs." >&2
    exit 75
  fi
done

lockfile_sha256="$(sha256sum "${SITES_PROJECT_ROOT}/package-lock.json" | awk '{print $1}')"
use_seeded_cache=0
# Report seed selection separately from package cache hits or downloads.
cache_seed_result=seed_unavailable
seed_cache="${SITES_NPM_CACHE_SEED:-}"
if [[ -n "${seed_cache}" && -d "${seed_cache}" ]]; then
  seed_lockfile_sha256="$(cat "${seed_cache}/.sites-lockfile-sha256" || true)"
  if [[ "${seed_lockfile_sha256}" == "${lockfile_sha256}" ]]; then
    echo "[sites] restoring image-seeded npm cache"
    cp -a "${seed_cache}/." "${expected_cache}/"
    use_seeded_cache=1
    cache_seed_result=seed_used
    echo "[sites] image cache seed matched; registry fallback remains available"
  else
    cache_seed_result=seed_lockfile_mismatch
    echo "[sites] image cache seed does not match this lockfile; using the network path"
  fi
fi

# Let npm resolve, authenticate and verify every lockfile tarball. A separate
# curl probe cannot use registry-scoped .npmrc credentials.

echo "[sites] running exactly one bounded npm ci"
export NPM_CONFIG_MAXSOCKETS=1
export NPM_CONFIG_FETCH_RETRIES=0
export NPM_CONFIG_FETCH_TIMEOUT=30000
npm_ci_args=(ci --prefix "${SITES_PROJECT_ROOT}" --workspaces=false --include=dev --include=optional --cache "${expected_cache}")
if [[ "${use_seeded_cache}" == "1" ]]; then
  npm_ci_args+=(--prefer-offline)
fi
timeout \
  --signal=TERM \
  --kill-after="${SITES_INSTALL_KILL_AFTER:-15s}" \
  "${SITES_INSTALL_TIMEOUT:-8m}" \
  node "${script_dir}/npm-install.mjs" "${cache_seed_result}" npm "${npm_ci_args[@]}"

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "npm ci exited successfully but node_modules/.bin/vinext is unavailable." >&2
  exit 69
fi

node --input-type=module - "${SITES_PROJECT_ROOT}/node_modules/.sites-install.json" "${lockfile_sha256}" <<'NODE'
import { writeFile } from "node:fs/promises";

await writeFile(
  process.argv[2],
  `${JSON.stringify({
    lockfile_sha256: process.argv[3],
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  }, null, 2)}\n`,
);
NODE
echo "[sites] npm ci passed and vinext is available"
