#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# setup-repo.sh — 新規リポジトリの GitHub 設定を自動化
#
# 使い方:
#   gh repo create my-project --template rymetry/repo-template --public --clone
#   cd my-project
#   bash .github/scripts/setup-repo.sh
# =============================================================================

# ---------------------------------------------------------------------------
# 0. 前提チェック
# ---------------------------------------------------------------------------
command -v gh >/dev/null 2>&1 || { echo "❌ gh CLI が必要です: https://cli.github.com/"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "❌ gh auth login を先に実行してください"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "❌ git が必要です"; exit 1; }

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
AUTHOR=$(gh api "repos/$REPO" --jq '.owner.login')
YEAR=$(date +%Y)

echo ""
echo "========================================="
echo "  repo-template setup"
echo "  Repository: $REPO"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# 1. プレースホルダーの置換
# ---------------------------------------------------------------------------
echo "📝 Replacing placeholders..."

replace_in_file() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$1" "$2"
  else
    sed -i "$1" "$2"
  fi
}

# LICENSE
replace_in_file "s/{{YEAR}}/$YEAR/g" LICENSE
replace_in_file "s/{{AUTHOR}}/$AUTHOR/g" LICENSE

# SECURITY.md
replace_in_file "s|{{REPO}}|$REPO|g" SECURITY.md

echo "  LICENSE: {{YEAR}} → $YEAR, {{AUTHOR}} → $AUTHOR"
echo "  SECURITY.md: {{REPO}} → $REPO"

# ---------------------------------------------------------------------------
# 2. リポジトリ設定
# ---------------------------------------------------------------------------
echo ""
echo "⚙️  Configuring repository settings..."

gh repo edit "$REPO" \
  --enable-projects=false \
  --enable-discussions=false \
  --enable-wiki=false \
  --delete-branch-on-merge \
  --enable-auto-merge

echo "  Projects: OFF"
echo "  Discussions: OFF"
echo "  Wiki: OFF"
echo "  Delete branch on merge: ON"
echo "  Auto-merge: ON"

# ---------------------------------------------------------------------------
# 3. Dependabot alerts
# ---------------------------------------------------------------------------
echo ""
echo "🔒 Enabling Dependabot alerts..."

if gh api -X PUT "repos/$REPO/vulnerability-alerts" 2>/dev/null; then
  echo "  Dependabot alerts: ON"
else
  echo "  ⚠️  Dependabot alerts の設定に失敗しました"
fi

# ---------------------------------------------------------------------------
# 4. Actions permissions
# ---------------------------------------------------------------------------
echo ""
echo "🔐 Configuring Actions permissions..."

if gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  --input - <<'PERMS' 2>/dev/null; then
{
  "default_workflow_permissions": "read",
  "can_approve_pull_request_reviews": true
}
PERMS
  echo "  Workflow permissions: Read only"
  echo "  PR approval by Actions: Allowed"
else
  echo "  ⚠️  Actions permissions の設定に失敗しました"
fi

# ---------------------------------------------------------------------------
# 5. Branch protection (main)
# ---------------------------------------------------------------------------
echo ""
echo "🛡️  Setting up branch protection for main..."

if gh api -X PUT "repos/$REPO/branches/main/protection" \
  --input - <<'PROTECTION' 2>/dev/null; then
{
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "enforce_admins": false,
  "restrictions": null,
  "required_status_checks": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
PROTECTION
  echo "  PR required: ON (0 approvals, self-merge OK)"
  echo "  Admin bypass: ON"
  echo "  Force push: BLOCKED"
  echo "  Branch deletion: BLOCKED"
else
  echo "  ⚠️  Branch protection の設定に失敗しました（Free プランのプライベートリポジトリでは利用不可）"
fi

# ---------------------------------------------------------------------------
# 6. コミット & 完了
# ---------------------------------------------------------------------------
echo ""
echo "📦 Committing placeholder replacements..."

git add LICENSE SECURITY.md
if git diff --cached --quiet; then
  echo "  No changes to commit"
else
  git commit -m "chore: setup-repo.sh によるプレースホルダー置換"
  git push
  echo "  Committed and pushed"
fi

echo ""
echo "========================================="
echo "  ✅ Setup complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. README.md をプロジェクト固有の内容に書き換える"
echo "  2. Settings > Security で Secret scanning を有効化する（UI のみ）"
echo "  3. Settings > Security で Private vulnerability reporting を有効化する（UI のみ）"
echo ""
