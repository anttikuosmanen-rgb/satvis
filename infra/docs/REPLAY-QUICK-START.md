# Quick Start: Jenkins Replay-Like Behavior

## TL;DR

```bash
# 1. Set up self-hosted runner (one-time)
docker run -d \
  -e REPO_URL=https://github.com/anttikuosmanen-rgb/satvis \
  -e ACCESS_TOKEN=ghp_your_token \
  -e LABELS=self-hosted,docker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  myoung34/github-runner:latest

# 2. Run arbitrary commands (like Jenkins Replay)
gh workflow run debug-runner.yml \
  -f custom_commands="docker ps; kubectl get pods; npm test" \
  -f use_self_hosted=true
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  Jenkins Replay                                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Click "Replay" on build                             │
│  2. Edit Groovy script in UI                            │
│  3. Click "Run"                                          │
│  4. Executes modified script                            │
│                                                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  GitHub Actions (This Setup)                            │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Go to Actions → debug-runner.yml                    │
│  2. Click "Run workflow"                                │
│  3. Paste commands in "custom_commands" field           │
│  4. Check "use_self_hosted"                             │
│  5. Click "Run workflow"                                │
│  6. Executes your commands on self-hosted runner        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Three Approaches

### Approach 1: Paste Commands Directly

**UI:** Actions → debug-runner.yml → Run workflow → Paste commands

**CLI:**
```bash
gh workflow run debug-runner.yml \
  -f custom_commands="echo 'Testing'; docker ps; npm test" \
  -f use_self_hosted=true
```

**Pros:** Instant, no files needed
**Cons:** Long commands are awkward
**Best for:** Quick tests, one-liners

---

### Approach 2: Edit Gist + Re-run

**Setup (once):**
```bash
# Create gist at https://gist.github.com
# Name: debug-satvis.sh
# Content: your debug script
```

**Iterate:**
```bash
# Run with gist URL
gh workflow run debug-runner.yml \
  -f script_url="https://gist.githubusercontent.com/user/id/raw/debug-satvis.sh" \
  -f use_self_hosted=true

# Edit gist in browser
# Re-run (automatically uses latest version)
gh workflow run debug-runner.yml \
  -f script_url="https://gist.githubusercontent.com/user/id/raw/debug-satvis.sh"
```

**Pros:** Can edit complex scripts easily
**Cons:** Need to create gist first
**Best for:** Iterating on complex debug workflows

---

### Approach 3: Use Pre-Defined Scenarios

```bash
# Full diagnostic
gh workflow run debug-runner.yml -f debug_scenario="full-diagnostic"

# Check Docker
gh workflow run debug-runner.yml -f debug_scenario="check-docker"

# Test deployment
gh workflow run debug-runner.yml -f debug_scenario="test-deployment"
```

**Pros:** One command, no setup
**Cons:** Limited to pre-defined scenarios
**Best for:** Common tasks

---

## Real Examples

### Debug Production Issue

```bash
gh workflow run debug-runner.yml -f use_self_hosted=true -f custom_commands="
# Check pod status
kubectl get pods -n satvis

# Get recent logs
kubectl logs -n satvis deployment/satvis-web --tail=100

# Check if image is correct
kubectl get deployment satvis-web -n satvis -o jsonpath='{.spec.template.spec.containers[0].image}'
"
```

### Test Docker Image Before Deploy

```bash
gh workflow run debug-runner.yml -f use_self_hosted=true -f custom_commands="
# Pull image
docker pull ghcr.io/anttikuosmanen-rgb/satvis/web:abc1234

# Run it
docker run -d -p 8080:80 ghcr.io/anttikuosmanen-rgb/satvis/web:abc1234

# Test it
sleep 5
curl -I http://localhost:8080

# Check logs
docker logs \$(docker ps -q | head -1)

# Cleanup
docker stop \$(docker ps -q | head -1)
"
```

### Run Specific E2E Tests

```bash
gh workflow run debug-runner.yml -f use_self_hosted=true -f custom_commands="
npm ci
npx playwright install chromium
npm run test:e2e -- --grep 'pre-launch'
"
```

---

## Key Differences from GitHub Runners

|  | GitHub Runners | Self-Hosted |
|--|----------------|-------------|
| **Access private network** | ❌ No | ✅ Yes |
| **Pre-installed tools** | ⚠️ Standard set | ✅ Whatever you install |
| **kubectl access** | ❌ No | ✅ Yes (if configured) |
| **Cost** | 💰 Per minute | 💰 Fixed (24/7) |
| **Security** | ✅ Isolated | ⚠️ Your responsibility |
| **Setup** | ✅ None | 🔧 Runner setup required |

---

## Security Checklist

- [ ] Self-hosted runner only on **private repo** (never public!)
- [ ] Branch protection enabled on main/master
- [ ] Environment protection with required reviewers
- [ ] Audit logging configured
- [ ] Runner has minimal permissions (principle of least privilege)
- [ ] Regular security updates on runner VM

---

## Troubleshooting

### "No runner available"

```bash
# Check runner status
gh api /repos/anttikuosmanen-rgb/satvis/actions/runners

# Restart runner
docker restart <runner-container-id>
```

### "Workflow doesn't use self-hosted runner"

Make sure you checked the **"use_self_hosted"** checkbox in the UI, or:
```bash
gh workflow run debug-runner.yml -f use_self_hosted=true  # ← Must be true!
```

### "Commands fail"

Check the workflow run logs:
```bash
gh run list --workflow=debug-runner.yml
gh run view <run-id> --log
```

---

## What You Can't Do (vs Jenkins Replay)

| Feature | Jenkins | GitHub Actions |
|---------|---------|----------------|
| Edit workflow YAML in UI | ✅ | ❌ (but can pass arbitrary commands) |
| Truly instant re-run | ✅ | ⚠️ ~30s dispatch time |
| Edit mid-execution | ✅ | ❌ |
| Attach debugger | ✅ (via plugins) | ❌ |

**Bottom line:** You can run arbitrary commands, but the workflow YAML itself must be in git.

---

## Next Steps

1. **Set up runner:** See [SELF-HOSTED-RUNNERS.md](./SELF-HOSTED-RUNNERS.md)
2. **Commit workflow:** `git add .github/workflows/debug-runner.yml && git commit && git push`
3. **Test it:** `gh workflow run debug-runner.yml -f debug_scenario="inspect-environment"`
4. **Create your first debug gist** for complex scenarios
5. **Add to your debugging toolkit** 🎉

---

## Full Documentation

- [Complete setup guide](./REPLAY-LIKE-WORKFLOWS.md)
- [Self-hosted runner details](./SELF-HOSTED-RUNNERS.md)
- [GitHub Actions docs](https://docs.github.com/en/actions/hosting-your-own-runners)
