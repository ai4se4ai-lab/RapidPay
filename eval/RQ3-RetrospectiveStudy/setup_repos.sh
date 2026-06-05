#!/usr/bin/env bash
# setup_repos.sh - Clone the 10 subject projects from the paper
#                  and auto-fill snapshot_commit fields in config.yaml.
#
# The snapshot commit is chosen automatically as: "the latest commit at least
# 18 months in the past from now", which ensures we have a horizon of >=18
# months of post-snapshot history (matching the paper's RQ3 setup).
#
# Usage:
#   ./setup_repos.sh                  # clone all 10 (large download)
#   ./setup_repos.sh --shallow        # use --filter=blob:none for faster clones
#   ./setup_repos.sh --only react,scipy
#
# Disk space: full clones can total >50GB for all 10. Use --shallow when
# possible. We need the full commit history (no --depth=1) but can defer
# blob downloads.

set -euo pipefail

SHALLOW=0
ONLY=""
REPO_DIR="repos"
CONFIG_FILE="config.yaml"

declare -A REPOS=(
  [commons-lang]="https://github.com/apache/commons-lang.git"
  [spring-framework]="https://github.com/spring-projects/spring-framework.git"
  [tensorflow]="https://github.com/tensorflow/tensorflow.git"
  [react]="https://github.com/facebook/react.git"
  [vscode]="https://github.com/microsoft/vscode.git"
  [kernel_common]="https://github.com/aosp-mirror/kernel_common.git"
  [scipy]="https://github.com/scipy/scipy.git"
  [postgres]="https://github.com/postgres/postgres.git"
  [kubernetes]="https://github.com/kubernetes/kubernetes.git"
  [firefox]="https://github.com/mozilla-firefox/firefox.git"
)

declare -A IDS=(
  [commons-lang]=AC
  [spring-framework]=SF
  [tensorflow]=TF
  [react]=RE
  [vscode]=VS
  [kernel_common]=AN
  [scipy]=SC
  [postgres]=PO
  [kubernetes]=KU
  [firefox]=FI
)

# --- arg parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --shallow) SHALLOW=1; shift ;;
    --only)    ONLY="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

mkdir -p "$REPO_DIR"

clone_one() {
  local dirname="$1"
  local url="${REPOS[$dirname]}"
  local target="$REPO_DIR/$dirname"
  if [[ -d "$target/.git" ]]; then
    echo "[$dirname] Already cloned at $target"
    return 0
  fi
  echo "[$dirname] Cloning from $url ..."
  if [[ $SHALLOW -eq 1 ]]; then
    git clone --filter=blob:none --no-checkout "$url" "$target"
    (cd "$target" && git checkout HEAD)
  else
    git clone "$url" "$target"
  fi
}

pick_snapshot() {
  local target="$1"
  # Pick the latest commit on the default branch that is at least 18 months old
  local sha
  sha="$(git -C "$target" log --until='18 months ago' --format='%H' -n 1 || true)"
  if [[ -z "$sha" ]]; then
    # Fallback: latest commit at least 12 months ago
    sha="$(git -C "$target" log --until='12 months ago' --format='%H' -n 1 || true)"
  fi
  if [[ -z "$sha" ]]; then
    # Last resort: HEAD~1000 if available
    sha="$(git -C "$target" log --format='%H' -n 1 HEAD~1000 2>/dev/null || true)"
  fi
  echo "$sha"
}

update_config() {
  local id="$1"
  local sha="$2"
  if [[ -z "$sha" ]]; then
    echo "  [WARN] No snapshot commit picked for $id; leaving config unchanged."
    return
  fi
  # In-place update: find the matching project_id block and replace
  # REPLACE_WITH_COMMIT_HASH on the next snapshot_commit line.
  python3 - "$CONFIG_FILE" "$id" "$sha" <<'PY'
import sys, re, pathlib
cfg = pathlib.Path(sys.argv[1])
project_id, sha = sys.argv[2], sys.argv[3]
text = cfg.read_text(encoding="utf-8")
pat = re.compile(
    rf"(project_id:\s*{re.escape(project_id)}\b[\s\S]*?snapshot_commit:\s*)\S+",
    re.MULTILINE,
)
new = pat.sub(rf"\g<1>{sha}", text, count=1)
if new == text:
    print(f"  [WARN] Could not update {project_id} in {cfg}")
else:
    cfg.write_text(new, encoding="utf-8")
    print(f"  [OK] Set snapshot_commit for {project_id} = {sha[:12]}")
PY
}

if [[ -n "$ONLY" ]]; then
  IFS=',' read -ra SUBSET <<< "$ONLY"
fi

for dirname in "${!REPOS[@]}"; do
  if [[ -n "$ONLY" ]]; then
    match=0
    for s in "${SUBSET[@]}"; do
      [[ "$s" == "$dirname" || "$s" == "${IDS[$dirname]}" ]] && match=1
    done
    [[ $match -eq 1 ]] || continue
  fi
  clone_one "$dirname"
  sha="$(pick_snapshot "$REPO_DIR/$dirname")"
  update_config "${IDS[$dirname]}" "$sha"
done

echo
echo "Done. Inspect $CONFIG_FILE and adjust horizon_months / snapshot_commit if needed."
echo "Then run: python rq3_evaluate.py --config $CONFIG_FILE --output rq3_results/"
