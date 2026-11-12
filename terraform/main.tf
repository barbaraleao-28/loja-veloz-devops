# ============================================================================
# Esqueleto de IaC da plataforma Pedidos Veloz (AWS / sa-east-1)
# Nada aqui foi aplicado (terraform apply) no exercício: o código é validado
# no pipeline com "terraform init -backend=false", "fmt -check" e "validate".
# ============================================================================

locals {
  azs = ["${var.aws_region}a", "${var.aws_region}b"]
}

# ============================================================================
# 1. REDE ISOLADA (VPC Multi-AZ, subnets privadas para nós e banco)
# ============================================================================
resource "aws_vpc" "pedidos_veloz_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.cluster_name}-vpc"
  }
}

resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.pedidos_veloz_vpc.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 1)
  availability_zone = local.azs[count.index]

  tags = {
    Name                              = "${var.cluster_name}-private-${count.index}"
    "kubernetes.io/role/internal-elb" = "1"
  }
}

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.pedidos_veloz_vpc.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 101)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name                     = "${var.cluster_name}-public-${count.index}"
    "kubernetes.io/role/elb" = "1"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.pedidos_veloz_vpc.id
}

# Saída única para a internet a partir das subnets privadas (download de imagens).
resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.igw]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.pedidos_veloz_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.pedidos_veloz_vpc.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat.id
  }
}

resource "aws_route_table_association" "public" {
  count          = length(local.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(local.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ============================================================================
# 2. CLUSTER KUBERNETES GERENCIADO (Amazon EKS + Managed Node Group)
# ============================================================================
resource "aws_iam_role" "eks_cluster_role" {
  name = "${var.cluster_name}-control-plane-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.eks_cluster_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "pedidos_veloz" {
  name     = var.cluster_name
  role_arn = aws_iam_role.eks_cluster_role.arn
  version  = var.kubernetes_version

  vpc_config {
    subnet_ids              = aws_subnet.private[*].id
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster_policy]
}

resource "aws_iam_role" "eks_node_role" {
  name = "${var.cluster_name}-node-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_node_policies" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  ])

  role       = aws_iam_role.eks_node_role.name
  policy_arn = each.value
}

# Os nós precisam de folga para o pod extra do RollingUpdate (maxSurge: 1)
# e para o HPA chegar ao teto de réplicas durante a campanha.
resource "aws_eks_node_group" "aplicacao" {
  cluster_name    = aws_eks_cluster.pedidos_veloz.name
  node_group_name = "${var.cluster_name}-app"
  node_role_arn   = aws_iam_role.eks_node_role.arn
  subnet_ids      = aws_subnet.private[*].id
  instance_types  = var.node_instance_types

  scaling_config {
    desired_size = var.node_desired_capacity
    min_size     = var.node_min_capacity
    max_size     = var.node_max_capacity
  }

  update_config {
    max_unavailable = 1
  }

  # O Cluster Autoscaler/Karpenter ajusta desired_size; o Terraform não o reverte.
  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [aws_iam_role_policy_attachment.eks_node_policies]
}

# ============================================================================
# 3. BANCO DE DADOS GERENCIADO (Amazon RDS PostgreSQL 16)
# ============================================================================
resource "aws_db_subnet_group" "postgres_subnets" {
  name       = "${var.cluster_name}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "postgres" {
  name        = "${var.cluster_name}-postgres"
  description = "PostgreSQL acessivel somente a partir do cluster EKS"
  vpc_id      = aws_vpc.pedidos_veloz_vpc.id

  ingress {
    description     = "PostgreSQL a partir dos nos do EKS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_eks_cluster.pedidos_veloz.vpc_config[0].cluster_security_group_id]
  }
}

# A senha mestre é gerada e rotacionada pelo AWS Secrets Manager
# (manage_master_user_password) e nunca fica no state em texto puro.
resource "aws_db_instance" "pedidos_postgres" {
  identifier                  = "veloz-postgres-${var.environment}"
  engine                      = "postgres"
  engine_version              = "16.3"
  instance_class              = var.db_instance_class
  allocated_storage           = 50
  max_allocated_storage       = 200
  storage_encrypted           = true
  multi_az                    = var.environment == "production"
  db_name                     = "pedidos_veloz"
  username                    = "veloz_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.postgres_subnets.name
  vpc_security_group_ids      = [aws_security_group.postgres.id]
  backup_retention_period     = 7
  deletion_protection         = var.environment == "production"
  skip_final_snapshot         = false
  final_snapshot_identifier   = "veloz-postgres-${var.environment}-final"
}
