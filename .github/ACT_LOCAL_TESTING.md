# Local Testing with `act`

This guide covers how to test GitHub Actions workflows locally using [`act`](https://github.com/nektos/act) and other debugging tools. Running workflows locally speeds up development and helps catch issues before pushing to GitHub.

## Table of Contents

1. [What is `act`?](#what-is-act)
2. [Installation](#installation)
3. [Docker Requirements](#docker-requirements)
4. [Basic Usage](#basic-usage)
5. [Running This Project's Workflows](#running-this-projects-workflows)
6. [Environment Differences](#environment-differences)
7. [Limitations](#limitations)
8. [Alternative Tools](#alternative-tools)
9. [Troubleshooting](#troubleshooting)

---

## What is `act`?

`act` is a tool that runs your GitHub Actions workflows locally. It:

- Uses Docker to simulate GitHub's runner environments
- Parses your workflow YAML files
- Executes jobs and steps as they would run on GitHub
- Provides fast feedback without pushing to GitHub

**Benefits:**
- Faster iteration during workflow development
- Catch syntax errors before pushing
- Debug locally with full access to the environment
- Reduce wasted CI minutes from failed runs

---

## Installation

### macOS

```bash
# Using Homebrew (recommended)
brew install act

# Using MacPorts
sudo port install act
```

### Linux

```bash
# Using curl (recommended)
curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Debian/Ubuntu (via apt repository)
# First, add the repository, then:
sudo apt install act

# Arch Linux
pacman -S act

# Nix
nix-env -iA nixpkgs.act
```

### Windows

```powershell
# Using Chocolatey
choco install act-cli

# Using Scoop
scoop install act

# Using WinGet
winget install nektos.act
```

### Any Platform (Go)

```bash
# Requires Go 1.18+
go install github.com/nektos/act@latest
```

### Verify Installation

```bash
act --version
# Output: act version 0.2.x
```

---

## Docker Requirements

`act` requires Docker to run workflows. Here's how to set it up by platform:

### macOS

| Option | Description |
|--------|-------------|
| **Docker Desktop** | Official Docker app. Requires license for enterprise use. |
| **Colima** | Free, lightweight alternative. `brew install colima && colima start` |
| **Podman** | Docker-compatible alternative. `brew install podman && podman machine init && podman machine start` |

**Colima Setup:**
```bash
brew install colima docker
colima start
# act will automatically detect the Docker socket
```

### Linux

```bash
# Install Docker Engine (Debian/Ubuntu)
sudo apt-get update
sudo apt-get install docker.io

# Add your user to the docker group (avoids sudo)
sudo usermod -aG docker $USER
# Log out and back in for this to take effect

# Verify Docker is running
docker run hello-world
```

### Windows

| Option | Description |
|--------|-------------|
| **Docker Desktop** | Install Docker Desktop with WSL2 backend enabled |
| **WSL2 + Linux Docker** | Install Docker inside WSL2 Linux distribution |

**WSL2 Setup:**
1. Enable WSL2 and install a Linux distribution
2. Install Docker Desktop with WSL2 integration, OR
3. Install Docker directly in WSL2:
   ```bash
   # Inside WSL2
   sudo apt-get update
   sudo apt-get install docker.io
   sudo service docker start
   ```

---

## Basic Usage

### List Available Workflows and Jobs

```bash
# List all workflows and their jobs
act -l

# Example output:
# Stage  Job ID              Job name            Workflow name            Workflow file         Events
# 0      test                test                Run Tests                test.yml              push,pull_request
# 0      test                test                Node CI                  nodejs.yml            push,pull_request
# 1      report-build-status report-build-status Node CI                  nodejs.yml            push,pull_request
```

### Run Workflows

```bash
# Run all workflows triggered by 'push' event
act push

# Run all workflows triggered by 'pull_request' event
act pull_request

# Run a specific workflow file
act push -W .github/workflows/test.yml

# Run a specific job
act push -j test

# Run with a specific workflow AND job
act push -W .github/workflows/nodejs.yml -j test
```

### Simulating Events

```bash
# Push event (default)
act push

# Pull request event
act pull_request

# Workflow dispatch (manual trigger)
act workflow_dispatch

# With event payload (JSON file)
act push -e event.json
```

**Example event.json for pull_request:**
```json
{
  "pull_request": {
    "number": 1,
    "head": {
      "ref": "feature-branch"
    },
    "base": {
      "ref": "main"
    }
  }
}
```

### Working with Secrets

```bash
# Pass a single secret
act push -s MY_SECRET=value

# Use a secrets file
act push --secret-file .secrets

# Read secret from environment variable
export MY_SECRET=value
act push -s MY_SECRET
```

**`.secrets` file format:**
```
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
MY_API_KEY=your-api-key
SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----"
```

**Important:** Add `.secrets` to `.gitignore`!

### Using Different Runner Images

`act` uses smaller Docker images by default. For closer GitHub parity:

```bash
# Use a more complete Ubuntu image
act push -P ubuntu-latest=catthehacker/ubuntu:act-latest

# Use the full GitHub runner image (very large, ~18GB)
act push -P ubuntu-latest=catthehacker/ubuntu:full-latest

# For Node.js projects, the medium image usually suffices
act push -P ubuntu-latest=catthehacker/ubuntu:act-22.04
```

**Image sizes:**
| Image | Size | Contents |
|-------|------|----------|
| `node:16-buster-slim` (default) | ~200MB | Minimal, Node only |
| `catthehacker/ubuntu:act-latest` | ~500MB | Common tools (git, curl, etc.) |
| `catthehacker/ubuntu:full-latest` | ~18GB | Full GitHub runner parity |

### Verbose Output

```bash
# Standard verbose
act push -v

# Extra verbose (shows Docker commands)
act push -vv
```

---

## Running This Project's Workflows

### test.yml (Simplest)

```bash
# Run the test workflow
act push -W .github/workflows/test.yml

# Note: Requires Node.js setup, which act handles via actions/setup-node
```

### nodejs.yml (Matrix Strategy)

```bash
# Run all matrix combinations (Node 20 and 22)
act push -W .github/workflows/nodejs.yml

# Note: act runs matrix jobs sequentially by default
# The report-build-status job will run after all test jobs complete
```

### deploy.yml (Conditional Steps)

```bash
# Simulate a push event - conditional steps will evaluate
act push -W .github/workflows/deploy.yml

# Note: GitHub Pages deployment steps will be skipped locally
# The build steps will still run and verify the build works
```

### docker-build.yml (Requires Docker-in-Docker)

```bash
# This workflow builds Docker images inside Docker
# Requires privileged mode or Docker-in-Docker support

# May require:
act push -W .github/workflows/docker-build.yml --privileged

# Or use bind-mounted Docker socket:
act push -W .github/workflows/docker-build.yml \
  --container-options="-v /var/run/docker.sock:/var/run/docker.sock"
```

### deploy-ssh.yml (Secrets Required)

```bash
# This workflow requires secrets that aren't available locally
# Create a .secrets file first:
#   SSH_DEPLOY_HOST=your-host
#   SSH_DEPLOY_USER=your-user
#   SSH_DEPLOY_KEY="-----BEGIN..."
#   SSH_DEPLOY_PATH=/path/to/deploy
#   SATVIS_BASE_PATH=/base

act push -W .github/workflows/deploy-ssh.yml --secret-file .secrets

# Note: The actual SSH connection will attempt to connect
# to the real server, so use a test server or mock the steps
```

---

## Environment Differences

### Comparison: GitHub Runners vs `act`

| Aspect | GitHub Runners | `act` |
|--------|---------------|-------|
| **Architecture** | x86_64 | Depends on Docker host |
| **Runner images** | Full Ubuntu + tools (~25GB) | Smaller images by default |
| **GITHUB_TOKEN** | Auto-provided | Must provide manually |
| **Secrets** | Encrypted at rest | `.secrets` file or `-s` flag |
| **Caching** | GitHub's cache service | Local simulation only |
| **Artifacts** | GitHub artifact storage | Local `.act/` directory |
| **Services** | Full Docker support | Partial support |
| **Environment protection** | Enforced | Skipped |
| **OIDC tokens** | Supported | Not supported |

### What Works Well in `act`

- `actions/checkout`
- `actions/setup-node` (and other setup-* actions)
- Shell commands (`run:`)
- Environment variables
- Matrix strategies
- Job dependencies
- Conditional execution (`if:`)
- `actions/upload-artifact` / `download-artifact`

### What Doesn't Work or Works Differently

| Feature | Status | Notes |
|---------|--------|-------|
| `actions/cache` | Partial | Creates local cache, not shared |
| `actions/deploy-pages` | No | GitHub-specific, skip with `if: ${{ !env.ACT }}` |
| GitHub Pages deployment | No | Test the build, not the deployment |
| GHCR push | Yes | Need real PAT token |
| OIDC tokens | No | Use static credentials instead |
| `github.token` permissions | No | All permissions granted locally |
| Environment protection | No | Protection rules skipped |

### Detecting Local Execution

`act` sets the `ACT` environment variable. Use it to skip unsupported features:

```yaml
- name: Deploy to GitHub Pages
  if: ${{ !env.ACT }}  # Skip when running locally
  uses: actions/deploy-pages@v4
```

---

## Limitations

### 1. Caching

GitHub's caching service isn't available locally. `actions/cache` creates a local cache but doesn't provide the same speed benefits.

**Workaround:** Pre-populate `node_modules` before running:
```bash
npm ci
act push -W .github/workflows/test.yml
```

### 2. Secrets

No access to repository or environment secrets.

**Workaround:** Use `.secrets` file or environment variables.

### 3. Services (docker-compose style)

Limited support for job-level `services:`.

**Workaround:** Start services manually before running act:
```bash
docker run -d --name postgres -e POSTGRES_PASSWORD=secret postgres:15
act push -W .github/workflows/test-with-db.yml
docker stop postgres
```

### 4. GitHub-Specific Features

- GitHub Pages deployment
- OIDC tokens for cloud authentication
- GitHub Packages authentication (need PAT)
- Check runs API
- Deployment environments with protection rules

### 5. Performance

Running in Docker adds overhead. Large images take time to download on first run.

**Tips:**
- Use smaller images for faster iteration
- Pre-pull images: `docker pull catthehacker/ubuntu:act-latest`
- Use `--reuse` to keep containers between runs

---

## Alternative Tools

### actionlint (Static Analysis)

Catches workflow syntax errors without running anything.

```bash
# Install
brew install actionlint  # macOS
go install github.com/rhysd/actionlint/cmd/actionlint@latest  # Go

# Run on all workflows
actionlint

# Run on specific file
actionlint .github/workflows/test.yml

# Example output:
# .github/workflows/test.yml:15:7: unknown event "pussh"
# .github/workflows/test.yml:23:9: "actions/checkout@v4" expects "repository" input
```

**What it catches:**
- Invalid YAML syntax
- Unknown or misspelled keys
- Invalid action inputs
- Expression syntax errors
- Shell script issues (via shellcheck)

### GitHub CLI (`gh`)

View and manage workflow runs from the command line.

```bash
# List recent runs
gh run list

# View a specific run
gh run view 12345

# Watch a run in progress
gh run watch

# Re-run a failed workflow
gh run rerun 12345

# Trigger workflow dispatch
gh workflow run test.yml -f environment=staging
```

### VS Code Extension

The [GitHub Actions extension](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-github-actions) provides:

- Syntax highlighting for workflow files
- IntelliSense for action inputs
- Workflow validation
- Run logs viewer

---

## Troubleshooting

### "Docker not running"

```
Error: Cannot connect to the Docker daemon
```

**Solutions:**
- Start Docker Desktop / Colima / Podman
- Check socket: `docker ps`
- On Linux: `sudo systemctl start docker`

### "Image not found"

```
Error: Error response from daemon: pull access denied
```

**Solutions:**
- Ensure you have internet access
- Try a different image: `act push -P ubuntu-latest=node:20`
- Pull manually: `docker pull catthehacker/ubuntu:act-latest`

### "Action not found"

```
Error: Unable to resolve action `some-action@v1`
```

**Solutions:**
- Check action name spelling
- Ensure you have network access
- Try with `-v` for verbose output

### "Secret not set"

```
Error: Input required and not supplied: token
```

**Solutions:**
- Create `.secrets` file
- Pass secret via `-s`: `act push -s GITHUB_TOKEN=ghp_xxx`
- Check secret name matches workflow exactly

### "Permission denied"

```
Error: permission denied while trying to connect to Docker
```

**Solutions:**
- Add user to docker group: `sudo usermod -aG docker $USER`
- Log out and back in
- Or use sudo: `sudo act push`

### "Out of disk space"

```
Error: no space left on device
```

**Solutions:**
- Clean Docker: `docker system prune -a`
- Use smaller images
- Check available disk space

---

## Quick Reference

```bash
# List workflows
act -l

# Run push event
act push

# Run specific workflow
act push -W .github/workflows/test.yml

# Run specific job
act push -j test

# With secrets file
act push --secret-file .secrets

# With better runner image
act push -P ubuntu-latest=catthehacker/ubuntu:act-latest

# Verbose output
act push -v

# Dry run (show what would run)
act push -n

# Keep containers for faster reruns
act push --reuse
```

---

## Resources

- [act GitHub Repository](https://github.com/nektos/act)
- [act Documentation](https://nektosact.com/)
- [actionlint](https://github.com/rhysd/actionlint)
- [GitHub CLI](https://cli.github.com/)
- [catthehacker runner images](https://github.com/catthehacker/docker_images)
