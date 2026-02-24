# Jenkins Replay-Like Behavior in GitHub Actions

This guide shows how to achieve Jenkins Replay-like functionality with GitHub Actions and self-hosted runners.

## Understanding the Limitation

**Jenkins Replay:** Edit the Groovy pipeline script directly in the UI and re-run.

**GitHub Actions:** Workflow YAML must come from git repository (even with self-hosted runners).

**Solution:** Create workflows that accept arbitrary commands as inputs.

---

## Option 1: Simple Ad-Hoc Commands (Best for Quick Tests)

### Using the Debug Runner Workflow

1. Go to: https://github.com/anttikuosmanen-rgb/satvis/actions/workflows/debug-runner.yml
2. Click **"Run workflow"**
3. Paste your commands in the `custom_commands` field:

```bash
# Example: Debug Docker setup
docker images
docker ps
echo "Checking GHCR access..."
docker pull ghcr.io/anttikuosmanen-rgb/satvis/web:latest
docker inspect ghcr.io/anttikuosmanen-rgb/satvis/web:latest | jq '.[0].Config.Labels'
```

4. Check **"Use self-hosted runner"** if you need access to private resources
5. Click **"Run workflow"**

### Via GitHub CLI

```bash
# Run custom commands
gh workflow run debug-runner.yml \
  -f custom_commands="docker images && docker ps && env | sort" \
  -f use_self_hosted=true

# Watch the run
gh run watch
```

---

## Option 2: Remote Script Execution (Best for Iteration)

Edit scripts externally, then execute without committing to repo.

### Using GitHub Gists

1. Create a gist: https://gist.github.com
2. Name: `debug-satvis.sh`
3. Content:
```bash
#!/bin/bash
set -e

echo "=== Custom Debug Script ==="
echo "Running on: $(hostname)"
echo "User: $(whoami)"

# Check deployment
kubectl get pods -n satvis || echo "No kubectl access"

# Check Docker images
docker images | grep satvis

# Test something specific
npm test -- --grep "pre-launch"
```

4. Click **"Create public gist"** (or secret gist)
5. Click **"Raw"** button to get direct URL
6. Run workflow with script URL:

```bash
gh workflow run debug-runner.yml \
  -f script_url="https://gist.githubusercontent.com/anttikuosmanen/abc123/raw/debug-satvis.sh" \
  -f use_self_hosted=true
```

### Iteration Workflow

```bash
# 1. Edit gist in browser
# 2. Re-run workflow (uses latest version)
gh workflow run debug-runner.yml \
  -f script_url="https://gist.githubusercontent.com/.../debug.sh"

# 3. Edit gist again
# 4. Re-run again (instant iteration!)
```

**Key advantage:** Edit script → re-run → edit → re-run (no git commits!)

---

## Option 3: Pre-Defined Scenarios (Best for Common Tasks)

Use built-in debug scenarios:

```bash
# Full system diagnostic
gh workflow run debug-runner.yml -f debug_scenario="full-diagnostic"

# Check Docker
gh workflow run debug-runner.yml -f debug_scenario="check-docker"

# Test deployment prerequisites
gh workflow run debug-runner.yml -f debug_scenario="test-deployment"

# Inspect environment
gh workflow run debug-runner.yml -f debug_scenario="inspect-environment"
```

Add your own scenarios by editing `.github/workflows/debug-runner.yml`.

---

## Option 4: Hybrid Jenkins + GitHub Actions

Run GitHub Actions workflows from Jenkins for best of both worlds.

### Setup Jenkins Job

```groovy
pipeline {
  agent any
  parameters {
    string(name: 'WORKFLOW', defaultValue: 'deploy.yml', description: 'Workflow to run')
    text(name: 'COMMANDS', defaultValue: '', description: 'Custom commands')
  }
  stages {
    stage('Trigger GitHub Actions') {
      steps {
        script {
          // Trigger GitHub Actions workflow
          sh """
            gh workflow run ${params.WORKFLOW} \
              -f custom_commands="${params.COMMANDS}" \
              -f use_self_hosted=true
          """

          // Wait for completion
          sh "gh run watch"
        }
      }
    }
  }
}
```

**Now in Jenkins:**
- Click **"Build with Parameters"**
- Edit the COMMANDS field (Jenkins Replay UX)
- Jenkins triggers GitHub Actions with your commands
- Best of both worlds!

---

## Complete Setup Guide

### Step 1: Set Up Self-Hosted Runner

Choose one:

**Option A: Kubernetes (Recommended)**
```bash
# Install actions-runner-controller
helm repo add actions-runner-controller \
  https://actions-runner-controller.github.io/actions-runner-controller

helm upgrade --install --namespace actions-runner-system \
  --create-namespace --wait actions-runner-controller \
  actions-runner-controller/actions-runner-controller

# Create runner deployment
kubectl apply -f - <<EOF
apiVersion: actions.summerwind.dev/v1alpha1
kind: RunnerDeployment
metadata:
  name: satvis-runners
  namespace: satvis
spec:
  replicas: 2
  template:
    spec:
      repository: anttikuosmanen-rgb/satvis
      labels: [self-hosted, linux]
EOF
```

**Option B: Docker Compose (Simpler)**
```bash
cat > docker-compose-runner.yml <<EOF
version: '3'
services:
  runner:
    image: myoung34/github-runner:latest
    environment:
      REPO_URL: https://github.com/anttikuosmanen-rgb/satvis
      ACCESS_TOKEN: \${GITHUB_PAT}
      RUNNER_NAME: satvis-runner
      LABELS: self-hosted,docker
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
EOF

GITHUB_PAT=ghp_your_token docker-compose -f docker-compose-runner.yml up -d
```

