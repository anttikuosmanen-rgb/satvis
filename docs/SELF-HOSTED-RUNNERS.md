# Self-Hosted GitHub Actions Runners Setup

## Overview

Self-hosted runners give you full control over the execution environment, allowing for:
- Custom pre-installed software
- Access to private networks/resources
- Cost savings for heavy workloads
- More flexibility in workflow execution

## Installation on Kubernetes (Recommended for SatVis)

### Option 1: Using actions-runner-controller (ARC)

```bash
# Install ARC operator
helm repo add actions-runner-controller https://actions-runner-controller.github.io/actions-runner-controller
helm upgrade --install --namespace actions-runner-system --create-namespace \
  --wait actions-runner-controller actions-runner-controller/actions-runner-controller

# Create GitHub App or PAT for authentication
# Then create secret
kubectl create secret generic controller-manager \
  -n actions-runner-system \
  --from-literal=github_token=YOUR_PAT

# Deploy runner set
cat <<EOF | kubectl apply -f -
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
      labels:
        - self-hosted
        - linux
        - x64
      # Custom Docker image with pre-installed tools
      image: summerwind/actions-runner:latest
      dockerdWithinRunnerContainer: true
      resources:
        limits:
          cpu: "2"
          memory: "4Gi"
        requests:
          cpu: "1"
          memory: "2Gi"
EOF
```

### Option 2: Docker Compose (Simpler for Testing)

```yaml
# docker-compose-runner.yml
version: '3'
services:
  runner:
    image: myoung34/github-runner:latest
    environment:
      - REPO_URL=https://github.com/anttikuosmanen-rgb/satvis
      - RUNNER_NAME=satvis-self-hosted
      - ACCESS_TOKEN=${GITHUB_PAT}
      - RUNNER_WORKDIR=/tmp/runner/work
      - LABELS=self-hosted,docker
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - runner-work:/tmp/runner/work
    restart: unless-stopped

volumes:
  runner-work:
```

```bash
# Start runner
GITHUB_PAT=ghp_your_token docker-compose -f docker-compose-runner.yml up -d
```

## Manual Installation (On VM/Bare Metal)

```bash
# Download runner
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

# Configure
./config.sh --url https://github.com/anttikuosmanen-rgb/satvis --token YOUR_REGISTRATION_TOKEN

# Install as service
sudo ./svc.sh install
sudo ./svc.sh start
```

## Using Self-Hosted Runners in Workflows

### Simple Usage

```yaml
jobs:
  build:
    runs-on: self-hosted  # Use any self-hosted runner
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

### With Custom Labels

```yaml
jobs:
  build:
    runs-on: [self-hosted, linux, docker]  # Match specific labels
    steps:
      - uses: actions/checkout@v4
      - run: docker build .
```

### Hybrid Approach (GitHub + Self-Hosted)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest  # Use GitHub's runners
    steps:
      - uses: actions/checkout@v4
      - run: npm test

  deploy:
    runs-on: self-hosted  # Use your runner for deployment
    needs: test
    steps:
      - run: kubectl apply -f k8s/
```

## Security Considerations

### ⚠️ Important: Self-Hosted Runner Risks

1. **Public Repo Risk**: Never use self-hosted runners on public repos!
   - Anyone can fork and create PRs
   - PRs run workflows on YOUR infrastructure
   - Attackers could mine crypto, steal secrets, attack your network

2. **Isolation**: Self-hosted runners don't have job isolation by default
   - One job can see files from previous jobs
   - Need to clean workspace between runs

3. **Secret Access**: Runners have access to repository secrets
   - Compromised runner = compromised secrets
   - Use ephemeral runners when possible

### Best Practices

```yaml
# Only use self-hosted runners for protected workflows
on:
  push:
    branches: [main]  # Not on PRs!
  workflow_dispatch:  # Or manual only

jobs:
  deploy:
    runs-on: self-hosted
    environment: production  # Require approval
    steps:
      - run: ./deploy.sh
```

## Monitoring and Maintenance

### Check Runner Status

```bash
# Via GitHub CLI
gh api /repos/anttikuosmanen-rgb/satvis/actions/runners

# On runner machine
sudo ./svc.sh status
```

### View Runner Logs

```bash
# Kubernetes
kubectl logs -n satvis -l app=satvis-runners -f

# Docker Compose
docker-compose logs -f runner

# Systemd service
sudo journalctl -u actions.runner.* -f
```

### Update Runners

```bash
# Runners auto-update during jobs by default
# To force update:
cd actions-runner
./config.sh remove --token TOKEN
./config.sh --url URL --token NEW_TOKEN
sudo ./svc.sh install
sudo ./svc.sh start
```

## Cost Comparison

| Scenario | GitHub Runners | Self-Hosted |
|----------|---------------|-------------|
| Light usage (<2000 min/month) | Free tier | Overkill - not worth it |
| Medium usage (10,000 min/month) | ~$8/month | ~$50/month (small VM) |
| Heavy usage (50,000 min/month) | ~$40/month | ~$50/month (break-even) |
| Very heavy (200,000 min/month) | ~$160/month | ~$100/month (savings) |

**Notes:**
- Self-hosted has fixed costs (24/7 running)
- GitHub runners scale to zero
- Consider maintenance time costs

## When to Use Self-Hosted Runners

✅ **Good reasons:**
- Access to private network resources (databases, APIs)
- Custom hardware requirements (GPU, large memory)
- Pre-installed software that's slow to install
- Compliance requirements (data locality)
- Very high usage (cost savings)

❌ **Bad reasons:**
- Want to save money (usually costs more with maintenance)
- Think it's "more secure" (actually introduces risks)
- Want Jenkins-like Replay (still can't edit YAML)

## Achieving Replay-Like Flexibility

See next section for workarounds to get Jenkins Replay-like behavior.
