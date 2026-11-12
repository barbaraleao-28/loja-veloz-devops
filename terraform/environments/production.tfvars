environment           = "production"
cluster_name          = "loja-veloz-eks-prod"
vpc_cidr              = "10.20.0.0/16"
node_instance_types   = ["t3.large"]
node_desired_capacity = 3
node_min_capacity     = 2
node_max_capacity     = 8
db_instance_class     = "db.t4g.medium"
