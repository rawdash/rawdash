# Linear Ticket Policy

## Overview

All pull requests require a Linear ticket reference. This ensures every change is traceable to an authorized business requirement.

## Where to Include the Ticket ID

A Linear ticket ID (format: `RAW-###`) must appear in **at least one** of:

1. **Branch name** (recommended): `RAW-5-scaffold-example-nextjs`
2. **PR title**: `[RAW-5] Scaffold example Next.js dashboard app`
3. **PR description**: `Relates to: RAW-5`

### Branch Name Examples

```text
RAW-5-scaffold-example-nextjs
feature-RAW-123-new-feature
bugfix-RAW-456
```

### PR Title Examples

```text
[RAW-5] Scaffold example Next.js dashboard app
Fix sync bug (RAW-456)
RAW-789 Update dependencies
```

## Exemptions

### Automated Dependencies

- Dependabot PRs are automatically exempted

### Emergency Hotfixes

For urgent production fixes without a pre-existing ticket:

1. Use `hotfix` in your branch name:
   - `hotfix-fix-auth-bug`
   - `fix-auth-bug-hotfix`
2. The `hotfix` label will be automatically applied
3. Document the incident and reason in the PR description
4. Create a Linear ticket retroactively and reference it in the PR

## How It Works

### Automatic Validation

- **On PR**: Validation runs when you open or update a pull request
- **Checks**: Branch name, PR title, and PR description for `RAW-###` pattern
- **Result**: Red ❌ status if ticket is missing, green ✅ if found

### What Happens If Validation Fails

If no ticket ID is found:

1. Your PR will be blocked from merging
2. Add a ticket ID to the PR title or description to fix it

**To fix (easiest):**

Edit your PR title or description to include the ticket ID (e.g., `RAW-123`).

**To fix (if you prefer branch name):**

```bash
git checkout -b RAW-123-your-feature
git cherry-pick <your-commits>
git push origin RAW-123-your-feature
```

## Questions?

- **Why do we need this?** To maintain traceability from code changes to business requirements
- **Can I bypass it?** Only for emergency hotfixes using the `hotfix` keyword in branch name
- **What if I forgot?** Just add the ticket ID to your PR title or description
- **Pre-existing branches?** Add the ticket ID to the PR title or description
