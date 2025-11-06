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

## Production Deployment

### Required GitHub Secrets

The SSH deployment workflow requires the following secrets to be configured in GitHub repository settings:

| Secret Name | Description |
|-------------|-------------|
| `SSH_DEPLOY_KEY` | Private SSH key for server authentication |
| `SSH_DEPLOY_HOST` | Server hostname |
| `SSH_DEPLOY_USER` | SSH username |
| `SSH_DEPLOY_PATH` | Deployment directory path on server |

### Setting Up Secrets

1. Go to repository **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add each required secret with its corresponding value

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

All sensitive deployment information (server hostnames, paths, SSH keys) is stored securely in GitHub Secrets and is never exposed in:
- Workflow files (public)
- Workflow logs
- Repository code

The workflow uses ephemeral SSH keys that exist only during the deployment process and are immediately cleaned up afterward.

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
