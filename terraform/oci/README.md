# SatVis OCI Terraform Deployment

Automated Oracle Cloud Infrastructure deployment using Terraform for the SatVis Kubernetes cluster.

## What This Deploys

**Infrastructure:**
- Virtual Cloud Network (VCN) with internet gateway
- Public subnet with routing and security lists
- 2x ARM Ampere A1 instances (2 vCPUs + 12 GB RAM each)
  - satvis-master: K3s server node
  - satvis-worker-1: K3s agent node
- Security rules for SSH, HTTP, HTTPS, Kubernetes API, and Kubelet

**Cost**: $0/month (uses OCI Always Free tier)

## Prerequisites

1. **OCI Account** with Always Free tier activated
2. **API Keys** generated and configured
3. **SSH Keys** for instance access
4. **Terraform** installed (v1.5+)

## Files

- `main.tf` - Main Terraform configuration
- `variables.tf` - Variable definitions
- `outputs.tf` - Output definitions (IPs, SSH commands)
- `terraform.tfvars` - Your credentials and configuration
- `cloud-init.yaml` - Instance initialization script
- `retry-apply.sh` - Automatic retry script for ARM capacity issues

## Quick Start

### 1. Configure Credentials

Edit `terraform.tfvars` with your OCI credentials:

```hcl
tenancy_ocid     = "ocid1.tenancy.oc1..."
user_ocid        = "ocid1.user.oc1..."
fingerprint      = "xx:xx:xx:..."
private_key_path = "~/.oci/oci_api_key.pem"
region           = "eu-stockholm-1"
ssh_public_key_path = "~/.ssh/id_rsa.pub"
```

### 2. Deploy Infrastructure

**Option A: Standard deployment**
```bash
terraform init
terraform plan
terraform apply
```

**Option B: Auto-retry for ARM capacity issues**
```bash
terraform init
./retry-apply.sh
```

The retry script will automatically retry every 60 seconds until ARM instances are available.

### 3. Get Instance IPs

After successful deployment:

```bash
terraform output
```

Returns:
- Master node public IP
- Worker node public/private IPs
- SSH connection commands

## Configuration Options

Edit `terraform.tfvars` to change instance configuration:

### 2 Instances (Default)
```hcl
instance_count = 2
instance_ocpus = 2
instance_memory_gb = 12
```

### 4 Smaller Instances
```hcl
instance_count = 4
instance_ocpus = 1
instance_memory_gb = 6
```

### Single Large Instance
```hcl
instance_count = 1
instance_ocpus = 4
instance_memory_gb = 24
```

## Handling ARM Capacity Issues

Stockholm region often has limited ARM capacity. Solutions:

**1. Use Retry Script (Recommended)**
```bash
./retry-apply.sh
```

Retries every 60 seconds, up to 100 attempts. Leave running overnight if needed.

**2. Try Smaller Instances**

Edit `terraform.tfvars`:
```hcl
instance_ocpus = 1
instance_memory_gb = 6
```

Smaller instances are easier to allocate.

**3. Try Different Times**

Best times for ARM capacity:
- Early morning (6-8 AM Sweden time)
- Late evening (10 PM - midnight)
- Weekends

## After Deployment

Once instances are created:

1. **Verify instances are running:**
   ```bash
   terraform output ssh_commands
   ```

2. **Install K3s on master:**
   ```bash
   ssh ubuntu@<master-ip>
   curl -O https://raw.githubusercontent.com/anttikuosmanen-rgb/satvis/master/scripts/install-k3s-master.sh
   chmod +x install-k3s-master.sh
   ./install-k3s-master.sh
   ```

3. **Install K3s on worker:**
   ```bash
   ssh ubuntu@<worker-ip>
   curl -O https://raw.githubusercontent.com/anttikuosmanen-rgb/satvis/master/scripts/install-k3s-worker.sh
   chmod +x install-k3s-worker.sh
   ./install-k3s-worker.sh
   # Enter master private IP and join token when prompted
   ```

4. **Configure local kubectl:**
   ```bash
   # From repository root
   ./scripts/configure-kubectl.sh
   # Enter master public IP when prompted
   ```

5. **Deploy SatVis:**
   ```bash
   ./scripts/deploy-satvis.sh
   ```

See `../../docs/DEPLOYMENT-CHECKLIST.md` for full deployment guide.

## Managing Infrastructure

**View current state:**
```bash
terraform show
```

**Update configuration:**
```bash
# Edit terraform.tfvars
terraform plan
terraform apply
```

**Destroy infrastructure:**
```bash
terraform destroy
```

**Note**: This will delete all instances and networking. The VCN you created manually in OCI Console will remain.

## Troubleshooting

### Out of Capacity Error

**Symptoms:**
```
Error: 500-InternalError, Out of host capacity.
```

**Solutions:**
1. Run `./retry-apply.sh` and wait
2. Try smaller instances (1 OCPU + 6 GB)
3. Try at different times (early morning/late evening)
4. Consider alternative regions (requires new account)

### Authentication Errors

**Symptoms:**
```
Error: 401-NotAuthenticated
```

**Solutions:**
1. Verify API key fingerprint matches OCI console
2. Check private key path is correct
3. Ensure API key is active in OCI console

### Network Already Exists

**Symptoms:**
```
Error: 409-Conflict
```

**Solution:**
Either:
- Import existing resources: `terraform import`
- Or use different VCN name in `main.tf`

## Security Notes

- `terraform.tfvars` contains sensitive credentials - **never commit to git**
- API private key should have 600 permissions: `chmod 600 ~/.oci/oci_api_key.pem`
- Security lists allow SSH (port 22) from anywhere - restrict to your IP in production

## Free Tier Limits

OCI Always Free includes:
- **ARM Compute**: 4 OCPUs + 24 GB RAM total
- **Block Storage**: 200 GB total
- **Network**: 10 TB outbound per month
- **Public IPs**: 2 reserved IPs

This deployment uses:
- **4 OCPUs** (2 per instance × 2 instances)
- **24 GB RAM** (12 GB per instance × 2 instances)
- **100 GB storage** (50 GB per instance × 2 instances)
- **2 Public IPs** (1 per instance × 2 instances)

All within free tier limits!

## Next Steps

After infrastructure is deployed:

1. **Install K3s** - See scripts in `../../scripts/`
2. **Deploy SatVis** - See `../../k8s/README.md`
3. **Add Monitoring** - See `../../docs/MONITORING.md`
4. **Configure SSL** - See `../../k8s/README.md` (cert-manager section)

## Additional Resources

- [OCI Free Tier Documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [OCI Terraform Provider](https://registry.terraform.io/providers/oracle/oci/latest/docs)
- [K3s Documentation](https://docs.k3s.io/)
- [Full OCI Setup Guide](../../docs/OCI-SETUP.md)
