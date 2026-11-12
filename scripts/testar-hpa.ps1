# Gera carga de dentro do cluster e acompanha o HPA escalando Pedidos e o Gateway.
# Requer metrics-server no cluster (kubectl top pods deve funcionar).
# Uso: .\scripts\testar-hpa.ps1 [-DuracaoS 240] [-Concorrencia 60]
param([int]$DuracaoS = 240, [int]$Concorrencia = 60)
$ErrorActionPreference = 'Stop'
$ns = 'pedidos-veloz'
$root = Split-Path $PSScriptRoot -Parent

kubectl -n $ns create configmap carga-script --from-file=carga.js="$root/scripts/carga.js" --dry-run=client -o yaml | kubectl apply -f - | Out-Null
kubectl -n $ns delete job teste-carga-hpa --ignore-not-found | Out-Null
@"
apiVersion: batch/v1
kind: Job
metadata:
  name: teste-carga-hpa
  namespace: $ns
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        app: teste-carga
    spec:
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: carga
          image: ghcr.io/loja-veloz/api-gateway:1.2.1
          imagePullPolicy: IfNotPresent
          command: ["node", "/carga/carga.js"]
          env:
            - { name: GATEWAY_URL, value: "http://api-gateway" }
            - { name: DURACAO_S, value: "$DuracaoS" }
            - { name: CONCORRENCIA, value: "$Concorrencia" }
          volumeMounts:
            - { name: script, mountPath: /carga }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
      volumes:
        - name: script
          configMap: { name: carga-script }
"@ | kubectl apply -f - | Out-Null

Write-Output "Carga iniciada por $DuracaoS s com $Concorrencia conexões. Acompanhando o HPA a cada 15 s..."
$fim = (Get-Date).AddSeconds($DuracaoS + 30)
while ((Get-Date) -lt $fim) {
  Write-Output ("--- " + (Get-Date -Format 'HH:mm:ss'))
  kubectl -n $ns get hpa --no-headers
  Start-Sleep 15
}
kubectl -n $ns wait --for=condition=complete job/teste-carga-hpa --timeout=120s | Out-Null
Write-Output '--- Resultado da carga'
kubectl -n $ns logs job/teste-carga-hpa
Write-Output '--- Eventos de escala'
kubectl -n $ns describe hpa | Select-String 'SuccessfulRescale'
kubectl -n $ns delete job teste-carga-hpa | Out-Null
kubectl -n $ns delete configmap carga-script | Out-Null
Write-Output 'Após ~5 min sem carga o HPA volta ao mínimo (stabilizationWindowSeconds: 300).'
