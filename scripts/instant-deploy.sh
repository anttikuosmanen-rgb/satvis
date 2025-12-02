#!/bin/bash
# Instant deployment script - run this immediately when instances are ready
# This script automates the entire deployment process

set -e  # Exit on error

echo "🚀 SatVis Instant Deployment"
echo "=============================="
echo ""

# Check if master IP is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <master-ip> [worker-ip]"
    echo "Example: $0 130.61.123.45 130.61.123.46"
    exit 1
fi

MASTER_IP=$1
WORKER_IP=$2

echo "📍 Master IP: $MASTER_IP"
if [ -n "$WORKER_IP" ]; then
    echo "📍 Worker IP: $WORKER_IP"
fi
echo ""

# Step 1: Install K3s on master
echo "1️⃣  Installing K3s on master node..."
ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no ubuntu@$MASTER_IP << 'EOF'
    curl -sfL https://get.k3s.io | sh -s - server \
        --write-kubeconfig-mode 644 \
        --disable traefik \
        --node-name satvis-master

    # Wait for K3s to be ready
    until kubectl get nodes 2>/dev/null; do sleep 2; done
    echo "✅ K3s master ready"

    # Get join token
    sudo cat /var/lib/rancher/k3s/server/node-token
EOF

# Capture the token
echo "📋 Getting join token..."
TOKEN=$(ssh -i ~/.ssh/id_rsa ubuntu@$MASTER_IP "sudo cat /var/lib/rancher/k3s/server/node-token")
MASTER_PRIVATE_IP=$(ssh -i ~/.ssh/id_rsa ubuntu@$MASTER_IP "hostname -I | awk '{print \$1}'")

echo "✅ Master installed"
echo ""

# Step 2: Install K3s on worker (if provided)
if [ -n "$WORKER_IP" ]; then
    echo "2️⃣  Installing K3s on worker node..."
    ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no ubuntu@$WORKER_IP << EOF
        curl -sfL https://get.k3s.io | K3S_URL=https://${MASTER_PRIVATE_IP}:6443 K3S_TOKEN=${TOKEN} sh -s - agent \
            --node-name satvis-worker-1
EOF
    echo "✅ Worker installed"
    echo ""
fi

# Step 3: Configure local kubectl
echo "3️⃣  Configuring local kubectl..."
mkdir -p ~/.kube
scp -i ~/.ssh/id_rsa ubuntu@$MASTER_IP:/etc/rancher/k3s/k3s.yaml ~/.kube/satvis-config
sed -i.bak "s/127.0.0.1/${MASTER_IP}/g" ~/.kube/satvis-config
export KUBECONFIG=~/.kube/satvis-config
echo "✅ kubectl configured"
echo ""

# Step 4: Wait for nodes to be ready
echo "4️⃣  Waiting for nodes to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s
echo "✅ All nodes ready"
echo ""

# Step 5: Deploy SatVis
echo "5️⃣  Deploying SatVis application..."
cd "$(dirname "$0")/../k8s"

# Apply in order
kubectl apply -f namespace.yaml
kubectl apply -f pvc.yaml
kubectl apply -f configmap.yaml
kubectl apply -f cronjob-tle.yaml
kubectl apply -f deployment-web.yaml
kubectl apply -f service.yaml
kubectl apply -f hpa.yaml
kubectl apply -f ingress.yaml

echo "⏳ Waiting for deployment to be ready..."
kubectl wait --for=condition=Available deployment/satvis-web -n satvis --timeout=300s
echo "✅ Deployment ready"
echo ""

# Step 6: Install monitoring
echo "6️⃣  Installing monitoring stack..."
# Install Helm if not present
if ! command -v helm &> /dev/null; then
    echo "📦 Installing Helm..."
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

# Add Prometheus helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install kube-prometheus-stack
helm install prometheus prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --create-namespace \
    --set prometheus.prometheusSpec.retention=7d \
    --set grafana.adminPassword=satvis-admin \
    --wait

echo "✅ Monitoring installed"
echo ""

# Step 7: Display status
echo "🎉 DEPLOYMENT COMPLETE!"
echo "======================"
echo ""
echo "📊 Application Status:"
kubectl get pods -n satvis
echo ""
echo "🌐 Access Information:"
echo "  - Application: http://$MASTER_IP"
echo "  - Grafana: http://$MASTER_IP:30090 (admin/satvis-admin)"
echo "  - Prometheus: http://$MASTER_IP:30091"
echo ""
echo "🔧 Useful Commands:"
echo "  - View pods: kubectl get pods -n satvis"
echo "  - View logs: kubectl logs -n satvis deployment/satvis-web"
echo "  - Scale app: kubectl scale deployment/satvis-web -n satvis --replicas=3"
echo ""
echo "📝 Next Steps:"
echo "  1. Set up domain/DNS pointing to $MASTER_IP"
echo "  2. Configure SSL with cert-manager"
echo "  3. Review Grafana dashboards"
echo ""
