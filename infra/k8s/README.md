# Kubernetes Deployment for SatVis

This directory contains Kubernetes manifests for deploying the SatVis satellite visualization application to a Kubernetes cluster.

## Architecture Overview

- **Web Application**: Nginx serving the static PWA application (2-10 replicas with auto-scaling)
- **TLE Updater**: CronJob running daily at 3:00 AM UTC to update satellite orbital data
- **Shared Storage**: PersistentVolume for TLE data shared between web pods and updater CronJob
- **Auto-scaling**: Horizontal Pod Autoscaler (HPA) scales web pods based on CPU/memory usage
- **Container Registry**: GitHub Container Registry (ghcr.io) for Docker images

## Prerequisites

1. **Kubernetes cluster** (1.19+)
2. **kubectl** configured to access your cluster
3. **Nginx Ingress Controller** installed in your cluster
4. **Metrics Server** installed for HPA to work
5. **GitHub Container Registry** images built and available

## Oracle Cloud Infrastructure (OCI) Deployment

### Quick Start with OCI Free Tier

This project includes complete setup for deploying to Oracle Cloud's Always Free tier (4 ARM cores, 24GB RAM - $0/month forever).

**Step-by-step guide**: See [`docs/OCI-SETUP.md`](../docs/OCI-SETUP.md) for detailed instructions.

**Quick deployment using helper scripts**:

1. **Set up OCI account and create ARM instances** (follow `docs/OCI-SETUP.md` steps 1-3)

2. **Install K3s on master node**:
   ```bash
   # SSH to master node, then:
   curl -O https://raw.githubusercontent.com/anttikuosmanen-rgb/satvis/master/scripts/install-k3s-master.sh
   chmod +x install-k3s-master.sh
   ./install-k3s-master.sh
   ```
   Save the join token and private IP shown at the end.

3. **Install K3s on worker node(s)** (optional):
   ```bash
   # SSH to worker node, then:
   curl -O https://raw.githubusercontent.com/anttikuosmanen-rgb/satvis/master/scripts/install-k3s-worker.sh
   chmod +x install-k3s-worker.sh
   ./install-k3s-worker.sh
   # Enter master private IP and join token when prompted
   ```

4. **Configure kubectl on your local machine**:
   ```bash
   # On your local machine:
   ./scripts/configure-kubectl.sh
   # Enter master public IP when prompted
   ```

5. **Deploy SatVis**:
   ```bash
   # On your local machine, from repo root:
   ./scripts/deploy-satvis.sh
   # Follow prompts to configure domain or use IP-based access
   ```

6. **Access your deployment**:
   - Visit `http://<master-public-ip>` or your configured domain
   - Grafana monitoring: See `docs/MONITORING.md` for setup

### OCI-Specific Notes

- **No LoadBalancer**: OCI free tier doesn't include load balancers. Ingress will use NodePort (works automatically)
- **Storage**: Uses OCI block storage (included in free tier, up to 200GB)
- **Networking**: Security lists are configured during OCI setup (ports 22, 80, 443, 6443)
- **Monitoring**: See `docs/MONITORING.md` for installing kube-prometheus-stack

## Quick Start

### 1. Build and Push Docker Images

Images are automatically built and pushed to GitHub Container Registry when code is pushed to the `master` branch via the `.github/workflows/docker-build.yml` workflow.

Manual build:
```bash
# From repository root
docker build -f Dockerfile.web -t ghcr.io/anttikuosmanen-rgb/satvis/web:latest .
docker build -f infra/Dockerfile.tle-updater -t ghcr.io/anttikuosmanen-rgb/satvis/tle-updater:latest .

# Push to registry (requires authentication)
docker push ghcr.io/anttikuosmanen-rgb/satvis/web:latest
docker push ghcr.io/anttikuosmanen-rgb/satvis/tle-updater:latest
```

### 2. Configure Your Domain

Edit `ingress.yaml` and replace `satvis.example.com` with your actual domain:

```yaml
spec:
  rules:
  - host: your-domain.com  # Replace with your domain
```

Or remove the `host` field entirely for IP-based access.

### 3. Deploy to Kubernetes

Apply all manifests in order:

```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Create ConfigMap and PersistentVolumeClaim
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/pvc.yaml

# Deploy web application
kubectl apply -f k8s/deployment-web.yaml
kubectl apply -f k8s/service.yaml

# Set up auto-scaling
kubectl apply -f k8s/hpa.yaml

# Deploy TLE updater CronJob
kubectl apply -f k8s/cronjob-tle.yaml

# Create Ingress (expose to internet)
kubectl apply -f k8s/ingress.yaml
```

Or apply all at once:

```bash
kubectl apply -f k8s/
```

### 4. Verify Deployment

```bash
# Check all resources in satvis namespace
kubectl get all -n satvis

# Check pod status
kubectl get pods -n satvis

# Check HPA status
kubectl get hpa -n satvis

# Check ingress
kubectl get ingress -n satvis

# View logs
kubectl logs -n satvis -l app=satvis,component=web
kubectl logs -n satvis -l app=satvis,component=tle-updater
```

