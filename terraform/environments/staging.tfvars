environment           = "staging"
cluster_name          = "loja-veloz-eks-staging"
vpc_cidr              = "10.30.0.0/16"
node_instance_types   = ["t3.medium"]
node_desired_capacity = 2
node_min_capacity     = 1
node_max_capacity     = 3
db_instance_class     = "db.t4g.small"
