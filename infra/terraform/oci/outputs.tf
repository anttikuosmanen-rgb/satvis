output "instance_details" {
  description = "Details of created instances"
  value = [
    for idx, instance in oci_core_instance.k3s_nodes : {
      name       = instance.display_name
      public_ip  = instance.public_ip
      private_ip = instance.private_ip
      state      = instance.state
      ocpus      = instance.shape_config[0].ocpus
      memory_gb  = instance.shape_config[0].memory_in_gbs
    }
  ]
}

output "master_public_ip" {
  description = "Public IP of the master node"
  value       = length(oci_core_instance.k3s_nodes) > 0 ? oci_core_instance.k3s_nodes[0].public_ip : null
}

output "master_private_ip" {
  description = "Private IP of the master node"
  value       = length(oci_core_instance.k3s_nodes) > 0 ? oci_core_instance.k3s_nodes[0].private_ip : null
}

output "worker_ips" {
  description = "IPs of worker nodes"
  value = length(oci_core_instance.k3s_nodes) > 1 ? [
    for idx, instance in slice(oci_core_instance.k3s_nodes, 1, length(oci_core_instance.k3s_nodes)) : {
      name       = instance.display_name
      public_ip  = instance.public_ip
      private_ip = instance.private_ip
    }
  ] : []
}

output "ssh_commands" {
  description = "SSH commands to connect to instances"
  value = [
    for idx, instance in oci_core_instance.k3s_nodes :
    "ssh -i ~/.ssh/id_rsa ubuntu@${instance.public_ip}"
  ]
}

output "vcn_id" {
  description = "VCN OCID"
  value       = oci_core_vcn.satvis_vcn.id
}
