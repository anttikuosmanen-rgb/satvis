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
variable "instance_count" {
  description = "Number of ARM instances to create"
  type        = number
  default     = 2
}

variable "instance_ocpus" {
  description = "Number of OCPUs per instance"
  type        = number
  default     = 2
}

variable "instance_memory_gb" {
  description = "Memory in GB per instance"
  type        = number
  default     = 12
}

# Project
variable "project_name" {
  description = "Project name prefix"
  type        = string
  default     = "satvis"
}
