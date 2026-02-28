#!/bin/bash
# Install K3s on worker node (OCI ARM instance)
# Run this script on each worker node

set -e

echo "======================================"
echo "K3s Worker Node Installation"
echo "======================================"
echo

# Prompt for master information
read -p "Enter master node private IP (10.0.0.x): " MASTER_IP
read -p "Enter K3s join token: " K3S_TOKEN

if [ -z "$MASTER_IP" ] || [ -z "$K3S_TOKEN" ]; then
    echo "Error: Master IP and join token are required!"
    exit 1
fi

echo
echo "Master IP: $MASTER_IP"
echo "Token: ${K3S_TOKEN:0:20}..."
echo

# Update system
echo "[1/3] Updating system packages..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget

# Configure firewall
echo "[2/3] Configuring firewall..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 22/tcp    # SSH
    sudo ufw allow 10250/tcp # Kubelet
    sudo ufw --force enable
    echo "Firewall configured"
else
    echo "UFW not installed, skipping firewall configuration"
fi

# Install K3s agent
echo "[3/3] Installing K3s agent..."
curl -sfL https://get.k3s.io | K3S_URL=https://${MASTER_IP}:6443 \
  K3S_TOKEN="${K3S_TOKEN}" sh -

# Wait for agent to be ready
echo "Waiting for K3s agent to be ready..."
sleep 10

echo
echo "======================================"
echo "K3s Worker Installation Complete!"
echo "======================================"
echo
echo "Verify on master node by running:"
echo "  sudo k3s kubectl get nodes"
echo
