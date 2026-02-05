# GitHub Actions Guide

This guide provides a comprehensive introduction to GitHub Actions using the workflows in this repository as examples. Whether you're new to CI/CD or looking to deepen your understanding, this guide covers the fundamentals and practical patterns.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Workflow Structure](#workflow-structure)
3. [Events and Triggers](#events-and-triggers)
4. [Jobs and Steps](#jobs-and-steps)
5. [Context and Expressions](#context-and-expressions)
6. [Secrets and Environment Variables](#secrets-and-environment-variables)
7. [GitHub Actions UI Walkthrough](#github-actions-ui-walkthrough)
8. [Workflow Patterns in This Project](#workflow-patterns-in-this-project)
9. [Common Debugging Techniques](#common-debugging-techniques)

---

## Core Concepts

### What is GitHub Actions?

GitHub Actions is GitHub's built-in CI/CD (Continuous Integration/Continuous Deployment) platform. It automates tasks in response to events in your repository.

**Key Terminology:**

| Term | Definition |
|------|------------|
| **Workflow** | An automated process defined in a YAML file. Lives in `.github/workflows/` |
| **Event** | Something that triggers a workflow (push, PR, schedule, manual) |
| **Job** | A set of steps that run on the same runner. Jobs run in parallel by default |
| **Step** | A single task within a job. Steps run sequentially |
| **Action** | A reusable unit of code. Format: `uses: owner/repo@version` |
| **Runner** | The virtual machine that executes your jobs |
| **Artifact** | Files produced during a workflow run (logs, builds, test results) |

### Workflow Files

Workflows are YAML files stored in `.github/workflows/`. Each file defines one workflow.

```yaml
# .github/workflows/example.yml
name: My Workflow          # Display name in GitHub UI
on: push                   # Trigger event
jobs:
  build:                   # Job ID
    runs-on: ubuntu-latest # Runner type
    steps:
      - uses: actions/checkout@v4  # Action
      - run: echo "Hello!"         # Shell command
```

---

## Workflow Structure

### Complete Anatomy of a Workflow

```yaml
# =============================================================================
# TOP-LEVEL KEYS (in recommended order)
# =============================================================================

name: Workflow Name              # Optional: Display name

on:                              # REQUIRED: Trigger events
  push:
    branches: [main]
  pull_request:

env:                             # Optional: Workflow-level environment variables
  NODE_VERSION: 20

jobs:                            # REQUIRED: At least one job
  my-build-job:                  # ← User-defined job ID (you choose this name)
    name: Display Name           # Optional: Job display name
    runs-on: ubuntu-latest       # REQUIRED: Runner type

    environment: production      # Optional: Deployment environment

    permissions:                 # Optional: GITHUB_TOKEN permissions
      contents: read

    env:                         # Optional: Job-level environment variables
      DEBUG: true

    strategy:                    # Optional: Matrix configuration
      matrix:
        node: [18, 20, 22]

    needs: [some-other-job]     # Optional: Job dependencies (references another job ID you defined)

    if: github.ref == 'refs/heads/main'  # Optional: Job condition

    steps:                       # REQUIRED: At least one step
      - name: Step Name          # Optional but recommended
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Command
        run: npm test
        env:                     # Optional: Step-level environment variables
          CI: true
```

---

## Events and Triggers

### Common Trigger Events

| Event | When it Fires | Use Case |
|-------|--------------|----------|
| `push` | Commits pushed to branch | CI testing, deployments |
| `pull_request` | PR opened, updated, or synchronized | PR validation |
| `workflow_dispatch` | Manual trigger from UI | On-demand deployments |
| `schedule` | Cron schedule | Nightly builds, data updates |
| `release` | Release created/published | Publishing packages |
| `workflow_run` | Another workflow completes | Chaining workflows |

### Trigger Filters

```yaml
on:
  push:
    branches:
      - main
      - 'releases/**'      # Glob pattern
    branches-ignore:
      - 'feature/**'       # Exclude pattern
    paths:
      - 'src/**'           # Only trigger for src/ changes
      - '!src/test/**'     # But not test files
    tags:
      - 'v*'               # Tag patterns

  pull_request:
    types: [opened, synchronize, reopened, labeled]
    branches:
      - main

  schedule:
    - cron: '0 0 * * *'    # Daily at midnight UTC

  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production
```

### Workflows in This Repository

| Workflow | Triggers | Description |
|----------|----------|-------------|
| `test.yml` | push, pull_request (all branches) | Run tests with coverage |
| `nodejs.yml` | push, pull_request (all branches) | Multi-version Node.js CI |
| `deploy.yml` | push, pull_request (master only) | GitHub Pages deployment |
| `docker-build.yml` | push (master), manual | Build Docker images |
| `deploy-ssh.yml` | push (production), manual | Production SSH deployment |

---

## Jobs and Steps

### Job Configuration

```yaml
jobs:
  build:
    runs-on: ubuntu-latest    # GitHub-hosted runner
    # runs-on: self-hosted    # Self-hosted runner
    # runs-on: [self-hosted, linux, x64]  # Labels

    timeout-minutes: 30       # Job timeout (default: 360)

    continue-on-error: true   # Don't fail workflow if this job fails

    concurrency:
      group: ${{ github.ref }}
      cancel-in-progress: true  # Cancel older runs on same branch
```

### Step Types

**1. Actions (uses:)**
```yaml
- uses: actions/checkout@v4        # GitHub action
- uses: docker/build-push-action@v5  # Third-party action
- uses: ./.github/actions/my-action  # Local action
```

**2. Shell Commands (run:)**
```yaml
- run: npm test                     # Single command
- run: |                            # Multi-line script
    npm ci
    npm test
    npm run build
- run: |                            # With shell specification
    Get-Process
  shell: pwsh                       # PowerShell Core
```

### Step Outputs

```yaml
- name: Set output
  id: my-step              # ← User-defined step ID (you choose this name)
  run: echo "version=1.0.0" >> $GITHUB_OUTPUT

- name: Use output
  # steps.<step-id>.outputs.<output-name>
  # 'my-step' = the id you defined above, 'version' = the output key you set
  run: echo "Version is ${{ steps.my-step.outputs.version }}"
```

### Conditional Steps

```yaml
- name: Always run
  if: always()
  run: cleanup.sh

- name: Only on failure
  if: failure()
  run: notify-failure.sh

- name: Only on main branch
  if: github.ref == 'refs/heads/main'
  run: deploy.sh

- name: Only for specific actor
  if: github.actor == 'dependabot[bot]'
  run: auto-merge.sh
```

---

## Context and Expressions

### Expression Syntax

Expressions use `${{ }}` syntax and are evaluated during workflow execution.

```yaml
- run: echo "SHA is ${{ github.sha }}"
- if: ${{ github.event_name == 'push' }}  # ${{ }} optional in 'if:'
- if: github.event_name == 'push'         # Same as above
```

### Common Contexts

| Context | Description | Example |
|---------|-------------|---------|
| `github` | Event information | `github.sha`, `github.ref`, `github.actor` |
| `env` | Environment variables | `env.NODE_VERSION` |
| `secrets` | Repository/environment secrets | `secrets.GITHUB_TOKEN` |
| `matrix` | Current matrix combination | `matrix.node-version` |
| `steps` | Step outputs and status | `steps.<step-id>.outputs.<name>` |
| `job` | Current job information | `job.status` |
| `runner` | Runner information | `runner.os`, `runner.arch` |
| `needs` | Dependent job outputs | `needs.<job-id>.outputs.<name>` |

### Useful `github` Context Properties

```yaml
github.event_name    # 'push', 'pull_request', 'workflow_dispatch', etc.
github.ref           # 'refs/heads/main', 'refs/tags/v1.0', 'refs/pull/123/merge'
github.ref_name      # 'main', 'v1.0', '123/merge' (short form)
github.sha           # Full commit SHA (40 chars)
github.actor         # Username who triggered the workflow
github.repository    # 'owner/repo'
github.repository_owner  # 'owner'
github.workspace     # Path to checked-out repo on runner
github.run_id        # Unique workflow run ID
github.run_number    # Incrementing run number for this workflow
```

### Expression Functions

```yaml
# String functions
contains(github.event.head_commit.message, '[skip ci]')
startsWith(github.ref, 'refs/tags/')
endsWith(github.repository, '-test')
format('Hello {0}!', github.actor)

# Comparison
github.event.pull_request.merged == true

# Status functions (for 'if:')
success()    # All previous steps succeeded
failure()    # Any previous step failed
always()     # Run regardless of status
cancelled()  # Workflow was cancelled
```

---

## Secrets and Environment Variables

### Environment Variable Hierarchy

```yaml
env:                              # 1. Workflow level
  GLOBAL_VAR: workflow

jobs:
  build:
    env:                          # 2. Job level
      JOB_VAR: job
    steps:
      - env:                      # 3. Step level (highest priority)
          STEP_VAR: step
        run: echo "$GLOBAL_VAR $JOB_VAR $STEP_VAR"
```

### Secrets

**Setting Secrets:**
- Repository: Settings → Secrets and variables → Actions
- Environment: Settings → Environments → [env] → Secrets
- Organization: Organization Settings → Secrets and variables → Actions

**Using Secrets:**
```yaml
- run: echo "${{ secrets.MY_SECRET }}"  # In expressions
- env:
    API_KEY: ${{ secrets.API_KEY }}     # As environment variable
  run: curl -H "Authorization: $API_KEY" https://api.example.com
```

**Built-in Secrets:**
- `GITHUB_TOKEN` - Automatically provided, scoped to the repository

### Security Best Practices

1. **Never log secrets** - GitHub masks them, but be careful with encoding
2. **Use environment-specific secrets** for production credentials
3. **Rotate secrets regularly** - Update if compromised
4. **Principle of least privilege** - Only grant necessary permissions

---

## GitHub Actions UI Walkthrough

### Actions Tab Navigation

1. **Actions Tab** - Click "Actions" in your repository navigation
2. **Workflow List** - Left sidebar shows all workflows in `.github/workflows/`
3. **Run History** - Each workflow shows recent runs with status

### Viewing a Workflow Run

1. **Summary Page**
   - Overall status (success/failure/in progress)
   - Triggered by (push, PR, manual)
   - Commit and branch information
   - Job visualization (shows parallel/sequential execution)

2. **Jobs Panel**
   - Click a job to see its steps
   - Each step shows:
     - Duration
     - Status (checkmark, X, or spinner)
     - Expandable logs

3. **Annotations**
   - Errors and warnings appear as annotations
   - Click to jump to the relevant log line

### Reading Logs

- **Expand steps** - Click the arrow next to any step
- **Search logs** - Use Ctrl/Cmd+F in the log view
- **Raw logs** - Click the gear icon → "View raw logs"
- **Download logs** - Gear icon → "Download log archive"

### Re-running Workflows

1. **Re-run all jobs** - Button at top right of run page
2. **Re-run failed jobs** - Only re-run jobs that failed
3. **Re-run with debug logging** - Enable verbose output

### Downloading Artifacts

1. Navigate to the workflow run
2. Scroll to "Artifacts" section at bottom
3. Click artifact name to download

### Manual Workflow Dispatch

1. Go to Actions tab
2. Select the workflow (must have `workflow_dispatch` trigger)
3. Click "Run workflow" button
4. Select branch and fill in any inputs
5. Click green "Run workflow" button

### Viewing Deployment Environments

1. Repository home → "Environments" in right sidebar
2. Or: Settings → Environments
3. See deployment history, protection rules, and secrets

---

## Workflow Patterns in This Project

### Pattern 1: CI Pipeline (test.yml, nodejs.yml)

```
Push/PR → Checkout → Setup → Install → Test → Report
```

- Runs on every push and PR
- Fast feedback loop
- Matrix testing for multiple versions

### Pattern 2: CD Pipeline with Conditional Deploy (deploy.yml)

```
Push/PR → Build → [if push to master] → Setup Pages → Deploy
```

- PRs: Build only (verify it works)
- Push to master: Build and deploy
- Uses `if:` conditions on steps

### Pattern 3: Docker Build & Push (docker-build.yml)

```
Push to master → Checkout → Login → Build Images → Push Images → Summary
```

- Only runs on master branch
- Tags with both `latest` and commit SHA
- Creates GitHub Step Summary

### Pattern 4: SSH Deployment (deploy-ssh.yml)

```
Push to production → Build → Update Data → Setup SSH → Deploy → Verify → Cleanup
```

- Uses GitHub Environments for protection
- SSH key management
- Backup and rollback support
- Always cleans up sensitive data

---

## Common Debugging Techniques

### 1. Enable Debug Logging

Add repository secret: `ACTIONS_STEP_DEBUG` = `true`

Or re-run with debug logging from the UI.

### 2. Add Debug Output

```yaml
- name: Debug
  run: |
    echo "Event: ${{ github.event_name }}"
    echo "Ref: ${{ github.ref }}"
    echo "SHA: ${{ github.sha }}"
    echo "::debug::This is a debug message"
```

### 3. Check Secret Availability

```yaml
- name: Check secrets
  run: |
    echo "Secret is set: ${{ secrets.MY_SECRET != '' }}"
    echo "Secret length: ${#MY_SECRET}"
  env:
    MY_SECRET: ${{ secrets.MY_SECRET }}
```

### 4. List Files for Debugging

```yaml
- name: Debug filesystem
  run: |
    pwd
    ls -la
    find . -name "*.yml" | head -20
```

### 5. Use Job Summaries

```yaml
- name: Create summary
  run: |
    echo "## Build Results" >> $GITHUB_STEP_SUMMARY
    echo "- Node: ${{ matrix.node-version }}" >> $GITHUB_STEP_SUMMARY
    echo "- Status: Success" >> $GITHUB_STEP_SUMMARY
```

### 6. Dump Contexts

```yaml
- name: Dump contexts
  env:
    GITHUB_CONTEXT: ${{ toJson(github) }}
  run: echo "$GITHUB_CONTEXT"
```

---

## Next Steps

1. **Read the annotated workflows** - Each `.yml` file has comprehensive inline comments
2. **Try local testing** - See [ACT_LOCAL_TESTING.md](./ACT_LOCAL_TESTING.md)
3. **Practice with exercises** - See [exercises/README.md](./exercises/README.md)
4. **Learn advanced topics** - See [ADVANCED_ACTIONS.md](./ADVANCED_ACTIONS.md)

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workflow Syntax Reference](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
- [Context and Expression Syntax](https://docs.github.com/en/actions/learn-github-actions/contexts)
- [GitHub Actions Marketplace](https://github.com/marketplace?type=actions)
