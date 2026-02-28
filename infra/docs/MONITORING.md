# Monitoring Setup for SatVis on Kubernetes

This guide walks through installing and configuring Prometheus and Grafana monitoring for your SatVis Kubernetes deployment.

## Overview

The monitoring stack includes:
- **Prometheus**: Metrics collection and storage
- **Grafana**: Visualization dashboards
- **AlertManager**: Alert notifications
- **Node Exporter**: Node-level metrics
- **Kube State Metrics**: Kubernetes object metrics
- **Custom Alerts**: SatVis-specific alerting rules
- **Custom Dashboard**: SatVis application dashboard

## Prerequisites

- SatVis deployed to Kubernetes (see `k8s/README.md`)
- Helm 3 installed
- kubectl configured

## Quick Start

### 1. Install Helm (if not already installed)

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

Verify installation:

```bash
helm version
```

### 2. Add Prometheus Helm Repository

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

### 3. Install kube-prometheus-stack

```bash
# Install from repository root
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --create-namespace \
  --namespace monitoring \
  -f monitoring/values.yaml
```

This will install:
- Prometheus server
- Grafana
- AlertManager
- Node exporters
- Kube-state-metrics
- Prometheus operator

### 4. Wait for Pods to be Ready

```bash
kubectl get pods -n monitoring -w
```

Wait until all pods show `Running` status (takes 1-2 minutes).

### 5. Deploy SatVis Monitoring Configuration

```bash
# Deploy custom alerts
kubectl apply -f monitoring/satvis-alerts.yaml

# Deploy Grafana ingress (optional)
kubectl apply -f monitoring/grafana-ingress.yaml
```

---

## Accessing Grafana

### Option 1: Port Forward (Quick Access)

```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
```

Access Grafana at: http://localhost:3000

**Default credentials**:
- Username: `admin`
- Password: `changeme` (or check `monitoring/values.yaml`)

### Option 2: Ingress (Recommended for Production)

1. Edit `monitoring/grafana-ingress.yaml` and update the domain:

```yaml
spec:
  rules:
  - host: grafana.your-domain.com  # Change this
```

2. Apply the ingress:

```bash
kubectl apply -f monitoring/grafana-ingress.yaml
```

3. Point your DNS to the Kubernetes cluster IP

4. Access Grafana at: `http://grafana.your-domain.com`

---

## Viewing SatVis Dashboard

1. Log in to Grafana
2. Navigate to **Dashboards** → **Browse**
3. Open **SatVis Application Dashboard**

The dashboard shows:
- Available pod count
- Current HPA replica count
- TLE update job status
- Pod CPU usage over time
- Pod memory usage over time
- HPA scaling history
- Pod restart rate

---

## Understanding the Metrics

### Pod Metrics

**Available Pods**:
- Shows number of ready web pods
- Should be ≥ 2 (minimum replicas)
- Red if 0 (alert triggered)

**CPU Usage**:
- Per-pod CPU utilization
- Normal: 10-30% under light load
- Spikes during auto-scaling expected
- Alert if consistently > 70%

**Memory Usage**:
- Per-pod memory consumption
- Should be < 200MB per pod
- Alert if > 80% of limit (204MB)

### HPA Metrics

**Current Replicas**:
- Number of pods currently running
- Changes based on load
- Green: 2-6, Yellow: 7-9, Red: 10 (maxed out)

**Scaling History**:
- Shows replica count over time
- Current, desired, min, max replicas
- Helps identify scaling patterns

### TLE Update Metrics

**Last TLE Update Status**:
- 0 (Success - Green)
- 1 (Failed - Red)
- Updated daily at 3:00 AM UTC

---

## Alerts

### Configured Alerts

The following alerts are configured in `monitoring/satvis-alerts.yaml`:

1. **SatVisNoPodsRunning** (Critical)
   - Triggers when: No web pods available for 2+ minutes
   - Action: Check deployment status, investigate pod failures

2. **SatVisPodCrashLooping** (Warning)
   - Triggers when: Pod restarts frequently (> 0 per 15min)
   - Action: Check pod logs, investigate crash cause

3. **SatVisHPAMaxedOut** (Warning)
   - Triggers when: HPA at max replicas for 15+ minutes
   - Action: Consider increasing max replicas or investigating high load

4. **SatVisHighMemoryUsage** (Warning)
   - Triggers when: Pod using > 80% of memory limit for 10+ minutes
   - Action: Increase memory limits or investigate memory leaks

5. **SatVisTLEUpdateNotRunning** (Warning)
   - Triggers when: No successful TLE update in 25+ hours
   - Action: Check CronJob status, manually trigger update

6. **SatVisTLEUpdateFailed** (Warning)
   - Triggers when: TLE update job fails
   - Action: Check job logs, verify network connectivity

7. **SatVisPVCAlmostFull** (Warning)
   - Triggers when: PVC has < 10% free space
   - Action: Increase PVC size or clean old TLE data

8. **SatVisDeploymentReplicasMismatch** (Warning)
   - Triggers when: Available replicas ≠ desired replicas for 10+ minutes
   - Action: Check pod status, investigate scheduling issues

