#!/usr/bin/env bash
# =============================================================================
# scrub-history.sh
# -----------------------------------------------------------------------------
# Paranoid identity-scrub for the CF-IP-Scanner repository.
#
# Replaces every reference to the OLD maintainer identity with the new
# anonymous identity across:
#   - All commit author/committer fields (every branch, every tag)
#   - All commit messages (across history)
#   - All historical file blobs (tracked content of every commit)
#
# Designed for: Windows + Git Bash (MINGW), Python venv at .venv\, paranoid mode
# Safe by default: creates a mirror backup BEFORE any rewrite. Aborts on error.
# Run from repo root. The script is idempotent only on the FIRST run; after
# rewriting, commit hashes change so re-running needs a fresh state.
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

REPO_ROOT="$(pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
BACKUP_DIR="$(dirname "$REPO_ROOT")/${REPO_NAME}.backup-prescrub-$(date +%Y%m%d-%H%M%S)"

NEW_NAME="Khate Tire"
NEW_EMAIL="khatetire@proton.me"

echo "============================================================"
echo "  IDENTITY SCRUB — git-filter-repo"
echo "  Repo:     $REPO_ROOT"
echo "  Backup:   $BACKUP_DIR  (mirror clone)"
echo "  New ID:   $NEW_NAME <$NEW_EMAIL>"
echo "============================================================"

# -----------------------------------------------------------------------------
# 0. Sanity checks
# -----------------------------------------------------------------------------
if [ ! -d ".git" ]; then
    echo "FATAL: not a git repository (no .git/ in $REPO_ROOT)" >&2
    exit 1
fi

# Ensure we are not on a detached HEAD
CURRENT_BRANCH="$(git symbolic-ref --short -q HEAD || true)"
if [ -z "$CURRENT_BRANCH" ]; then
    echo "FATAL: detached HEAD. Checkout a branch first." >&2
    exit 1
fi
echo "[ok] On branch: $CURRENT_BRANCH"

# Verify new identity is configured locally
GIT_NAME="$(git config user.name || true)"
GIT_EMAIL="$(git config user.email || true)"
if [ "$GIT_NAME" != "$NEW_NAME" ] || [ "$GIT_EMAIL" != "$NEW_EMAIL" ]; then
    echo "FATAL: local git identity is '$GIT_NAME <$GIT_EMAIL>'" >&2
    echo "       expected '$NEW_NAME <$NEW_EMAIL>'. Set with:" >&2
    echo "         git config user.name  \"$NEW_NAME\"" >&2
    echo "         git config user.email \"$NEW_EMAIL\"" >&2
    exit 1
fi
echo "[ok] Git identity: $GIT_NAME <$GIT_EMAIL>"

# -----------------------------------------------------------------------------
# 1. Install git-filter-repo if missing
# -----------------------------------------------------------------------------
if ! command -v git-filter-repo >/dev/null 2>&1 && ! python -c "import git_filter_repo" 2>/dev/null; then
    echo "[..] git-filter-repo not found; installing via pip..."
    python -m pip install --quiet git-filter-repo
fi
# Resolve invocation. On Windows the pip-installed git-filter-repo script
# may not be discoverable as a `git` subcommand (no .exe wrapper), so we
# prefer the direct script path or `python -m git_filter_repo`.
if python -c "import git_filter_repo" 2>/dev/null; then
    FILTER_REPO="python -m git_filter_repo"
elif command -v git-filter-repo >/dev/null 2>&1; then
    FILTER_REPO="$(command -v git-filter-repo)"
else
    FILTER_REPO="git filter-repo"
fi
echo "[ok] git-filter-repo invocation: $FILTER_REPO"

# -----------------------------------------------------------------------------
# 2. Commit any in-progress work under the NEW identity (so it's in history
#    when we rewrite). filter-repo refuses to run on a dirty tree.
# -----------------------------------------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
    echo "[..] Working tree dirty — committing all changes under new identity"
    git add -A
    git commit -m "chore: production hardening v2.1.4 + identity scrub prep" \
               --author="$NEW_NAME <$NEW_EMAIL>"
else
    echo "[ok] Working tree clean"
fi

# -----------------------------------------------------------------------------
# 3. Backup mirror clone  (NEVER PUSH THIS — it contains the OLD identity)
# -----------------------------------------------------------------------------
if [ -d "$BACKUP_DIR" ]; then
    echo "FATAL: backup dir $BACKUP_DIR already exists" >&2
    exit 1
