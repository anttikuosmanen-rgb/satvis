# SatVis Monitoring Configuration

This directory contains monitoring configuration files for deploying Prometheus and Grafana to monitor your SatVis Kubernetes deployment.

## Files

### `values.yaml`
Helm values for installing kube-prometheus-stack. This file configures:
- Prometheus server with resource limits optimized for OCI free tier
- Grafana with pre-configured datasources
- AlertManager for alert notifications
- Node exporters and kube-state-metrics
- Storage configuration (retention, PVC sizes)

**Usage**:
```bash
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --create-namespace \
  --namespace monitoring \
  -f monitoring/values.yaml
```

### `grafana-ingress.yaml`
Kubernetes Ingress resource for exposing Grafana externally.

**Before applying**:
1. Update the `host` field with your domain
2. Or remove the `host` field for IP-based access

**Usage**:
```bash
kubectl apply -f monitoring/grafana-ingress.yaml
```

### `satvis-servicemonitor.yaml`
ServiceMonitor resource for Prometheus to scrape metrics from SatVis pods.

**Note**: Currently a placeholder. nginx doesn't expose Prometheus metrics by default. To enable detailed nginx metrics, you would need to add nginx-prometheus-exporter as a sidecar.

For now, SatVis monitoring relies on:
- kube-state-metrics (pod status, deployment status, HPA metrics)
- node-exporter (node resources)
- Container metrics (CPU, memory usage)

**Usage**:
```bash
kubectl apply -f monitoring/satvis-servicemonitor.yaml
```

### `satvis-alerts.yaml`
PrometheusRule resource defining custom alerts for SatVis:
- `SatVisNoPodsRunning`: No web pods available
- `SatVisPodCrashLooping`: Frequent pod restarts
- `SatVisHPAMaxedOut`: HPA at maximum replicas
- `SatVisHighMemoryUsage`: Pod using > 80% memory
- `SatVisTLEUpdateNotRunning`: TLE update not running for 25+ hours
- `SatVisTLEUpdateFailed`: TLE update job failed
- `SatVisPVCAlmostFull`: PVC < 10% free space
- `SatVisDeploymentReplicasMismatch`: Desired ≠ available replicas

**Usage**:
```bash
kubectl apply -f monitoring/satvis-alerts.yaml
```

### `satvis-dashboard.json`
Custom Grafana dashboard for visualizing SatVis metrics.

Includes panels for:
- Available pod count (stat)
- Current HPA replicas (stat)
- Last TLE update status (stat)
- Pod CPU usage over time (graph)
- Pod memory usage over time (graph)
- HPA scaling history (graph)
- Pod restart rate (graph)

This dashboard is automatically loaded into Grafana when installed with `values.yaml` (configured in the `dashboards` section).

**To manually import**:
1. Log in to Grafana
2. Go to **Dashboards** → **Import**
3. Upload `satvis-dashboard.json`

## Quick Start

See [`../docs/MONITORING.md`](../docs/MONITORING.md) for complete installation and configuration instructions.

### Minimal Installation

```bash
# 1. Add Helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# 2. Install monitoring stack
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --create-namespace \
  --namespace monitoring \
  -f monitoring/values.yaml

# 3. Deploy SatVis alerts
kubectl apply -f monitoring/satvis-alerts.yaml

# 4. Access Grafana
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
# Open http://localhost:3000
# Username: admin
# Password: changeme (or check values.yaml)
```

## Configuration

### Adjusting Resource Limits

Edit `values.yaml` to adjust resource limits based on your cluster capacity:

```yaml
prometheus:
  prometheusSpec:
    resources:
      requests:
        cpu: 200m      # Increase if needed
        memory: 512Mi  # Increase if needed
```

### Changing Retention Period

```yaml
prometheus:
  prometheusSpec:
    retention: 7d  # Change to 3d, 14d, etc.
```

### Changing Grafana Password

```yaml
grafana:
  adminPassword: "your-secure-password"
```

Then upgrade the release:
```bash
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f monitoring/values.yaml
```

## Resource Usage

Expected resource usage on OCI free tier (4 cores, 24GB RAM):

- **Prometheus**: ~200-1000m CPU, ~512Mi-2Gi RAM, ~10Gi storage
- **Grafana**: ~100-500m CPU, ~256-512Mi RAM, ~5Gi storage
- **AlertManager**: ~50-200m CPU, ~128-256Mi RAM, ~2Gi storage
- **Node Exporters**: ~50-200m CPU per node, ~64-128Mi RAM per node
- **Kube-state-metrics**: ~50-200m CPU, ~128-256Mi RAM

**Total**: ~350m CPU, ~800Mi RAM, ~15Gi storage (leaves plenty for SatVis)

## Troubleshooting

### Dashboard Shows "No Data"

1. Check Prometheus is running:
   ```bash
   kubectl get pods -n monitoring
   ```

2. Check Prometheus targets:
   ```bash
   kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
   ```
   Visit http://localhost:9090/targets - all should be "UP"

3. Verify datasource in Grafana:
   - Configuration → Data Sources → Prometheus
   - Click "Save & Test"

### Alerts Not Firing

1. Check alert rules are loaded:
   ```bash
   kubectl get prometheusrules -n satvis
   ```

2. View alerts in Prometheus:
   ```bash
   kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
   ```
   Visit http://localhost:9090/alerts

3. Check AlertManager:
   ```bash
   kubectl port-forward -n monitoring svc/kube-prometheus-stack-alertmanager 9093:9093
   ```
   Visit http://localhost:9093

## Additional Resources

- [Complete monitoring guide](../docs/MONITORING.md)
- [kube-prometheus-stack documentation](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack)
- [Prometheus query examples](https://prometheus.io/docs/prometheus/latest/querying/examples/)
- [Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/)