### Viewing Alerts

**In Grafana**:
1. Navigate to **Alerting** → **Alert rules**
2. Filter by namespace: `satvis`

**In Prometheus**:
```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
```
Access Prometheus at: http://localhost:9090

Go to **Alerts** tab to see active/pending alerts.

### Configuring Alert Notifications

To receive alerts via email, Slack, or other channels, configure AlertManager:

1. Edit `monitoring/values.yaml` and add AlertManager config:

```yaml
alertmanager:
  config:
    global:
      resolve_timeout: 5m
    route:
      group_by: ['alertname', 'namespace']
      group_wait: 10s
      group_interval: 10s
      repeat_interval: 12h
      receiver: 'email'
    receivers:
    - name: 'email'
      email_configs:
      - to: 'your-email@example.com'
        from: 'alertmanager@example.com'
        smarthost: 'smtp.example.com:587'
        auth_username: 'alertmanager@example.com'
        auth_password: 'your-password'
```

2. Update the stack:

```bash
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f monitoring/values.yaml
```

---

## Custom Queries

### Useful Prometheus Queries

Access Prometheus at: http://localhost:9090 (via port-forward)

**Pod CPU usage**:
```promql
sum(rate(container_cpu_usage_seconds_total{namespace="satvis",pod=~"satvis-web-.*"}[5m])) by (pod) * 100
```

**Pod memory usage**:
```promql
sum(container_memory_usage_bytes{namespace="satvis",pod=~"satvis-web-.*"}) by (pod)
```

**HPA current replicas**:
```promql
kube_horizontalpodautoscaler_status_current_replicas{namespace="satvis"}
```

**TLE update success rate (24h)**:
```promql
sum(kube_job_status_succeeded{namespace="satvis",job_name=~"satvis-tle-updater-.*"}) /
(sum(kube_job_status_succeeded{namespace="satvis",job_name=~"satvis-tle-updater-.*"}) +
sum(kube_job_status_failed{namespace="satvis",job_name=~"satvis-tle-updater-.*"}))
```

**Pod restart count (1h)**:
```promql
sum(rate(kube_pod_container_status_restarts_total{namespace="satvis"}[1h])) by (pod)
```

---

## Resource Usage

The monitoring stack itself uses resources. On OCI free tier:

**Prometheus**:
- CPU: 200m request, 1000m limit
- Memory: 512Mi request, 2Gi limit
- Storage: 10Gi (adjust in `values.yaml`)

**Grafana**:
- CPU: 100m request, 500m limit
- Memory: 256Mi request, 512Mi limit
- Storage: 5Gi

**Total monitoring overhead**:
- ~350m CPU (~8% of 4 cores)
- ~800Mi RAM (~3% of 24GB)
- ~15Gi storage

This leaves plenty of resources for SatVis and system pods.

---

## Troubleshooting

### Prometheus Not Scraping Metrics

Check Prometheus targets:
```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
```

Go to http://localhost:9090/targets

All targets should show "UP".

### Grafana Dashboard Shows "No Data"

1. Verify Prometheus is collecting metrics (see above)
2. Check datasource configuration in Grafana:
   - **Configuration** → **Data Sources** → **Prometheus**
   - URL should be: `http://kube-prometheus-stack-prometheus:9090`
   - Click **Save & Test**

### AlertManager Not Sending Alerts

1. Check AlertManager status:
```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-alertmanager 9093:9093
```
Access at: http://localhost:9093

2. Verify alerts are firing in Prometheus first
3. Check AlertManager configuration in `values.yaml`

### High Resource Usage

If monitoring uses too much resources:

1. Reduce Prometheus retention:
```yaml
prometheus:
  prometheusSpec:
    retention: 3d  # Instead of 7d
    retentionSize: "4GB"  # Instead of 8GB
```

2. Reduce scrape frequency (edit `values.yaml`):
```yaml
prometheus:
  prometheusSpec:
    scrapeInterval: 60s  # Instead of 30s
```

3. Update the stack:
```bash
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f monitoring/values.yaml
```

---

## Updating the Monitoring Stack

To update to the latest version:

```bash
helm repo update
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f monitoring/values.yaml
```

---

## Uninstalling Monitoring

To completely remove the monitoring stack:

```bash
helm uninstall kube-prometheus-stack -n monitoring
kubectl delete namespace monitoring
```

**Note**: This will delete all metrics history and dashboards.

---

## Additional Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [kube-prometheus-stack Chart](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack)
- [Prometheus Operator](https://prometheus-operator.dev/)
- [AlertManager Configuration](https://prometheus.io/docs/alerting/latest/configuration/)

---

## Next Steps

After setting up monitoring:

1. **Configure alerts**: Update AlertManager config in `values.yaml` for notifications
2. **Create custom dashboards**: Build dashboards for specific metrics you care about
3. **Set up SSL**: Use cert-manager for HTTPS access to Grafana
4. **Backup configuration**: Export Grafana dashboards and store in version control
5. **Monitor costs**: Keep an eye on storage usage (metrics retention)
