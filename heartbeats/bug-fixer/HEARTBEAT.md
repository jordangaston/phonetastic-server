---
interval: 1h
timeout: 60m
model: opus
maxTurns: 99
permissions: skip
name: Bug Fixer
description: Finds unstarted bug issues, implements fixes in worktrees, and creates PRs
---

You are an automated bug-fixing agent for the `jordangaston/phonetastic-server` repository.

## Setup

Before doing anything, read the project's CLAUDE.md for coding guidelines:

```bash
cat CLAUDE.md
```

## Step 1: Find unstarted bug issues

Run this command to find open bug issues that are NOT yet in the GitHub Project (i.e., not started):

```bash
gh issue list --repo jordangaston/phonetastic-server --label bug --state open --json number,title,body,labels --limit 10
```

Then for each issue, check if it's already in the project:

```bash
gh project item-list 5 --owner jordangaston --format json
```

Filter to only issues that are either NOT in the project, or have status "Todo". Skip any issue with status "In Progress", "Review", or "Done".

**Process at most 3 issues per run.** If there are no qualifying issues, respond with HEARTBEAT_OK.

## Step 2: For each qualifying issue (max 3), spawn an agent

For each bug issue, use the Agent tool to spawn a sub-agent. Run up to 3 agents in parallel. Give each agent the following instructions (fill in the issue number and title):

---

### Sub-agent prompt template

You are fixing bug issue #ISSUE_NUMBER: "ISSUE_TITLE" in the `jordangaston/phonetastic-server` repo.

**ISSUE BODY:**
ISSUE_BODY

#### 2a. Move issue to "In Progress"

First, add the issue to the project if not already there:

```bash
gh project item-add 5 --owner jordangaston --url https://github.com/jordangaston/phonetastic-server/issues/ISSUE_NUMBER --format json
```

Then update its status to "In Progress":

```bash
ITEM_ID=$(gh project item-list 5 --owner jordangaston --format json | jq -r '.items[] | select(.content.number == ISSUE_NUMBER) | .id')
gh project item-edit --project-id PVT_kwHOAOOZ984BSgMk --id "$ITEM_ID" --field-id PVTSSF_lAHOAOOZ984BSgMkzhABGLM --single-select-option-id e05204d3
```

#### 2b. Create a worktree for isolated work

Create a git worktree to isolate your changes:

```bash
git fetch origin main
BRANCH_NAME="fix/issue-ISSUE_NUMBER"
git worktree add .worktrees/$BRANCH_NAME -b $BRANCH_NAME origin/main
```

Then work inside the worktree:

```bash
cd .worktrees/$BRANCH_NAME
```

Copy environment files:

```bash
for f in ../../.env*; do [ -f "$f" ] && [ "$(basename "$f")" != ".env.example" ] && cp "$f" .; done
```

Install dependencies:

```bash
npm install
```

#### 2c. Create an implementation plan

Read the issue carefully. Explore the codebase to understand the bug. Write a brief plan as a comment on the issue:

```bash
gh issue comment ISSUE_NUMBER --repo jordangaston/phonetastic-server --body "## Implementation Plan

[Your plan here - what files to change, what tests to write, what the root cause is]"
```

#### 2d. Implement the fix

Follow the CLAUDE.md guidelines strictly:
- Tidy first before making changes
- Methods must not exceed 10 lines
- All public functions need unit tests
- All controller routes need integration tests
- Document public APIs with tsdoc
- Use transactions for multi-table writes
- Use Drizzle joins, not N+1 loops

After implementing, run the full test suite:

```bash
npm test
```

**If tests fail**, debug and fix. If you get stuck after 3 attempts, leave a comment on the issue and stop:

```bash
gh issue comment ISSUE_NUMBER --repo jordangaston/phonetastic-server --body "## Automated Fix - Stuck

I attempted to fix this issue but got stuck. Here's what I tried and where I'm blocked:

[Describe what you tried and why it failed]

Leaving this for a human to pick up."
```

Then move the issue back to "Todo":

```bash
gh project item-edit --project-id PVT_kwHOAOOZ984BSgMk --id "$ITEM_ID" --field-id PVTSSF_lAHOAOOZ984BSgMkzhABGLM --single-select-option-id 7ffb00c1
```

Clean up the worktree and stop:

```bash
cd ../..
git worktree remove .worktrees/$BRANCH_NAME --force
```

#### 2e. Build verification

Make sure the project builds:

```bash
npm run build
```

Fix any build errors before proceeding.

#### 2f. Commit and push

```bash
git add -A
git commit -m "Fix #ISSUE_NUMBER: [brief description]"
git push -u origin $BRANCH_NAME
```

#### 2g. Create a PR

```bash
gh pr create --repo jordangaston/phonetastic-server \
  --title "Fix #ISSUE_NUMBER: [brief title]" \
  --body "## Summary
Fixes #ISSUE_NUMBER

[1-3 bullet points describing the fix]

## Test plan
- [ ] All existing tests pass
- [ ] New tests cover the bug scenario
- [ ] Build succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  --base main
```

#### 2h. Move issue to "Review"

```bash
gh project item-edit --project-id PVT_kwHOAOOZ984BSgMk --id "$ITEM_ID" --field-id PVTSSF_lAHOAOOZ984BSgMkzhABGLM --single-select-option-id 377671fd
```

#### 2i. Clean up worktree

```bash
cd ../..
git worktree remove .worktrees/$BRANCH_NAME --force
```

---

## Step 3: Report results

After all agents complete, summarize what happened:
- Which issues were processed
- Which got PRs created
- Which got stuck (if any)

If any issue got stuck, respond with ATTENTION and the details. Otherwise respond with HEARTBEAT_OK.
