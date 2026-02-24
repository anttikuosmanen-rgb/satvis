terraform {
  required_version = ">= 1.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = pathexpand(var.private_key_path)
  region           = var.region
}

# Get availability domain
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# Get latest Ubuntu 22.04 image for the selected shape
data "oci_core_images" "ubuntu" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# VCN
resource "oci_core_vcn" "satvis_vcn" {
  compartment_id = var.tenancy_ocid
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "${var.project_name}-vcn"
  dns_label      = "satvis"
}

# Internet Gateway
resource "oci_core_internet_gateway" "satvis_igw" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.satvis_vcn.id
  display_name   = "${var.project_name}-igw"
  enabled        = true
}

# Route Table
resource "oci_core_route_table" "satvis_rt" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.satvis_vcn.id
  display_name   = "${var.project_name}-rt"

  route_rules {
    network_entity_id = oci_core_internet_gateway.satvis_igw.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

# Security List
resource "oci_core_security_list" "satvis_sl" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.satvis_vcn.id
  display_name   = "${var.project_name}-sl"

  # Allow all outbound
  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  # SSH
  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
    description = "SSH"
  }

  # HTTP
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 80
      max = 80
    }
    description = "HTTP"
  }

  # HTTPS
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
    description = "HTTPS"
  }

  # Kubernetes API
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 6443
      max = 6443
    }
    description = "Kubernetes API"
  }

  # Kubelet (internal only)
  ingress_security_rules {
    protocol = "6"
    source   = "10.0.0.0/16"
    tcp_options {
      min = 10250
      max = 10250
    }
    description = "Kubelet metrics"
  }
}

# Public Subnet
resource "oci_core_subnet" "satvis_public_subnet" {
  compartment_id    = var.tenancy_ocid
  vcn_id            = oci_core_vcn.satvis_vcn.id
  cidr_block        = "10.0.0.0/24"
  display_name      = "${var.project_name}-public-subnet"
  dns_label         = "public"
  route_table_id    = oci_core_route_table.satvis_rt.id
  security_list_ids = [oci_core_security_list.satvis_sl.id]
}

# Compute Instances (ARM free tier or AMD paid)
resource "oci_core_instance" "k3s_nodes" {
  count               = var.instance_count
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.tenancy_ocid
  display_name        = "${var.project_name}-${count.index == 0 ? "master" : "worker-${count.index}"}"
  shape               = var.instance_shape

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gb
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.satvis_public_subnet.id
    assign_public_ip = true
    display_name     = "${var.project_name}-vnic-${count.index}"
  }

  metadata = {
    ssh_authorized_keys = file(pathexpand(var.ssh_public_key_path))
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
      hostname = "${var.project_name}-${count.index == 0 ? "master" : "worker-${count.index}"}"
    }))
  }

  lifecycle {
    ignore_changes = [source_details[0].source_id]
  }
}