fi
echo "[..] Creating safety backup at $BACKUP_DIR"
git clone --mirror "$REPO_ROOT" "$BACKUP_DIR" >/dev/null
echo "[ok] Backup created. DELETE IT MANUALLY after Phase 3 verification passes:"
echo "     rm -rf \"$BACKUP_DIR\""

# -----------------------------------------------------------------------------
# 4. Build mailmap — covers every author/committer variant in history
# -----------------------------------------------------------------------------
MAILMAP_FILE="$(mktemp)"
cat > "$MAILMAP_FILE" <<'EOF'
Khate Tire <khatetire@proton.me> Khate-Tire <khatetire@proton.me>
Khate Tire <khatetire@proton.me> Khate Tire <khatetire@proton.me>
Khate Tire <khatetire@proton.me> Khate Tire <khatetire@proton.me>
Khate Tire <khatetire@proton.me> <khatetire@proton.me>
# GitHub noreply variants — covers web-edits / squash merges
Khate Tire <khatetire@proton.me> Khate-Tire <Khate-Tire@users.noreply.github.com>
Khate Tire <khatetire@proton.me> <Khate-Tire@users.noreply.github.com>
EOF
echo "[ok] Mailmap built:"
sed 's/^/        /' "$MAILMAP_FILE"

# -----------------------------------------------------------------------------
# 5. Build replacements.txt — scrubs blob contents AND commit messages.
#    Matched literally and case-INSENSITIVELY where marked (==>...==>i not
#    supported; we list common casings explicitly to avoid false-positive
#    risk of regex). Any regex line uses 'regex:' prefix.
# -----------------------------------------------------------------------------
REPLACEMENTS_FILE="$(mktemp)"
cat > "$REPLACEMENTS_FILE" <<'EOF'
khatetire@proton.me==>khatetire@proton.me
khatetire==>khatetire
KhateTire==>KhateTire
Khate Tire==>Khate Tire
Khate Tire==>Khate Tire
KHATE TIRE==>KHATE TIRE
Khate-Tire==>Khate-Tire
KHATE-TIRE==>KHATE-TIRE
Khate-Tire==>Khate-Tire
hossein_shiravani==>hossein_shiravani
HOSSEIN_SHIRAVANI==>HOSSEIN_SHIRAVANI
Hossein_Shiravani==>Hossein_Shiravani
EOF
echo "[ok] Replacements list built:"
sed 's/^/        /' "$REPLACEMENTS_FILE"

# -----------------------------------------------------------------------------
# 6. Cleanup function — fires on EXIT (success or failure)
# -----------------------------------------------------------------------------
cleanup() {
    rm -f "$MAILMAP_FILE" "$REPLACEMENTS_FILE"
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# 7. THE REWRITE — single invocation, one pass over history.
#    --force         : we already made a backup; bypass safety prompt
#    --mailmap       : rewrite author/committer identities
#    --replace-text  : scrub blob contents + commit messages
# -----------------------------------------------------------------------------
echo "[..] Rewriting history (this may take a minute)..."
$FILTER_REPO \
    --force \
    --mailmap "$MAILMAP_FILE" \
    --replace-text "$REPLACEMENTS_FILE"

echo "[ok] History rewritten."

# -----------------------------------------------------------------------------
# 8. Re-add origin (filter-repo intentionally drops it). Verify.
# -----------------------------------------------------------------------------
if ! git remote get-url origin >/dev/null 2>&1; then
    echo "[..] Re-adding origin remote -> Khate-Tire/CF-IP-Scanner"
    git remote add origin https://github.com/Khate-Tire/CF-IP-Scanner.git
fi
echo "[ok] Remote: $(git remote get-url origin)"

# -----------------------------------------------------------------------------
# 9. Aggressive GC — drop refs/original/* and pack everything.
# -----------------------------------------------------------------------------
echo "[..] Aggressive garbage collection..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive
echo "[ok] GC complete."

echo ""
echo "============================================================"
echo "  DONE. Run Phase 3 verification commands now."
echo "  When verified, force-push with Phase 4 commands."
echo "  Don't forget to delete the backup:"
echo "      rm -rf \"$BACKUP_DIR\""
echo "============================================================"
