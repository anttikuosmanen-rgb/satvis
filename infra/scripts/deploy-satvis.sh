#!/bin/bash
# Deploy SatVis to Kubernetes cluster
# Run this script from the repository root

set -e

echo "======================================"
echo "Deploy SatVis to Kubernetes"
echo "======================================"
echo

# Check if kubectl is configured
if ! kubectl get nodes &> /dev/null; then
    echo "Error: kubectl is not configured or cluster is not accessible!"
    echo "Run configure-kubectl.sh first."
    exit 1
fi

echo "Cluster nodes:"
kubectl get nodes
echo

# Prompt for domain or use IP
read -p "Enter your domain name (or press Enter to use IP-based access): " DOMAIN

if [ -n "$DOMAIN" ]; then
    echo "Using domain: $DOMAIN"
    # Update ingress with domain
    sed -i.bak "s/satvis.example.com/$DOMAIN/g" k8s/ingress.yaml
else
    echo "Using IP-based access (removing host field from ingress)"
    # Remove host field from ingress
    sed -i.bak '/host:/d' k8s/ingress.yaml
fi

echo

# Deploy nginx ingress controller
echo "[1/5] Installing nginx ingress controller..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml

echo "Waiting for ingress controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

# Deploy SatVis
echo
echo "[2/5] Creating namespace and configmap..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

echo
echo "[3/5] Creating persistent volume claim..."
kubectl apply -f k8s/pvc.yaml

echo
echo "[4/5] Deploying SatVis application..."
kubectl apply -f k8s/deployment-web.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml

echo
echo "[5/5] Deploying TLE updater and HPA..."
kubectl apply -f k8s/cronjob-tle.yaml
kubectl apply -f k8s/hpa.yaml

# Wait for deployment
echo
echo "Waiting for deployment to be ready..."
kubectl wait --namespace satvis \
  --for=condition=available deployment/satvis-web \
  --timeout=120s

# Run initial TLE update
echo
echo "Running initial TLE data update..."
kubectl create job -n satvis --from=cronjob/satvis-tle-updater initial-tle-update || true

echo
echo "======================================"
echo "SatVis Deployment Complete!"
echo "======================================"
echo

# Show status
echo "Deployment status:"
kubectl get all -n satvis

echo
echo "Ingress:"
kubectl get ingress -n satvis

echo
echo "Access SatVis at:"
if [ -n "$DOMAIN" ]; then
    echo "  http://$DOMAIN"
    echo
    echo "Make sure to point your domain's DNS to the master node IP:"
    kubectl get nodes -o wide | grep master || kubectl get nodes -o wide | head -2
else
    MASTER_IP=$(kubectl get nodes -o wide | grep -v NAME | head -1 | awk '{print $6}')
    echo "  http://$MASTER_IP"
fi

echo
echo "To monitor the deployment:"
echo "  kubectl get pods -n satvis -w"
echo "  kubectl logs -n satvis -l component=web"
echo "  kubectl describe hpa -n satvis"
echo
