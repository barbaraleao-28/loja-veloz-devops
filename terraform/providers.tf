terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
  }

  # Em produção, o state é armazenado remotamente com lock no DynamoDB
  # backend "s3" {
  #   bucket         = "loja-veloz-terraform-state-prod"
  #   key            = "pedidos-veloz/infra.tfstate"
  #   region         = "sa-east-1"
  #   encrypt        = true
  #   dynamodb_table = "loja-veloz-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Pedidos-Veloz"
      Company     = "Loja-Veloz"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
