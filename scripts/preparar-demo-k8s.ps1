# Prepara o Kubernetes do Docker Desktop para a demonstração do vídeo.
# O cluster usa o PostgreSQL, o Redis e o Jaeger que já rodam no Docker Compose.
# Pré-requisitos: Docker Desktop com Kubernetes ligado e "docker compose up -d --build" já executado.
# Uso (na raiz do projeto): .\scripts\preparar-demo-k8s.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$ns = 'pedidos-veloz'
$node = 'desktop-control-plane'
$versao = '1.2.1'
$servicos = 'estoque-service', 'pagamentos-service', 'pedidos-service', 'api-gateway'
function Checar($etapa) { if ($LASTEXITCODE -ne 0) { throw "Falhou: $etapa" } }

Write-Output '1/6 Conferindo o cluster e o Compose...'
kubectl config use-context docker-desktop | Out-Null; Checar 'contexto docker-desktop (o Kubernetes está ligado?)'
kubectl get nodes --no-headers | Out-Null; Checar 'acesso ao cluster'
if (-not (docker compose ps -q postgres)) { throw 'Suba o Compose antes: docker compose up -d --build' }

Write-Output '2/6 Carregando as imagens no nó do Kubernetes...'
$tmp = Join-Path $env:TEMP 'loja-veloz-imagens'
New-Item -ItemType Directory -Force $tmp | Out-Null
foreach ($s in $servicos) {
  $img = "ghcr.io/loja-veloz/${s}:$versao"
  $arq = Join-Path $tmp "$s.tar"
  docker save -o $arq $img; Checar "docker save $img (rode docker compose up -d --build)"
  cmd /c "docker exec -i $node ctr -n k8s.io images import --digests - < `"$arq`"" | Out-Null; Checar "importar $img"
  Remove-Item $arq
  Write-Output "    $img"
}

Write-Output '3/6 Ligando PostgreSQL, Redis e Jaeger à rede do cluster...'
$ip = @{}
foreach ($svc in 'postgres', 'redis', 'jaeger') {
  $id = docker compose ps -q $svc
  $redes = docker inspect -f '{{json .NetworkSettings.Networks}}' $id
  if ($redes -notmatch '"kind"') { docker network connect kind $id; Checar "conectar $svc" }
  $ip[$svc] = docker inspect -f '{{(index .NetworkSettings.Networks \"kind\").IPAddress}}' $id
  Write-Output "    $svc -> $($ip[$svc])"
}

Write-Output '4/6 Criando Namespace, Secret e ConfigMap...'
$envf = @{ POSTGRES_USER = 'veloz_admin'; POSTGRES_PASSWORD = 'veloz_dev_secret_2026' }
if (Test-Path .env) {
  Get-Content .env | Where-Object { $_ -match '^\s*(POSTGRES_USER|POSTGRES_PASSWORD)=(.*)$' } | ForEach-Object { $envf[$Matches[1]] = $Matches[2] }
}
kubectl apply -f k8s/00-namespace.yaml | Out-Null
kubectl -n $ns create secret generic pedidos-veloz-secrets `
  --from-literal=POSTGRES_USER=$($envf.POSTGRES_USER) `
  --from-literal=POSTGRES_PASSWORD=$($envf.POSTGRES_PASSWORD) `
  --from-literal=PAYMENT_PROVIDER_API_KEY=sk_test_cluster_local `
  --dry-run=client -o yaml | kubectl apply -f - | Out-Null
kubectl apply -f k8s/01-configmap.yaml | Out-Null
$patch = @{ data = @{
    POSTGRES_HOST               = $ip['postgres']
    REDIS_URL                   = "redis://$($ip['redis']):6379"
    OTEL_EXPORTER_OTLP_ENDPOINT = "http://$($ip['jaeger']):4318"
  } } | ConvertTo-Json -Compress
$arqPatch = Join-Path $tmp 'configmap-patch.json'
[IO.File]::WriteAllText($arqPatch, $patch)
kubectl -n $ns patch configmap pedidos-veloz-config --type merge --patch-file $arqPatch | Out-Null; Checar 'ConfigMap'

Write-Output '5/6 Aplicando Deployments, Services, HPA, NetworkPolicy e PDB...'
foreach ($m in 'k8s/03-deployments.yaml', 'k8s/04-services.yaml', 'k8s/05-hpa.yaml', 'k8s/06-network-policy.yaml', 'k8s/07-pdb.yaml') {
  kubectl apply -f $m | Out-Null; Checar $m
}
# Reinicia para os pods lerem o ConfigMap atualizado (endereços podem mudar após reiniciar o PC)
kubectl -n $ns rollout restart deployment | Out-Null
foreach ($s in $servicos) { kubectl -n $ns rollout status deployment/$s --timeout=240s | Out-Null; Checar "rollout $s" }

Write-Output '6/6 Abrindo o acesso ao Gateway do cluster em http://127.0.0.1:18081 ...'
Get-CimInstance Win32_Process -Filter "Name = 'kubectl.exe'" |
  Where-Object { $_.CommandLine -match 'port-forward' -and $_.CommandLine -match '18081' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process kubectl -ArgumentList '-n', $ns, 'port-forward', 'svc/api-gateway', '18081:80' -WindowStyle Hidden | Out-Null
$pronto = $false
for ($i = 0; $i -lt 30; $i++) {
  try { Invoke-WebRequest http://127.0.0.1:18081/ready -UseBasicParsing -TimeoutSec 2 | Out-Null; $pronto = $true; break } catch { Start-Sleep 1 }
}
if (-not $pronto) { throw 'O Gateway do cluster não respondeu em http://127.0.0.1:18081/ready' }

kubectl -n kube-system get deploy metrics-server --no-headers 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Warning 'metrics-server não encontrado: o HPA não terá métricas de CPU (veja o README).' }

Write-Output ''
kubectl -n $ns get deploy,hpa
Write-Output ''
Write-Output 'Pronto. Painel pelo Kubernetes: http://127.0.0.1:18081  |  Painel pelo Compose: http://127.0.0.1:8080'