**Option C: Manual on VM**
```bash
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
tar xzf ./actions-runner-linux-x64.tar.gz
./config.sh --url https://github.com/anttikuosmanen-rgb/satvis --token YOUR_TOKEN
sudo ./svc.sh install
sudo ./svc.sh start
```

### Step 2: Verify Runner

```bash
# Check runner status
gh api /repos/anttikuosmanen-rgb/satvis/actions/runners | jq '.runners[] | {id, name, status, labels}'
```

Should show your self-hosted runner as "online".

### Step 3: Commit the Debug Workflow

```bash
git add .github/workflows/debug-runner.yml
git commit -m "feat: Add debug runner with replay-like capabilities"
git push
```

### Step 4: Test It

```bash
# Run a simple test
gh workflow run debug-runner.yml \
  -f custom_commands="echo 'Hello from self-hosted runner'; hostname; whoami" \
  -f use_self_hosted=true

# Watch it run
gh run watch
```

---

## Security Best Practices

### ⚠️ Critical: Only Use on Private Repos

**Never use self-hosted runners or arbitrary command execution on public repositories!**

Attackers can:
1. Fork your repo
2. Create a malicious PR
3. PR triggers workflow on YOUR runner
4. Attacker code runs on YOUR infrastructure
5. Your network/secrets are compromised

### Protection Strategies

**1. Branch Protection**
```yaml
# Only allow on protected branches
on:
  workflow_dispatch:
    branches: [main, master]  # Not on PRs or forks!
```

**2. Environment Protection**
```yaml
jobs:
  debug:
    environment:
      name: production
      # Settings → Environments → production → Required reviewers
```

**3. Approval Gates in GitHub UI**
- Go to: Settings → Environments → production
- Enable **"Required reviewers"**
- Add yourself as reviewer
- Now every run needs manual approval

**4. Audit Logging**
```yaml
- name: Log execution
  run: |
    echo "AUDIT: User ${{ github.actor }} executed custom commands" >> /var/log/github-actions-audit.log
    echo "Commands: ${{ inputs.custom_commands }}" >> /var/log/github-actions-audit.log
```

---

## Real-World Use Cases

### 1. Debug Production Deployment Issue

```bash
gh workflow run debug-runner.yml \
  -f use_self_hosted=true \
  -f custom_commands="
kubectl get pods -n satvis
kubectl logs -n satvis deployment/satvis-web --tail=100
kubectl describe pod -n satvis \$(kubectl get pods -n satvis -l app=satvis -o name | head -1)
"
```

### 2. Test Docker Image Locally

```bash
gh workflow run debug-runner.yml \
  -f use_self_hosted=true \
  -f custom_commands="
docker pull ghcr.io/anttikuosmanen-rgb/satvis/web:${{ github.sha }}
docker run -d -p 8080:80 ghcr.io/anttikuosmanen-rgb/satvis/web:${{ github.sha }}
sleep 5
curl -I http://localhost:8080
docker logs \$(docker ps -q | head -1)
"
```

### 3. Run E2E Tests with Custom Config

```bash
gh workflow run debug-runner.yml \
  -f use_self_hosted=true \
  -f custom_commands="
npm ci
npx playwright install
E2E_BASE_URL=https://staging.satvis.space npm run test:e2e
"
```

### 4. Emergency Rollback

```bash
gh workflow run debug-runner.yml \
  -f use_self_hosted=true \
  -f custom_commands="
kubectl rollout undo deployment/satvis-web -n satvis
kubectl rollout status deployment/satvis-web -n satvis
"
```

---

## Comparison: Jenkins Replay vs This Approach

| Feature | Jenkins Replay | GitHub Actions (This Setup) |
|---------|---------------|----------------------------|
| Edit workflow in UI | ✅ Yes | ❌ No (but can pass arbitrary commands) |
| Run without commit | ✅ Yes | ✅ Yes (commands via inputs) |
| Access to private network | ✅ Yes | ✅ Yes (with self-hosted) |
| Audit trail | ⚠️ Limited | ✅ Full (git + GitHub logs) |
| Branch protection | ⚠️ Configurable | ✅ Built-in |
| Cost | 💰 Self-hosted server | 💰 Self-hosted or GitHub runners |
| Setup complexity | 🔧 High (Jenkins) | 🔧 Medium (Runners + YAML) |
| Iteration speed | ⚡ Instant | ⚡ ~30s (workflow dispatch) |

---

## Troubleshooting

### Runner Not Available

```bash
# Check runner status
gh api /repos/anttikuosmanen-rgb/satvis/actions/runners

# Restart runner (Docker Compose)
docker-compose -f docker-compose-runner.yml restart

# Restart runner (systemd)
sudo systemctl restart actions.runner.*
```

### Workflow Doesn't Use Self-Hosted Runner

Check labels match:
```yaml
# In workflow
runs-on: self-hosted

# Runner must have 'self-hosted' label
gh api /repos/anttikuosmanen-rgb/satvis/actions/runners | jq '.runners[].labels'
```

### Commands Fail with Permission Denied

Runner user needs permissions:
```bash
# Add runner to docker group
sudo usermod -aG docker runner

# Restart runner service
sudo systemctl restart actions.runner.*
```

---

## Next Steps

1. ✅ Set up self-hosted runner (see SELF-HOSTED-RUNNERS.md)
2. ✅ Commit debug-runner.yml workflow
3. ✅ Test with simple command
4. ✅ Create gist for complex debug scripts
5. ✅ Add environment protection for production
6. ✅ Document common debug scenarios for your team

**Questions?** Check the [GitHub Actions self-hosted runner docs](https://docs.github.com/en/actions/hosting-your-own-runners).
