#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CWD="${CLAUDE_PROJECT_DIR:-$(pwd)}"

BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
  exit 0
fi

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  exit 0
fi

if echo "$BRANCH" | grep -qiE 'RAW-[0-9]+'; then
  exit 0
fi

cat <<EOF
WARNING: The current branch "$BRANCH" does not contain a Linear ticket ID (e.g., RAW-5).

Branch naming convention requires: descriptive-branch-name-TICKET-NUMBER
Example: scaffold-example-nextjs-RAW-5

Before starting any implementation work, suggest renaming the branch to include the ticket ID.
Use: git branch -m <new-branch-name>

If no ticket exists yet, ask the user for the ticket number.
EOF

exit 0
