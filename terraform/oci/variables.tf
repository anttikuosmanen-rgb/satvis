# OCI Provider variables
variable "tenancy_ocid" {
  description = "OCID of your tenancy"
  type        = string
}

variable "user_ocid" {
  description = "OCID of the user"
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint of the API key"
  type        = string
}

variable "private_key_path" {
  description = "Path to your private API key file"
  type        = string
}

variable "region" {
  description = "OCI region"
  type        = string
  default     = "eu-stockholm-1"
}

# SSH Key
variable "ssh_public_key_path" {
  description = "Path to SSH public key"
  type        = string
}

# Instance Configuration
variable "instance_shape" {
  description = "OCI compute shape (VM.Standard.A1.Flex=ARM free tier, VM.Standard.E3.Flex=AMD paid cheap, VM.Standard.E4.Flex=AMD latest)"
  type        = string
  default     = "VM.Standard.E3.Flex"  # Cheap paid AMD instances (always available)
}

variable "instance_count" {
  description = "Number of instances to create (1=single node ~$15/mo, 2=HA cluster ~$30/mo)"
  type        = number
  default     = 1  # Single node for cost savings
}

variable "instance_ocpus" {
  description = "Number of OCPUs per instance (1=min, 2=recommended)"
  type        = number
  default     = 1  # Minimum for cost savings
}

variable "instance_memory_gb" {
  description = "Memory in GB per instance (min 6GB for K3s+SatVis+monitoring, 8GB recommended)"
  type        = number
  default     = 6  # Minimum acceptable performance
}

# Project
variable "project_name" {
  description = "Project name prefix"
  type        = string
  default     = "satvis"
}
