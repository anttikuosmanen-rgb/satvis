# Advanced GitHub Actions Topics

This guide covers advanced GitHub Actions concepts for when you're ready to go beyond the basics. These patterns help you create more maintainable, secure, and efficient workflows.

## Table of Contents

1. [Reusable Workflows](#reusable-workflows)
2. [Custom Actions](#custom-actions)
3. [Security Best Practices](#security-best-practices)
4. [Performance Optimization](#performance-optimization)
5. [Advanced Patterns](#advanced-patterns)
6. [Troubleshooting Complex Issues](#troubleshooting-complex-issues)

---

## Reusable Workflows

Reusable workflows allow you to define a workflow once and call it from other workflows. This reduces duplication and centralizes maintenance.

### Creating a Reusable Workflow

```yaml
# .github/workflows/reusable-build.yml
name: Reusable Build Workflow

# REQUIRED: workflow_call trigger makes this reusable
on:
  workflow_call:
    # Define inputs the caller can pass
    inputs:
      node-version:
        description: 'Node.js version to use'
        required: false
        type: string
        default: '20'

      run-tests:
        description: 'Whether to run tests'
        required: false
        type: boolean
        default: true

    # Define secrets the caller must provide
    secrets:
      NPM_TOKEN:
        description: 'NPM authentication token'
        required: false

    # Define outputs the caller can use
    outputs:
      artifact-name:                                    # ← User-defined output name
        description: 'Name of the uploaded artifact'
        # jobs.<job-id>.outputs.<output-name> - references the job output below
        value: ${{ jobs.build.outputs.artifact-name }}

jobs:
  build:                         # ← User-defined job ID (matches 'jobs.build' above)
    runs-on: ubuntu-latest
    outputs:
      artifact-name: ${{ steps.upload.outputs.name }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}

      - run: npm ci

      - name: Run tests
        if: ${{ inputs.run-tests }}
        run: npm test

      - run: npm run build

      - name: Upload artifact
        id: upload
        uses: actions/upload-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: dist/
```

### Calling a Reusable Workflow

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on: push

jobs:
  # Call a reusable workflow from the same repository
  build:
    uses: ./.github/workflows/reusable-build.yml
    with:
      node-version: '22'
      run-tests: true
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

  # Call a reusable workflow from another repository
  deploy:
    needs: build
    uses: my-org/shared-workflows/.github/workflows/deploy.yml@main
    with:
      environment: production
    secrets: inherit  # Pass all secrets to called workflow
```

### Reusable Workflow Best Practices

1. **Version your workflows** - Use tags or commit SHAs for stability
2. **Document inputs/outputs** - Add descriptions to all parameters
3. **Provide sensible defaults** - Make required inputs minimal
4. **Use `secrets: inherit`** cautiously - Only when workflow needs many secrets

---

## Custom Actions

You can create your own actions in three ways: Composite, JavaScript, and Docker.

### Composite Actions

Composite actions combine multiple steps into a reusable unit. Best for simple, shell-based operations.

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup Project'
description: 'Setup Node.js and install dependencies'

inputs:
  node-version:
    description: 'Node.js version'
    required: false
    default: '20'

outputs:
  cache-hit:                     # ← User-defined output name
    description: 'Whether the cache was hit'
    # steps.<step-id>.outputs.<name> - 'cache' is the step id defined below
    value: ${{ steps.cache.outputs.cache-hit }}

runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}

    - name: Cache node_modules
      id: cache                  # ← User-defined step ID (referenced above)
      uses: actions/cache@v4
      with:
        path: node_modules
        key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}

    - name: Install dependencies
      if: steps.cache.outputs.cache-hit != 'true'
      shell: bash
      run: npm ci
```

**Using the composite action:**

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: ./.github/actions/setup-project
    with:
      node-version: '22'
```

### JavaScript Actions

JavaScript actions run directly on the runner. Best for complex logic or API interactions.

```javascript
// .github/actions/greet/index.js
const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    const name = core.getInput('name', { required: true });
    const token = core.getInput('github-token', { required: true });

    core.info(`Hello, ${name}!`);

    // Use GitHub API
    const octokit = github.getOctokit(token);
    const { data: user } = await octokit.rest.users.getAuthenticated();

    core.setOutput('user-id', user.id);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
```

```yaml
# .github/actions/greet/action.yml
name: 'Greet User'
description: 'Greet a user and return their ID'

inputs:
  name:
    description: 'Name to greet'
    required: true
  github-token:
    description: 'GitHub token for API calls'
    required: true

outputs:
  user-id:
    description: 'The authenticated user ID'

runs:
  using: 'node20'
  main: 'index.js'
```

### Docker Actions

Docker actions run in a container. Best for complex environments or non-JavaScript tools.

```dockerfile
# .github/actions/security-scan/Dockerfile
FROM python:3.11-slim

COPY requirements.txt /requirements.txt
RUN pip install -r /requirements.txt

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

```yaml
# .github/actions/security-scan/action.yml
name: 'Security Scan'
description: 'Run security scanning tools'

inputs:
  scan-path:
    description: 'Path to scan'
    required: false
    default: '.'

runs:
  using: 'docker'
  image: 'Dockerfile'
  args:
    - ${{ inputs.scan-path }}
```

---

## Security Best Practices

### 1. Principle of Least Privilege

Always declare minimal permissions:

```yaml
# Workflow-level (applies to all jobs)
permissions:
  contents: read

jobs:
  deploy:
    permissions:
      contents: read
      pages: write      # Only this job needs pages write
      id-token: write
```

### 2. Pin Action Versions

```yaml
# GOOD: Pinned to commit SHA (most secure)
uses: actions/checkout@8ade135a41bc03ea155e62e844d188df1ea18608

# ACCEPTABLE: Pinned to major version
uses: actions/checkout@v4

# RISKY: Using 'latest' or branch names
uses: some-action/action@main  # Could change unexpectedly
```

### 3. Secret Handling

```yaml
# NEVER log secrets (even masked, they can be decoded)
- run: echo "${{ secrets.MY_SECRET }}"  # DON'T DO THIS

# GOOD: Pass as environment variable
- env:
    MY_SECRET: ${{ secrets.MY_SECRET }}
  run: ./script.sh  # Script uses $MY_SECRET

# GOOD: Use dedicated actions for secret handling
- uses: hashicorp/vault-action@v2
  with:
    secrets: |
      secret/data/api token | API_TOKEN
```

### 4. Protect Against Script Injection

```yaml
# VULNERABLE: Untrusted input in shell
- run: echo "Title: ${{ github.event.pull_request.title }}"

# SAFE: Use environment variable (properly escaped)
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "Title: $PR_TITLE"
```

### 5. Fork PR Security

PRs from forks don't have access to secrets by default. Be careful with:

```yaml
# Dangerous: Running untrusted PR code with secrets
on:
  pull_request_target:  # Has write access and secrets!

# Safer patterns for fork PRs:
on:
  pull_request:  # No write access, no secrets from forks

# Or use conditional access:
- if: github.event.pull_request.head.repo.full_name == github.repository
  env:
    SECRET: ${{ secrets.MY_SECRET }}
  run: ./deploy.sh
```

### 6. Third-Party Action Auditing

Before using a third-party action:

1. **Review the source code** - Check what it does
2. **Check popularity** - Stars, forks, issues
3. **Review permissions** - What does it need access to?
4. **Pin to SHA** - Prevent supply chain attacks
5. **Use Dependabot** - Keep actions updated

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### 7. OIDC for Cloud Authentication

Use OIDC instead of long-lived credentials:

```yaml
# AWS example
jobs:
  deploy:
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/GitHubActionsRole
          aws-region: us-east-1
          # No AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY needed!

      - run: aws s3 sync ./dist s3://my-bucket
```

---

## Performance Optimization

### 1. Caching Strategies

```yaml
# Cache node_modules
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-

# Cache multiple directories
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      node_modules
      ~/.cache/Cypress
    key: ${{ runner.os }}-deps-${{ hashFiles('**/package-lock.json') }}

# Cache Docker layers
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

### 2. Parallel Execution

```yaml
jobs:
  # These run in parallel
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test

  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build

  # This waits for all above
  deploy:
    needs: [lint, test, build]
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
```

### 3. Conditional Job Execution

```yaml
jobs:
  changes:                       # ← User-defined job ID
    runs-on: ubuntu-latest
    outputs:
      frontend: ${{ steps.filter.outputs.frontend }}
      backend: ${{ steps.filter.outputs.backend }}
    steps:
      - uses: dorny/paths-filter@v2
        id: filter               # ← User-defined step ID
        with:
          filters: |
            frontend:
              - 'src/frontend/**'
            backend:
              - 'src/backend/**'

  frontend-tests:                # ← User-defined job ID
    needs: changes               # References 'changes' job above
    if: needs.changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: npm test -- --scope=frontend

  backend-tests:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: npm test -- --scope=backend
```

### 4. Artifact Management

```yaml
# Upload artifacts for later jobs
- uses: actions/upload-artifact@v4
  with:
    name: build
    path: dist/
    retention-days: 7  # Clean up after 7 days

# Download in another job
- uses: actions/download-artifact@v4
  with:
    name: build
    path: dist/
```

### 5. Concurrency Control

```yaml
# Cancel in-progress runs for the same branch
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

# Or per environment
concurrency:
  group: deploy-${{ github.event.inputs.environment }}
  cancel-in-progress: false  # Don't cancel deployments
```

### 6. Matrix Optimization

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
    node: [18, 20, 22]
    exclude:
      - os: windows-latest
        node: 18  # Skip Node 18 on Windows
    include:
      - os: ubuntu-latest
        node: 22
        experimental: true  # Extra testing on latest

  fail-fast: false  # Don't cancel other jobs on failure
  max-parallel: 4   # Limit concurrent jobs
```

---

## Advanced Patterns

### 1. Dynamic Matrix

```yaml
jobs:
  prepare:                       # ← User-defined job ID
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - id: set-matrix           # ← User-defined step ID
        run: |
          echo "matrix={\"include\":[{\"project\":\"api\"},{\"project\":\"web\"}]}" >> $GITHUB_OUTPUT

  build:
    needs: prepare               # References the 'prepare' job ID above
    strategy:
      # needs.<job-id>.outputs.<output-name>
      matrix: ${{ fromJson(needs.prepare.outputs.matrix) }}
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building ${{ matrix.project }}"
```

### 2. Workflow Chaining

```yaml
# .github/workflows/build.yml
on: push
jobs:
  build:
    # ... build steps ...

# .github/workflows/deploy.yml
on:
  workflow_run:
    workflows: ["Build"]  # Name of the build workflow
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
```

### 3. Manual Approval Gates

```yaml
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: ./deploy.sh staging

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment:
      name: production
      # Production environment has required reviewers configured
    steps:
      - run: ./deploy.sh production
```

### 4. Monorepo Workflows

```yaml
on:
  push:
    paths:
      - 'packages/api/**'
      - 'packages/shared/**'  # Shared deps trigger api

jobs:
  api:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/api
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

### 5. Status Checks API

```yaml
- name: Set commit status
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.repos.createCommitStatus({
        owner: context.repo.owner,
        repo: context.repo.repo,
        sha: context.sha,
        state: 'success',
        context: 'custom/check',
        description: 'All checks passed'
      })
```

---

## Troubleshooting Complex Issues

### 1. Debug Mode

```yaml
# Enable debug logging for a specific run
# Set secret: ACTIONS_STEP_DEBUG = true

# Or dump context in workflow
- name: Dump contexts
  run: |
    echo '${{ toJson(github) }}'
    echo '${{ toJson(job) }}'
    echo '${{ toJson(steps) }}'
```

### 2. Common Expression Errors

```yaml
# WRONG: Missing quotes in complex conditions
if: github.ref == refs/heads/main  # Syntax error!

# CORRECT: Quote string literals
if: github.ref == 'refs/heads/main'

# WRONG: Incorrect property access
if: ${{ github.event.pull_request.labels.name == 'urgent' }}

# CORRECT: Use contains for arrays
if: contains(github.event.pull_request.labels.*.name, 'urgent')
```

### 3. Path Filtering Gotchas

```yaml
on:
  push:
    paths:
      - '**.js'  # This doesn't match .github/workflows/*.yml!

# If you want to always run on workflow changes:
on:
  push:
    paths:
      - '**.js'
      - '.github/workflows/**'
```

### 4. Matrix and Needs Interaction

```yaml
jobs:
  test:
    strategy:
      matrix:
        version: [18, 20, 22]
    # ... runs 3 times

  deploy:
    needs: test
    # This waits for ALL 3 matrix jobs to complete
    # If any matrix job fails, this job is skipped
```

### 5. Timeout Issues

```yaml
jobs:
  build:
    timeout-minutes: 30  # Job timeout

    steps:
      - name: Long running task
        timeout-minutes: 10  # Step timeout
        run: ./long-script.sh
```

### 6. Rate Limiting

```yaml
# Avoid GitHub API rate limits
- uses: actions/github-script@v7
  with:
    script: |
      // Built-in retries and rate limit handling
      const { data } = await github.rest.repos.get({
        owner: context.repo.owner,
        repo: context.repo.repo
      });
```

---

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Reusable Workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [Creating Custom Actions](https://docs.github.com/en/actions/creating-actions)
- [Security Hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [OpenID Connect](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [Workflow Commands](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions)