## Configuration

### Storage Class

The PVC uses the default storage class. If you need a specific storage class, edit `pvc.yaml`:

```yaml
spec:
  storageClassName: "your-storage-class"  # e.g., "standard", "fast-ssd", etc.
```

### Auto-scaling Settings

Edit `hpa.yaml` to adjust scaling behavior:

- `minReplicas`: Minimum number of web pods (default: 2)
- `maxReplicas`: Maximum number of web pods (default: 10)
- `averageUtilization`: CPU/memory threshold for scaling (default: 70%/80%)

### TLE Update Schedule

Edit `cronjob-tle.yaml` to change the update schedule:

```yaml
spec:
  schedule: "0 3 * * *"  # Daily at 3:00 AM UTC (cron format)
```

Common schedules:
- `0 */6 * * *` - Every 6 hours
- `0 0 * * *` - Daily at midnight
- `0 0 * * 0` - Weekly on Sunday at midnight

### Resource Limits

Edit `deployment-web.yaml` to adjust resource allocation:

```yaml
resources:
  requests:
    cpu: 100m      # Minimum CPU
    memory: 128Mi  # Minimum memory
  limits:
    cpu: 500m      # Maximum CPU
    memory: 256Mi  # Maximum memory
```

## Initial TLE Data Setup

The TLE updater CronJob updates data daily, but for initial deployment you may want to pre-populate the PVC:

```bash
# Method 1: Run TLE updater job manually
kubectl create job -n satvis --from=cronjob/satvis-tle-updater initial-tle-update

# Method 2: Copy from local machine
kubectl cp data/tle/groups satvis/<web-pod-name>:/usr/share/nginx/html/data/tle/
```

## SSL/TLS with cert-manager (Optional)

To enable HTTPS with automatic Let's Encrypt certificates:

### 1. Install cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

### 2. Create ClusterIssuer

```bash
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com  # Replace with your email
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

### 3. Update Ingress

Uncomment the TLS and cert-manager annotations in `ingress.yaml`:

```yaml
metadata:
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - your-domain.com
    secretName: satvis-tls-cert
```

Apply the updated ingress:

```bash
kubectl apply -f k8s/ingress.yaml
```

## Monitoring

### Check Pod Health

```bash
# View pod status
kubectl get pods -n satvis -w

# Check pod health endpoints
kubectl port-forward -n satvis svc/satvis-web 8080:80
curl http://localhost:8080/health
```

### View Logs

```bash
# Web pods
kubectl logs -n satvis -l component=web --tail=100 -f

# TLE updater (latest job)
kubectl logs -n satvis -l component=tle-updater --tail=100

# Specific pod
kubectl logs -n satvis <pod-name>
```

### HPA Metrics

```bash
# Current HPA status
kubectl get hpa -n satvis -w

# Detailed HPA info
kubectl describe hpa satvis-web-hpa -n satvis
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod -n satvis <pod-name>

# Check if images are accessible
kubectl get events -n satvis --sort-by='.lastTimestamp'
```

### Image Pull Errors

If you get "ImagePullBackOff" errors, ensure the GitHub Container Registry images are public or create an image pull secret:

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-token> \
  --namespace=satvis

# Update deployment-web.yaml to use the secret
spec:
  template:
    spec:
      imagePullSecrets:
      - name: ghcr-secret
```

### TLE Updates Not Running

```bash
# Check CronJob status
kubectl get cronjob -n satvis

# Check job history
kubectl get jobs -n satvis

# Manually trigger update
kubectl create job -n satvis --from=cronjob/satvis-tle-updater manual-update-$(date +%s)
```

### HPA Not Scaling

Ensure Metrics Server is installed:

```bash
kubectl get deployment metrics-server -n kube-system
```

Install if missing:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

## Updating the Application

### Automated Updates (Recommended)

Push to `master` branch. GitHub Actions will:
1. Build new Docker images
2. Push to ghcr.io with `latest` tag and commit SHA tag
3. Kubernetes will pull new images on next pod restart

Force update:

```bash
kubectl rollout restart deployment/satvis-web -n satvis
```

### Manual Updates

```bash
# Update to specific image version
kubectl set image deployment/satvis-web -n satvis nginx=ghcr.io/anttikuosmanen-rgb/satvis/web:<sha>

# Watch rollout status
kubectl rollout status deployment/satvis-web -n satvis
```

## Cleanup

Remove all SatVis resources:

```bash
kubectl delete namespace satvis
```

Or remove individually:

```bash
kubectl delete -f k8s/
```

## CI/CD Integration

The `.github/workflows/docker-build.yml` workflow automatically:
- Builds Docker images on push to `master`
- Tags images with `latest` and commit SHA
- Pushes to GitHub Container Registry

Images are available at:
- `ghcr.io/anttikuosmanen-rgb/satvis/web:latest`
- `ghcr.io/anttikuosmanen-rgb/satvis/tle-updater:latest`

## Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Nginx Ingress Controller](https://kubernetes.github.io/ingress-nginx/)
- [cert-manager Documentation](https://cert-manager.io/docs/)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
