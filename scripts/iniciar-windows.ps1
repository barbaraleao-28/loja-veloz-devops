$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $env:POSTGRES_PASSWORD) { throw 'Configure POSTGRES_PASSWORD nesta sessão.' }
$defaults = @{
  POSTGRES_HOST='127.0.0.1'; POSTGRES_PORT='5432'; POSTGRES_DB='pedidos_veloz'; POSTGRES_USER='postgres'
  REDIS_URL='redis://127.0.0.1:36379'; OTEL_EXPORTER_OTLP_ENDPOINT='http://127.0.0.1:4318'
  PAYMENT_PROVIDER_API_KEY='sk_test_local_simulador'
  PEDIDOS_PORT='3001'; PAGAMENTOS_PORT='3002'; ESTOQUE_PORT='3003'; GATEWAY_PORT='8080'
}
foreach ($key in $defaults.Keys) {
  if (-not [Environment]::GetEnvironmentVariable($key)) { [Environment]::SetEnvironmentVariable($key,$defaults[$key]) }
}
$env:PEDIDOS_SERVICE_URL="http://127.0.0.1:$env:PEDIDOS_PORT"
$env:PAGAMENTOS_SERVICE_URL="http://127.0.0.1:$env:PAGAMENTOS_PORT"
$env:ESTOQUE_SERVICE_URL="http://127.0.0.1:$env:ESTOQUE_PORT"
foreach ($service in 'estoque-service','pagamentos-service','pedidos-service','api-gateway') {
  $process = Start-Process -FilePath 'node.exe' -ArgumentList 'src/index.js' -WorkingDirectory (Join-Path $root "services/$service") -WindowStyle Hidden -PassThru
  Write-Output "$service PID $($process.Id)"
}
