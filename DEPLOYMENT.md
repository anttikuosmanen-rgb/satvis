# Deployment

Satvis supports automated deployment via GitHub Actions.

## Deployment Methods

### 1. GitHub Pages (Public)
Automatically deploys to GitHub Pages on every push to `master` branch.
- **Workflow:** `.github/workflows/deploy.yml`
- **URL:** Generated GitHub Pages URL

### 2. SSH Deployment (Production Server)
Deploys to production server via SSH on push to `production` branch.
- **Workflow:** `.github/workflows/deploy-ssh.yml`
- **Trigger:** Push to `production` branch or manual workflow dispatch
- **Runner:** Self-hosted runner (required for server access)

## Production Deployment

### Prerequisites

The SSH deployment workflow requires:
1. A self-hosted GitHub Actions runner with network access to the deployment server
2. GitHub Secrets configured for SSH authentication and deployment paths

### Setting Up Self-Hosted Runner

The deployment workflow uses a self-hosted runner instead of GitHub-hosted runners because:
- GitHub-hosted runners use thousands of IP addresses that are impractical to whitelist
- Self-hosted runners can be placed on infrastructure with direct access to deployment servers
- No firewall configuration changes are needed
- Free to use (doesn't consume GitHub Actions minutes)

#### Installation Steps

1. **Choose a host machine** that can access the deployment server via SSH on port 22
   - This can be your local machine, a CI server, or any machine with network access
   - Ensure the machine has Node.js 22+ and npm installed

2. **Add a self-hosted runner to your repository:**
   - Go to repository **Settings** → **Actions** → **Runners** → **New self-hosted runner**
   - Select your operating system (Linux, macOS, or Windows)
   - Follow the provided installation commands, for example:

   ```bash
   # Download
   mkdir actions-runner && cd actions-runner
   curl -o actions-runner-linux-x64-2.311.0.tar.gz -L \
     https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
   tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

   # Configure
   ./config.sh --url https://github.com/YOUR_USERNAME/satvis --token YOUR_TOKEN

   # Install and start as a service (recommended)
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

3. **Verify the runner is online:**
   - Check repository **Settings** → **Actions** → **Runners**
   - Status should show "Idle" (green dot)

4. **Test SSH access from the runner machine:**
   ```bash
   # Verify the runner can reach the deployment server
   ssh -i ~/.ssh/your_deploy_key user@deployment-server
   ```

### Required GitHub Secrets

The SSH deployment workflow requires the following secrets to be configured in GitHub repository settings:

| Secret Name | Description |
|-------------|-------------|
| `SSH_DEPLOY_KEY` | Private SSH key for server authentication |
| `SSH_DEPLOY_HOST` | Server hostname |
| `SSH_DEPLOY_USER` | SSH username |
| `SSH_DEPLOY_PATH` | Deployment directory path on server |

### Setting Up Secrets

#### Generate SSH Key Pair

Generate a dedicated SSH key pair for deployment:

```bash
ssh-keygen -t ed25519 -C "github-actions-satvis-deploy" -f ~/.ssh/satvis_deploy_key
```

This creates two files:
- `~/.ssh/satvis_deploy_key` (private key - keep secret)
- `~/.ssh/satvis_deploy_key.pub` (public key - add to server)

#### Add Public Key to Deployment Server

Copy the public key to the deployment server:

```bash
ssh-copy-id -i ~/.ssh/satvis_deploy_key.pub user@deployment-server
```

Or manually append the public key to `~/.ssh/authorized_keys` on the server.

#### Configure GitHub Secrets

1. Go to repository **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add each required secret:
   - **SSH_DEPLOY_KEY**: Paste the **entire contents** of the private key file (`~/.ssh/satvis_deploy_key`)
   - **SSH_DEPLOY_HOST**: Server hostname (e.g., `example.com`)
   - **SSH_DEPLOY_USER**: SSH username for authentication
   - **SSH_DEPLOY_PATH**: Absolute path to deployment directory on server

### Deployment Process

The workflow performs the following steps:

1. **Build:**
   - Checks out code with submodules
   - Installs dependencies
   - Updates TLE data
   - Builds production assets

2. **Deploy:**
   - Creates compressed deployment archive
   - Uploads to server via SCP
   - Backs up current deployment (keeps 5 most recent)
   - Extracts new deployment
   - Verifies deployment

3. **Cleanup:**
   - Removes temporary SSH keys
   - Generates deployment summary

### Triggering Deployment

#### Automatic
Push to the production branch:
```bash
git push origin production
```

#### Manual
1. Go to **Actions** → **Deploy to Server**
2. Click **Run workflow**
3. Select the branch to deploy
4. Click **Run workflow**

## Security

### Secret Protection

All sensitive deployment information (server hostnames, paths, SSH keys) is stored securely in GitHub Secrets and is never exposed in:
- Workflow files (public)
- Workflow logs
- Repository code

The workflow uses:
- **Environment secrets** (`environment: production`) which are NEVER accessible to forked repositories
- Ephemeral SSH keys that exist only during deployment and are immediately cleaned up

### Self-Hosted Runner Security

To prevent forks from running malicious code on your self-hosted runner:

#### 1. Configure Fork Pull Request Workflow Approval
Go to **Settings** → **Actions** → **General** → Scroll to "Fork pull request workflows"

Under "Approval for running fork pull request workflows from contributors", select:
- **"Require approval for all external contributors"** (MOST SECURE - recommended)

This ensures ANY workflow run from a fork requires your manual approval before executing on your self-hosted runner.

**WARNING**: GitHub strongly recommends against using self-hosted runners with public repositories because forks can submit pull requests with malicious code that could compromise your runner machine. The `environment: production` setting provides protection by preventing access to secrets, but the workflow code itself still executes on your machine.

#### 2. Environment Protection Rules (Critical)
Go to **Settings** → **Environments** → **production** → Configure:

- **Deployment branches**: Select "Selected branches" → Add rule for `production` only
- **Required reviewers**: Add yourself (optional but recommended for extra protection)

This ensures:
- Only the `production` branch can access environment secrets
- Forks cannot access the `production` environment secrets (SSH keys, server details)
- Even if a fork runs the workflow, it will fail without secrets

#### 3. Self-Hosted Runner Configuration
When setting up the runner:
- Install the runner only for this specific repository (not organization-wide)
- The runner automatically only accepts jobs from the repository it was registered to

**Note**: Runner groups are only available for GitHub Enterprise/Organizations, not personal repositories.

#### Why This Works
The combination of:
1. Environment secrets (not accessible to forks)
2. Approval requirements for fork workflows
3. Deployment branch restrictions

Means that even if a fork modifies the workflow file and tries to run it:
- They can't access your `production` environment
- They can't access your SSH keys or server details
- They can't deploy to your server
- You must manually approve their workflow run

**Key takeaway**: The `environment: production` setting prevents forks from accessing secrets, but forks can still run code on your self-hosted runner if approved.

#### Best Practices for Public Repos with Self-Hosted Runners

1. **Always require approval** for all fork PRs before workflows run
2. **Carefully review** any PR workflow changes before approving
3. **Never approve** PRs that modify the workflow file (`.github/workflows/deploy-ssh.yml`) unless you fully understand the changes
4. **Consider** running the self-hosted runner in an isolated/sandboxed environment (VM, container) to limit potential damage
5. **Monitor** your runner machine for suspicious activity

**Alternative (More Secure)**: If accepting contributions from external developers, consider:
- Manual deployment triggered by you after merging trusted PRs
- Using a dedicated CI/CD service that supports GitHub webhooks
- Only running the self-hosted runner when you need to deploy (start/stop on demand)

## Development Workflow

```
feature-branch → merge → master → GitHub Pages (public preview)
                           ↓
                    (after testing)
                           ↓
                      production → Production Server (SSH)
```

1. Develop features in feature branches
2. Merge to `master` for testing on GitHub Pages
3. When ready for production, merge `master` to `production`
4. Production deployment runs automatically

## Rollback

If a deployment needs to be rolled back, SSH into the server and restore a previous backup:

```bash
# List available backups
ls -la backup-*

# Restore a specific backup
rm -rf current
mv backup-YYYYMMDD-HHMMSS current
```

## Monitoring

Deployment status and logs are available in the **Actions** tab of the GitHub repository.
