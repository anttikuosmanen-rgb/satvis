#!/bin/bash
# Install K3s on master node (OCI ARM instance)
# Run this script on the master node

set -e

echo "======================================"
echo "K3s Master Node Installation"
echo "======================================"
echo

# Get public IP (for external access)
PUBLIC_IP=$(curl -s http://169.254.169.254/opc/v1/instance/ | grep -o '"publicIp":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -z "$PUBLIC_IP" ]; then
    echo "Warning: Could not detect public IP. Please specify it manually:"
    read -p "Enter master node public IP: " PUBLIC_IP
fi

echo "Master public IP: $PUBLIC_IP"
echo

# Update system
echo "[1/4] Updating system packages..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git

# Configure firewall
echo "[2/4] Configuring firewall..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 22/tcp    # SSH
    sudo ufw allow 80/tcp    # HTTP
    sudo ufw allow 443/tcp   # HTTPS
    sudo ufw allow 6443/tcp  # K3s API
    sudo ufw allow 10250/tcp # Kubelet
    sudo ufw --force enable
    echo "Firewall configured"
else
    echo "UFW not installed, skipping firewall configuration"
fi

# Install K3s
echo "[3/4] Installing K3s..."
curl -sfL https://get.k3s.io | sh -s - server \
  --disable traefik \
  --write-kubeconfig-mode 644 \
  --node-external-ip "$PUBLIC_IP"

# Wait for K3s to be ready
echo "Waiting for K3s to be ready..."
sleep 10

# Verify installation
echo "[4/4] Verifying installation..."
sudo k3s kubectl get nodes

echo
echo "======================================"
echo "K3s Master Installation Complete!"
echo "======================================"
echo
echo "Join token for worker nodes:"
echo "----------------------------"
sudo cat /var/lib/rancher/k3s/server/node-token
echo
echo "Master private IP (for worker join):"
echo "------------------------------------"
hostname -I | awk '{print $1}'
echo
echo "Next steps:"
echo "1. Copy the join token above"
echo "2. Note the master private IP above"
echo "3. Run install-k3s-worker.sh on worker nodes"
echo "4. Copy kubeconfig to your local machine:"
echo "   scp ubuntu@$PUBLIC_IP:/etc/rancher/k3s/k3s.yaml ~/.kube/config-oci"
echo
