variable "aws_region" {
  description = "Região AWS para provisionamento da Loja Veloz (São Paulo)"
  type        = string
  default     = "sa-east-1"
}

variable "environment" {
  description = "Ambiente de execução (staging ou production)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Use staging ou production."
  }
}

variable "cluster_name" {
  description = "Nome do cluster Kubernetes gerenciado (EKS)"
  type        = string
  default     = "loja-veloz-eks-prod"
}

variable "kubernetes_version" {
  description = "Versão do Kubernetes no EKS"
  type        = string
  default     = "1.30"
}

variable "vpc_cidr" {
  description = "Bloco CIDR da VPC isolada da plataforma Pedidos Veloz"
  type        = string
  default     = "10.20.0.0/16"
}

variable "node_instance_types" {
  description = "Tipos de instância dos Worker Nodes"
  type        = list(string)
  default     = ["t3.large"]
}

variable "node_desired_capacity" {
  description = "Quantidade inicial de Worker Nodes no Node Group"
  type        = number
  default     = 3
}

variable "node_min_capacity" {
  description = "Mínimo de Worker Nodes (um por zona + folga para o rollout)"
  type        = number
  default     = 2
}

variable "node_max_capacity" {
  description = "Máximo de Worker Nodes durante a campanha promocional"
  type        = number
  default     = 8
}

variable "db_instance_class" {
  description = "Classe da instância RDS PostgreSQL"
  type        = string
  default     = "db.t4g.medium"
}
