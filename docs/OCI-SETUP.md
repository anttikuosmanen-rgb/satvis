# Oracle Cloud Infrastructure (OCI) Setup Guide for SatVis

This guide walks you through setting up a free Kubernetes cluster on Oracle Cloud Infrastructure using their Always Free tier.

## Prerequisites

- Oracle Cloud account (free tier)
- SSH key pair
- Basic knowledge of Linux/command line

## Oracle Cloud Free Tier Resources

OCI Always Free tier includes:
- **4 ARM-based Ampere A1 cores** (flexibly allocatable)
- **24 GB RAM** (flexibly allocatable)
- **200 GB block storage**
- **10 TB outbound data transfer per month**
- **Networking and Load Balancers**

All completely free, forever (as of 2025).

---

## Step 1: Create Oracle Cloud Account

1. Go to https://www.oracle.com/cloud/free/
2. Click "Start for free"
3. Fill in your information:
   - Email address
   - Country/Territory
   - First and last name
4. Verify your email
5. Complete identity verification (requires credit card, but won't charge for free tier)
6. **Choose your home region** (IMPORTANT: can't change later)
   - Choose the region closest to you or your users
   - Recommended: Check which regions have ARM instance availability
   - Popular choices: us-ashburn-1, eu-frankfurt-1, ap-tokyo-1

7. Wait for account activation (usually instant, can take up to 24 hours)

---

## Step 2: Create Virtual Cloud Network (VCN)

### 2.1 Navigate to Networking

1. Log in to OCI Console: https://cloud.oracle.com/
2. Click the hamburger menu (≡) → **Networking** → **Virtual Cloud Networks**
3. Make sure you're in your home region (top right corner)

### 2.2 Create VCN with Wizard

1. Click **Start VCN Wizard**
2. Select **Create VCN with Internet Connectivity**
3. Click **Start VCN Wizard**
4. Configure:
   - **VCN Name**: `satvis-vcn`
   - **Compartment**: Select your compartment (or use root)
   - **VCN CIDR Block**: `10.0.0.0/16`
   - **Public Subnet CIDR Block**: `10.0.0.0/24`
   - **Private Subnet CIDR Block**: `10.0.1.0/24`
5. Click **Next** → **Create**
6. Wait for creation to complete, then click **View VCN**

### 2.3 Configure Security List

The wizard creates a default security list, but we need to add rules for Kubernetes:

1. In your VCN, click **Security Lists** → **Default Security List**
2. Click **Add Ingress Rules** and add the following:

**For SSH:**
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `22`
- Description: `SSH access`

**For HTTP:**
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `80`
- Description: `HTTP web traffic`

**For HTTPS:**
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `443`
- Description: `HTTPS web traffic`

**For Kubernetes API:**
- Source CIDR: `0.0.0.0/0` (or restrict to your IP for security)
- IP Protocol: `TCP`
- Destination Port Range: `6443`
- Description: `Kubernetes API server`

**For K3s metrics (optional):**
- Source CIDR: `10.0.0.0/16` (internal only)
- IP Protocol: `TCP`
- Destination Port Range: `10250`
- Description: `Kubelet metrics`

---

## Step 3: Create Compute Instances

### 3.1 Create Master Node

1. Navigate to **Compute** → **Instances**
2. Click **Create Instance**
3. Configure:
   - **Name**: `k3s-master`
   - **Compartment**: Select your compartment
   - **Placement**: Leave as default (Availability Domain 1)

4. **Image and shape**:
   - Click **Change Image**
   - Select **Ubuntu** → **Canonical Ubuntu 22.04**
   - Click **Select Image**
   - Click **Change Shape**
   - Select **Ampere** (ARM-based)
   - Select **VM.Standard.A1.Flex**
   - **Number of OCPUs**: `2`
   - **Amount of memory (GB)**: `12`
   - Click **Select Shape**

5. **Networking**:
   - **Virtual cloud network**: Select `satvis-vcn`
   - **Subnet**: Select the public subnet
   - **Assign a public IPv4 address**: ✓ Yes

6. **Add SSH keys**:
   - Upload your public SSH key or generate a new pair
   - **Save the private key if generating new!**

7. **Boot volume**:
   - Leave defaults (50 GB is fine)

8. Click **Create**
9. Wait for instance to provision (State: RUNNING)
10. **Note down the public IP address**

### 3.2 Create Worker Node (Optional but Recommended)

Repeat the above process with these differences:
- **Name**: `k3s-worker-1`
- **OCPUs**: `2`
- **Memory**: `12 GB`
- **Public IP**: Optional (can use private IP if master is accessible)

**Note**: You can create up to 4 instances total with the free tier (4 OCPUs, 24 GB RAM total). Common configurations:
- **2 nodes**: 2 OCPUs + 12 GB RAM each (1 master, 1 worker)
- **3 nodes**: Distribute resources as needed
- **4 nodes**: 1 OCPU + 6 GB RAM each (1 master, 3 workers)

### 3.3 Verify Instances

1. Navigate to **Compute** → **Instances**
2. Verify all instances show **Running** state
3. Note down all public/private IPs
4. Test SSH access:

```bash
ssh -i ~/.ssh/your-key ubuntu@<master-public-ip>
```

---

## Step 4: Prepare Instances for K3s

### 4.1 Update and Configure Master Node

SSH into the master node:

```bash
ssh -i ~/.ssh/your-key ubuntu@<master-public-ip>
```

Update the system:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git
```

Configure firewall (if using UFW):

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 6443/tcp  # K3s API
sudo ufw allow 10250/tcp # Kubelet
sudo ufw enable
```

### 4.2 Update and Configure Worker Node(s)

Repeat the above on all worker nodes.

---

## Step 5: Install K3s

### 5.1 Install K3s on Master Node

SSH to the master node and run:

```bash
curl -sfL https://get.k3s.io | sh -s - server \
  --disable traefik \
  --write-kubeconfig-mode 644 \
  --node-external-ip <master-public-ip>
```

**Flags explained:**
- `--disable traefik`: We'll use nginx ingress instead
- `--write-kubeconfig-mode 644`: Allow non-root access to kubeconfig
- `--node-external-ip`: Use public IP for external access

Wait for installation to complete (~30 seconds).

Verify installation:

```bash
sudo k3s kubectl get nodes
```

You should see the master node in Ready state.

### 5.2 Get Join Token

On the master node, get the join token for worker nodes:

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

**Save this token** - you'll need it for worker nodes.

Also note the master's private IP:

```bash
hostname -I
```

### 5.3 Install K3s on Worker Node(s)

SSH to each worker node and run:

```bash
curl -sfL https://get.k3s.io | K3S_URL=https://<master-private-ip>:6443 \
  K3S_TOKEN=<token-from-master> sh -
```

Replace `<master-private-ip>` with the master's private IP (starts with 10.0.0.x) and `<token-from-master>` with the token from step 5.2.

Wait for installation to complete.

### 5.4 Verify Cluster

On the master node:

```bash
sudo k3s kubectl get nodes
```

You should see all nodes in Ready state:

```
NAME           STATUS   ROLES                  AGE   VERSION
k3s-master     Ready    control-plane,master   5m    v1.28.x+k3s1
k3s-worker-1   Ready    <none>                 2m    v1.28.x+k3s1
```

---

## Step 6: Configure Local kubectl Access

### 6.1 Copy Kubeconfig from Master

On your local machine:

```bash
# Create kubernetes config directory if it doesn't exist
mkdir -p ~/.kube

# Copy kubeconfig from master
scp -i ~/.ssh/your-key ubuntu@<master-public-ip>:/etc/rancher/k3s/k3s.yaml ~/.kube/config-oci

# Edit the config to use master's public IP
sed -i.bak 's/127.0.0.1/<master-public-ip>/g' ~/.kube/config-oci

# Set as active kubeconfig
export KUBECONFIG=~/.kube/config-oci

# Or merge with existing config
KUBECONFIG=~/.kube/config:~/.kube/config-oci kubectl config view --flatten > ~/.kube/config-merged
mv ~/.kube/config-merged ~/.kube/config
```

### 6.2 Verify Access

```bash
kubectl get nodes
kubectl get pods -A
```

You should see your cluster nodes and system pods.

---

## Step 7: Install Nginx Ingress Controller

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
```

Wait for ingress controller to be ready:

```bash
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

Verify:

```bash
kubectl get pods -n ingress-nginx
kubectl get svc -n ingress-nginx
```

**Note**: On OCI free tier, the LoadBalancer service will stay in `<pending>` state since you need a paid load balancer. The ingress will work via NodePort instead.

---

## Step 8: Install Metrics Server (Required for HPA)

K3s comes with metrics-server, but verify it's running:

```bash
kubectl get deployment metrics-server -n kube-system
```

If not present, install it:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

---

## Next Steps

Your K3s cluster on OCI is now ready! Proceed to:

1. **Deploy SatVis**: See `k8s/README.md`
2. **Set up Monitoring**: See `docs/MONITORING.md`
3. **Configure DNS**: Point your domain to the master's public IP

---

## Troubleshooting

### Can't Get ARM Instances

ARM instance availability varies by region and time. If you get "Out of host capacity" errors:

1. Try a different Availability Domain within your region
2. Try a different region (requires new account)
3. Try at different times of day
4. Try requesting smaller instances (1 OCPU instead of 2)

### Can't SSH to Instances

1. Check Security List has port 22 open
2. Verify you're using the correct private key
3. Check instance is in RUNNING state
4. Try connecting from OCI Cloud Shell (in OCI console)

### K3s Installation Fails

1. Check instance has outbound internet access
2. Verify firewall rules aren't blocking K3s ports
3. Check system logs: `sudo journalctl -u k3s`

### Worker Node Won't Join

1. Verify master private IP is correct (use `10.0.0.x`, not public IP)
2. Check token is correct
3. Ensure port 6443 is accessible from worker to master
4. Check worker logs: `sudo journalctl -u k3s-agent`

---

## Cost Monitoring

The resources in this guide are all Always Free. To verify you're not being charged:

1. Go to **Billing & Cost Management** in OCI Console
2. Check **Cost Analysis**
3. Verify all resources show as "Always Free"

---

## Security Recommendations

1. **Restrict Kubernetes API access**: Change security list rule for port 6443 to your IP only
2. **Use SSH bastion**: Keep worker nodes private, access via master
3. **Enable OCI Cloud Guard**: Automatic security monitoring
4. **Regular updates**: Keep Ubuntu and K3s updated
5. **Backup kubeconfig**: Store your kubeconfig securely

---

## Additional Resources

- [OCI Free Tier Documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [K3s Documentation](https://docs.k3s.io/)
- [OCI Compute Documentation](https://docs.oracle.com/en-us/iaas/Content/Compute/home.htm)
- [ARM Instance Guide](https://learn.arm.com/learning-paths/servers-and-cloud-computing/csp/oci/)
