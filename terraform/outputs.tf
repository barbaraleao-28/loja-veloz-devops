output "vpc_id" {
  description = "ID da VPC criada para a Loja Veloz"
  value       = aws_vpc.pedidos_veloz_vpc.id
}

output "eks_cluster_name" {
  description = "Nome do cluster EKS (aws eks update-kubeconfig --name ...)"
  value       = aws_eks_cluster.pedidos_veloz.name
}

output "eks_cluster_endpoint" {
  description = "Endpoint do Control Plane do Kubernetes (EKS)"
  value       = aws_eks_cluster.pedidos_veloz.endpoint
}

output "eks_node_group" {
  description = "Node group que hospeda os microsserviços"
  value       = aws_eks_node_group.aplicacao.node_group_name
}

output "rds_postgres_endpoint" {
  description = "Host do banco de dados PostgreSQL (vai para POSTGRES_HOST no ConfigMap)"
  value       = aws_db_instance.pedidos_postgres.address
}

output "rds_master_secret_arn" {
  description = "ARN do segredo no Secrets Manager com a senha mestre do RDS"
  value       = aws_db_instance.pedidos_postgres.master_user_secret[0].secret_arn
}
