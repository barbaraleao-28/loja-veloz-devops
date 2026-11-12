#!/usr/bin/env bash
# Executado no runner descartável do GitHub após o teste Compose.
set -euo pipefail
cluster=loja-video
ns=pedidos-veloz
kind create cluster --name "$cluster" --wait 2m
services=(estoque-service pagamentos-service pedidos-service api-gateway)
for svc in "${services[@]}"; do
  kind load docker-image "ghcr.io/loja-veloz/$svc:1.2.1" --name "$cluster"
done
# O cluster de ensaio usa os dados e o coletor do Compose, na rede do kind.
for dep in postgres redis jaeger; do
  docker network connect kind "$(docker compose ps -q "$dep")"
done
address() { docker inspect -f '{{(index .NetworkSettings.Networks "kind").IPAddress}}' "$(docker compose ps -q "$1")"; }
kubectl apply -f k8s/00-namespace.yaml
kubectl -n "$ns" create secret generic pedidos-veloz-secrets \
  --from-literal=POSTGRES_USER=veloz_admin --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=PAYMENT_PROVIDER_API_KEY=simulador
kubectl apply -f k8s/01-configmap.yaml
kubectl -n "$ns" patch configmap pedidos-veloz-config --type merge \
  -p "$(jq -n --arg pg "$(address postgres)" --arg redis "redis://$(address redis):6379" --arg otel "http://$(address jaeger):4318" '{data:{POSTGRES_HOST:$pg,REDIS_URL:$redis,OTEL_EXPORTER_OTLP_ENDPOINT:$otel}}')"
for manifest in k8s/03-* k8s/04-* k8s/05-* k8s/06-* k8s/07-*; do kubectl apply -f "$manifest"; done
for svc in "${services[@]}"; do kubectl -n "$ns" rollout status "deployment/$svc" --timeout=240s; done
kubectl -n "$ns" get deploy,pods,svc,hpa,pdb -o wide | tee evidencias-run/cluster.txt
kubectl -n "$ns" port-forward svc/api-gateway 18081:80 >evidencias-run/port-forward.log 2>&1 &
forward=$!
trap 'kill "$forward" 2>/dev/null || true' EXIT
curl -fsS --retry 20 --retry-connrefused --retry-delay 1 http://127.0.0.1:18081/ready
GATEWAY_URL=http://127.0.0.1:18081 node scripts/smoke.js | tee evidencias-run/pedido-cluster.json
