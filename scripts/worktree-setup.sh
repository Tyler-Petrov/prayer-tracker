#!/usr/bin/env bash
#
# Prepares a fresh worktree so `pnpm dev` runs with no extra setup.
#
# Cloudflare has no equivalent of `vercel env pull`: Worker secrets are
# write-only, so the dev values can't be fetched from there. Every checkout
# shares one Convex dev deployment and one Clerk development instance, so the
# main checkout's .env.local is the source of truth and gets copied in.
#
# Runs automatically from the T3 Code "Setup Worktree" action on worktree
# creation, and is safe to re-run by hand: an existing .env.local is kept.
set -euo pipefail

# T3 Code exports the worktree it just created; outside T3 Code, use the
# checkout this script lives in.
if [ -n "${T3CODE_WORKTREE_PATH:-}" ]; then
	root="$T3CODE_WORKTREE_PATH"
else
	script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
	root="$(git -C "$script_dir" rev-parse --show-toplevel)"
fi
cd "$root"
root="$(pwd -P)"

# The main checkout is the parent of the shared .git directory.
main_checkout="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

if [ "$root" = "$main_checkout" ]; then
	echo "This is the main checkout; run this script from a worktree." >&2
	exit 1
fi

echo "==> Installing dependencies in $root"
pnpm install

if [ -f .env.local ]; then
	echo "==> Keeping existing .env.local"
elif [ -f "$main_checkout/.env.local" ]; then
	echo "==> Copying .env.local from $main_checkout"
	cp "$main_checkout/.env.local" .env.local
else
	echo "!! $main_checkout/.env.local is missing. Run \`pnpm dev\` there once" >&2
	echo "   to create it, then add the Clerk dev keys and re-run this script." >&2
	exit 1
fi

missing=()
for name in CONVEX_DEPLOYMENT PUBLIC_CONVEX_URL PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY CLERK_FRONTEND_API_URL; do
	grep -Eq "^$name=[\"']?[^\"'[:space:]]" .env.local || missing+=("$name")
done

if [ ${#missing[@]} -gt 0 ]; then
	echo "!! .env.local is missing: ${missing[*]}" >&2
	echo "   Add them to $main_checkout/.env.local (Clerk keys come from the" >&2
	echo "   Clerk dashboard's development instance), delete this worktree's" >&2
	echo "   .env.local, then re-run this script to copy it again." >&2
	exit 1
fi

echo "==> Ready. Run \`pnpm dev\`."
