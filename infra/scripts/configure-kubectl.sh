#!/bin/bash
# Configure local kubectl access to K3s cluster on OCI
# Run this script on your local machine

set -e

echo "======================================"
echo "Configure kubectl for K3s on OCI"
echo "======================================"
echo

# Prompt for master information
read -p "Enter master node public IP: " MASTER_IP
read -p "Enter SSH key path [~/.ssh/id_rsa]: " SSH_KEY
SSH_KEY=${SSH_KEY:-~/.ssh/id_rsa}

if [ -z "$MASTER_IP" ]; then
    echo "Error: Master IP is required!"
    exit 1
fi

echo
echo "Master IP: $MASTER_IP"
echo "SSH Key: $SSH_KEY"
echo

# Create .kube directory if it doesn't exist
mkdir -p ~/.kube

# Copy kubeconfig from master
echo "[1/3] Copying kubeconfig from master node..."
scp -i "$SSH_KEY" ubuntu@${MASTER_IP}:/etc/rancher/k3s/k3s.yaml ~/.kube/config-oci

# Replace localhost with master public IP
echo "[2/3] Updating kubeconfig with master public IP..."
sed -i.bak "s/127.0.0.1/${MASTER_IP}/g" ~/.kube/config-oci

# Set kubeconfig environment variable
echo "[3/3] Setting up kubectl access..."
export KUBECONFIG=~/.kube/config-oci

# Test connection
echo
echo "Testing connection..."
if kubectl get nodes; then
    echo
    echo "======================================"
    echo "kubectl Configuration Complete!"
    echo "======================================"
    echo
    echo "To use this cluster, run:"
    echo "  export KUBECONFIG=~/.kube/config-oci"
    echo
    echo "Or merge with existing config:"
    echo "  KUBECONFIG=~/.kube/config:~/.kube/config-oci kubectl config view --flatten > ~/.kube/config-merged"
    echo "  mv ~/.kube/config-merged ~/.kube/config"
    echo
else
    echo
    echo "Error: Could not connect to cluster!"
    echo "Please check:"
    echo "1. Master IP is correct and accessible"
    echo "2. Port 6443 is open in OCI security list"
    echo "3. K3s is running on master node"
    exit 1
fi
