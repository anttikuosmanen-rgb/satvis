# SatVis OCI Deployment Checklist

Use this checklist to deploy SatVis to Oracle Cloud Infrastructure step-by-step.

## ✅ Pre-Deployment (Complete)

- [x] Docker images built and available on ghcr.io
- [x] Kubernetes manifests created
- [x] OCI setup guide prepared
- [x] Helper scripts created and tested
- [x] Monitoring stack configured
- [x] Documentation complete

## 📋 OCI Account Setup

### Phase 1: Account Creation
- [ ] Create OCI account at https://www.oracle.com/cloud/free/
- [ ] Verify email address
- [ ] Complete identity verification (credit card required, won't be charged)
- [ ] Choose home region (permanent choice - recommend closest to you)
- [ ] Wait for account activation (usually instant, max 24 hours)
- [ ] Log in to OCI Console: https://cloud.oracle.com/

**Estimated time**: 30 minutes

**Documentation**: `docs/OCI-SETUP.md` (Steps 1-2)

---

### Phase 2: Network Setup
- [ ] Navigate to Networking → Virtual Cloud Networks
- [ ] Create VCN using wizard ("Create VCN with Internet Connectivity")
  - Name: `satvis-vcn`
  - CIDR: `10.0.0.0/16`
  - Public subnet: `10.0.0.0/24`
  - Private subnet: `10.0.1.0/24`
- [ ] Configure security list with ingress rules:
  - [ ] SSH (22)
  - [ ] HTTP (80)
  - [ ] HTTPS (443)
  - [ ] Kubernetes API (6443)
  - [ ] Kubelet metrics (10250) - optional

**Estimated time**: 15 minutes

**Documentation**: `docs/OCI-SETUP.md` (Step 2)

---

### Phase 3: Compute Instances

#### Master Node
- [ ] Navigate to Compute → Instances → Create Instance
- [ ] Configure:
  - Name: `k3s-master`
  - Image: Ubuntu 22.04 ARM
  - Shape: VM.Standard.A1.Flex
  - OCPUs: 2
  - Memory: 12 GB
  - VCN: satvis-vcn
  - Subnet: Public subnet
  - Assign public IPv4: Yes
  - Add SSH key (upload or generate)
- [ ] Wait for instance to reach RUNNING state
- [ ] Note down public IP: `________________`

#### Worker Node (Optional but Recommended)
- [ ] Navigate to Compute → Instances → Create Instance
- [ ] Configure:
  - Name: `k3s-worker-1`
  - Image: Ubuntu 22.04 ARM
  - Shape: VM.Standard.A1.Flex
  - OCPUs: 2
  - Memory: 12 GB
  - VCN: satvis-vcn
  - Subnet: Public subnet
  - Assign public IPv4: Optional
  - Use same SSH key as master
- [ ] Wait for instance to reach RUNNING state
- [ ] Note down private IP: `________________`

**Estimated time**: 20 minutes (instances can take 5-10 min to provision)

**Documentation**: `docs/OCI-SETUP.md` (Step 3)

**Note**: If you get "Out of host capacity" errors, try:
- Different Availability Domain
- Smaller instances (1 OCPU + 6GB each)
- Different time of day

---

## 🚀 K3s Cluster Setup

### Phase 4: Master Node Installation
- [ ] SSH to master node: `ssh -i ~/.ssh/your-key ubuntu@<MASTER_PUBLIC_IP>`
- [ ] Copy install script:
  ```bash
  curl -O https://raw.githubusercontent.com/anttikuosmanen-rgb/satvis/master/scripts/install-k3s-master.sh
  chmod +x install-k3s-master.sh
  ```
- [ ] Run installer: `./install-k3s-master.sh`
- [ ] Wait for installation to complete (~1 minute)
- [ ] Copy the join token shown: `________________`
- [ ] Copy the master private IP shown: `________________`
- [ ] Verify: `sudo k3s kubectl get nodes` shows master as Ready

**Estimated time**: 2-3 minutes

**Documentation**: `docs/OCI-SETUP.md` (Step 5.1-5.2)

---

### Phase 5: Worker Node Installation (If using worker)
- [ ] SSH to worker node: `ssh -i ~/.ssh/your-key ubuntu@<WORKER_PUBLIC_IP>`
- [ ] Copy install script:
  ```bash
  curl -O https://raw.githubusercontent.com/anttikuosmanen-rgb/satvis/master/scripts/install-k3s-worker.sh
  chmod +x install-k3s-worker.sh
  ```
- [ ] Run installer: `./install-k3s-worker.sh`
- [ ] Enter master private IP when prompted: `________________`
- [ ] Enter join token when prompted
- [ ] Wait for installation to complete (~1 minute)
- [ ] On master, verify: `sudo k3s kubectl get nodes` shows both nodes as Ready

**Estimated time**: 2-3 minutes

**Documentation**: `docs/OCI-SETUP.md` (Step 5.3)

---

### Phase 6: Local kubectl Access
- [ ] On your local machine, in the satvis repo:
  ```bash
  ./scripts/configure-kubectl.sh
  ```
- [ ] Enter master public IP when prompted
- [ ] Enter SSH key path (or press Enter for default)
- [ ] Verify connection: `kubectl get nodes`
- [ ] Check all system pods: `kubectl get pods -A`

**Estimated time**: 2 minutes

**Documentation**: `docs/OCI-SETUP.md` (Step 6)

---

## 🌐 SatVis Application Deployment

### Phase 7: Deploy SatVis
- [ ] On your local machine, from repo root:
  ```bash
  ./scripts/deploy-satvis.sh
  ```
- [ ] Follow prompts:
  - [ ] Enter domain name (or press Enter for IP-based access)
- [ ] Wait for deployment to complete (~2-3 minutes)
- [ ] Note the access URL shown: `________________`
- [ ] Verify deployment:
  ```bash
  kubectl get all -n satvis
  kubectl get ingress -n satvis
  ```
- [ ] Check pods are running: `kubectl get pods -n satvis -w`
- [ ] Wait for initial TLE update to complete:
  ```bash
  kubectl logs -n satvis -l component=tle-updater -f
  ```

**Estimated time**: 5 minutes

**Documentation**: `k8s/README.md` (OCI Deployment section)

---

### Phase 8: Test Application
- [ ] Access SatVis at: `http://<ACCESS_URL>`
- [ ] Verify application loads
- [ ] Check satellites are displayed
- [ ] Test search functionality
- [ ] Verify TLE data is loading (check console for errors)
- [ ] Test on mobile (PWA features)

**Estimated time**: 5 minutes

---

## 📊 Monitoring Setup (Optional but Recommended)

### Phase 9: Install Monitoring Stack
- [ ] Install Helm 3 (if not already):
  ```bash
  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  ```
- [ ] Add Prometheus repo:
  ```bash
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
  helm repo update
  ```
- [ ] Install kube-prometheus-stack:
  ```bash
  helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
    --create-namespace \
    --namespace monitoring \
    -f monitoring/values.yaml
  ```
- [ ] Wait for all monitoring pods to be ready (~2 minutes):
  ```bash
  kubectl get pods -n monitoring -w
  ```
- [ ] Deploy SatVis alerts:
  ```bash
  kubectl apply -f monitoring/satvis-alerts.yaml
  ```

**Estimated time**: 5 minutes

**Documentation**: `docs/MONITORING.md`

---

### Phase 10: Access Grafana
- [ ] Port-forward Grafana:
  ```bash
  kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
  ```
- [ ] Open browser: http://localhost:3000
- [ ] Log in:
  - Username: `admin`
  - Password: `changeme` (or check `monitoring/values.yaml`)
- [ ] Navigate to Dashboards → SatVis Application Dashboard
- [ ] Verify metrics are displaying
- [ ] Check alerts: Alerting → Alert rules → Filter namespace: satvis

**Alternative**: Deploy Grafana ingress for external access (see `docs/MONITORING.md`)

**Estimated time**: 5 minutes

---

## ✅ Post-Deployment Verification

### Phase 11: Health Checks
- [ ] Check all SatVis pods are running:
  ```bash
  kubectl get pods -n satvis
  ```
  Expected: 2+ web pods in Running state

- [ ] Check HPA status:
  ```bash
  kubectl get hpa -n satvis
  ```
  Expected: Shows current replicas (should be 2)

- [ ] Check TLE CronJob:
  ```bash
  kubectl get cronjob -n satvis
  ```
  Expected: satvis-tle-updater scheduled for 3:00 AM UTC

- [ ] Check persistent volume:
  ```bash
  kubectl get pvc -n satvis
  ```
  Expected: satvis-tle-data Bound with 1Gi

- [ ] Check ingress:
  ```bash
  kubectl get ingress -n satvis
  ```
  Expected: Shows your domain or IP

- [ ] Test health endpoint:
  ```bash
  curl http://<ACCESS_URL>/health
  ```
  Expected: "healthy"

**Estimated time**: 5 minutes

---

### Phase 12: Load Testing (Optional)
- [ ] Generate load to test auto-scaling:
  ```bash
  kubectl run -it --rm load-generator --image=busybox \
    --namespace=satvis \
    -- /bin/sh -c "while true; do wget -q -O- http://satvis-web; done"
  ```
- [ ] In another terminal, watch HPA scale:
  ```bash
  kubectl get hpa -n satvis -w
  ```
- [ ] Watch pods scale up:
  ```bash
  kubectl get pods -n satvis -w
  ```
- [ ] Stop load generator (Ctrl+C)
- [ ] Watch pods scale down after ~5 minutes

**Estimated time**: 10-15 minutes

---

## 🎉 Deployment Complete!

### Summary
- [x] OCI account created and configured
- [x] K3s cluster running on free tier ARM instances
- [x] SatVis application deployed and accessible
- [x] Auto-scaling configured (2-10 replicas)
- [x] TLE updates scheduled daily
- [x] Monitoring stack installed (optional)
- [x] All health checks passing

### Access Information
- **Application URL**: `________________`
- **Grafana URL**: `________________` (or via port-forward)
- **Master Node IP**: `________________`
- **kubectl config**: `~/.kube/config-oci`

### Daily Operations
- **TLE updates**: Automatic at 3:00 AM UTC
- **Auto-scaling**: Automatic based on CPU/memory
- **Monitoring**: Access Grafana to view metrics
- **Updates**: Push to master → automatic image build → manual rollout

### Useful Commands
```bash
# View logs
kubectl logs -n satvis -l component=web --tail=50 -f

# Check HPA status
kubectl describe hpa -n satvis

# Manual TLE update
kubectl create job -n satvis --from=cronjob/satvis-tle-updater manual-update-$(date +%s)

# Restart deployment
kubectl rollout restart deployment/satvis-web -n satvis

# Check monitoring
kubectl get pods -n monitoring
```

### Cost
**$0/month** - All resources within OCI Always Free tier

### Next Steps
- [ ] Set up domain DNS (if using custom domain)
- [ ] Configure SSL/TLS with cert-manager (see `k8s/README.md`)
- [ ] Set up AlertManager notifications (see `docs/MONITORING.md`)
- [ ] Configure backups for PVC data (optional)

---

## 🆘 Troubleshooting

**Pods not starting?**
- Check `kubectl describe pod -n satvis <pod-name>`
- Verify images are accessible: `docker pull ghcr.io/anttikuosmanen-rgb/satvis/web:latest`

**Can't access application?**
- Check security list has ports 80, 443 open
- Verify ingress: `kubectl get ingress -n satvis`
- Check nginx ingress logs: `kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller`

**HPA not scaling?**
- Verify metrics server: `kubectl get deployment metrics-server -n kube-system`
- Check metrics: `kubectl top pods -n satvis`

**TLE updates failing?**
- Check job logs: `kubectl logs -n satvis -l component=tle-updater`
- Verify outbound internet access from cluster

**Monitoring not showing data?**
- Check Prometheus targets: Port-forward 9090, visit /targets
- Verify Grafana datasource configuration

---

## 📚 Documentation References
- **OCI Setup**: `docs/OCI-SETUP.md`
- **Kubernetes Deployment**: `k8s/README.md`
- **Monitoring**: `docs/MONITORING.md`
- **Troubleshooting**: See documentation files above

**Total estimated deployment time**: 1-2 hours (first time)
**Subsequent deployments**: ~15 minutes (scripts automate most steps)
