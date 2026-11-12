# Roteiro do vídeo pitch (até 4 minutos)

O enunciado pede: visão geral da arquitetura, demonstração do ambiente funcionando e explicação das decisões sobre containers, Kubernetes, pipeline CI/CD, deploy, observabilidade e escalabilidade. Publique no YouTube (pode ser **Não listado**) e inclua o link no README e no PDF.

A fala completa tem cerca de 520 palavras, o que dá uns 3 min 50 s em ritmo calmo. Ensaie uma vez com o cronômetro antes de gravar.

---

## Parte A — Preparação (antes de gravar, uns 10 minutos)

### A1. Subir o ambiente
1. Abra o **Docker Desktop** e espere aparecer **Engine running** e **Kubernetes running** no rodapé.
2. Abra o **Windows PowerShell** na pasta do projeto:
   ```powershell
   cd "$env:USERPROFILE\OneDrive\Área de Trabalho\EAD_Devops\EAD-Loja-Veloz"
   ```
3. Suba o Compose (banco, Redis, observabilidade e os 4 serviços):
   ```powershell
   docker compose up -d --build --wait
   ```
4. Prepare o Kubernetes (imagens, Secret, ConfigMap, manifestos e acesso em http://127.0.0.1:18081):
   ```powershell
   .\scripts\preparar-demo-k8s.ps1
   ```
   O final deve mostrar `Pronto.`, com Pedidos em 3 réplicas e Gateway em 2. Se o HPA ainda mostrar mais réplicas por causa de um teste anterior, espere uns 5 minutos: ele volta sozinho ao mínimo.
5. Faça uma compra de aquecimento, para a primeira compra do vídeo não sair lenta:
   ```powershell
   node scripts/smoke.js
   ```

### A2. Deixar as janelas prontas
- **Terminal 1 (PowerShell)**, com fonte grande (Ctrl + roda do mouse), na pasta do projeto. Rode `cls` para limpar.
- **Terminal 2 (PowerShell)**, na mesma pasta. Será usado no teste do HPA.
- **Navegador com 4 abas:**
  1. `docs/02-relatorio-pratico.pdf`, aberto na página 1 (diagrama de arquitetura)
  2. http://127.0.0.1:8080 (painel da loja)
  3. http://127.0.0.1:16686 (Jaeger)
  4. http://127.0.0.1:9090/targets (Prometheus)
- **VS Code** com a pasta do projeto e estes arquivos em abas: `services/pedidos-service/Dockerfile`, `k8s/03-deployments.yaml`, `k8s/05-hpa.yaml`, `.github/workflows/ci-cd.yaml`, `terraform/main.tf`.

### A3. Gravador
- **Xbox Game Bar:** `Win + Alt + R` inicia e para a gravação da janela ativa. Grava só uma janela, então para alternar entre terminal, navegador e VS Code é melhor o OBS ou o Clipchamp.
- **OBS Studio** (recomendado): fonte "Captura de tela" e microfone ativo, saída em MP4, 1920x1080.
- Feche notificações (Windows: Configurações → Sistema → Notificações → Não incomodar).

---

## Parte B — Gravação, cena a cena

### Cena 1 — Problema e arquitetura (0:00–0:30)
**Tela:** aba 1, diagrama do relatório prático.
**Fala:**
> "Fui contratado(a) como Cloud DevOps Engineer da Loja Veloz, um e-commerce que sofre com indisponibilidade nos deploys, dificuldade para escalar em campanhas e falhas difíceis de rastrear entre serviços. Construí um MVP com quatro microsserviços: o API Gateway recebe o tráfego, Pedidos coordena a compra, Estoque reserva os itens e Pagamentos autoriza a cobrança. Os dados ficam no PostgreSQL, e o evento PedidoCriado é publicado no Redis Streams com o padrão outbox, para nenhum pedido gravado perder o evento."

### Cena 2 — Ambiente local com Docker Compose (0:30–1:00)
**Tela:** Terminal 1.
**Ação:** digite e rode:
```powershell
docker compose ps
```
**Fala:**
> "No desenvolvimento, todo o ambiente sobe com um único comando, docker compose up. São nove containers: os quatro serviços, o banco, o Redis, o Jaeger, o Prometheus e o Grafana. O Compose define duas redes, volumes nomeados para os dados e variáveis de ambiente no padrão 12-Factor, e os serviços só sobem depois que o banco passa no healthcheck."

### Cena 3 — Compra real e tracing distribuído (1:00–1:35)
**Tela:** Terminal 1, depois aba 2 (painel) e aba 3 (Jaeger).
**Ação:**
1. Rode `node scripts/smoke.js` e destaque `"http": 201` e o `traceId`.
2. Vá à aba 2 e atualize (F5): o pedido aparece na tabela.
3. Vá à aba 3 (Jaeger), escolha o serviço **api-gateway**, clique em **Find Traces** e abra o trace mais recente.

**Fala:**
> "Aqui faço uma compra real pelo Gateway: o pedido foi criado com HTTP 201. No painel ele já aparece. Todo serviço propaga o contexto W3C traceparent e exporta spans via OpenTelemetry. No Jaeger, o mesmo trace mostra o caminho completo: Gateway, Pedidos, Estoque e Pagamentos, com o tempo de cada etapa. Os logs são JSON com o mesmo traceId, e cada serviço expõe métricas no /metrics para o Prometheus."

(Se der tempo, mostre a aba 4 com os 4 alvos **UP** por 2 segundos.)

### Cena 4 — Containers e versionamento (1:35–1:55)
**Tela:** VS Code, `services/pedidos-service/Dockerfile`.
**Fala:**
> "As imagens são multi-stage. O primeiro estágio instala as dependências do lockfile e roda lint e testes; se falhar, a imagem nem é gerada. A imagem final tem só o runtime do Node, sem npm, e roda com um usuário sem privilégios, o UID 10001. No pipeline, cada imagem recebe a versão SemVer e uma tag imutável com o SHA do commit."

### Cena 5 — Kubernetes, segurança e deploy (1:55–2:35)
**Tela:** Terminal 1, depois VS Code `k8s/03-deployments.yaml` (role até `strategy` e `readinessProbe`).
**Ação:** no Terminal 1 rode:
```powershell
kubectl -n pedidos-veloz get deploy,pods,hpa
```
**Fala:**
> "Em produção, a aplicação roda no Kubernetes. Aqui estão os Deployments, os pods e os HPAs no cluster. A configuração vem de ConfigMap e as credenciais de Secret. Cada pod tem readiness e liveness probes, e o namespace aplica o Pod Security Admission no perfil restricted: um pod que rode como root é recusado. Uma NetworkPolicy limita quem fala com os serviços internos. O deploy é RollingUpdate com maxUnavailable zero: a réplica antiga só sai quando a nova está pronta. Escolhi o rolling porque é nativo e não duplica o ambiente, como o blue/green. Nos testes, o restart dos quatro serviços sob carga teve cem por cento de sucesso, graças ao desligamento gracioso."

### Cena 6 — Escalabilidade com HPA (2:35–3:15)
**Tela:** Terminal 2 e VS Code `k8s/05-hpa.yaml`.
**Ação:**
1. **No início da cena**, no Terminal 2, rode:
   ```powershell
   .\scripts\testar-hpa.ps1 -DuracaoS 120 -Concorrencia 60
   ```
2. Enquanto fala, mostre o `k8s/05-hpa.yaml` no VS Code.
3. Por volta de 3:00, volte ao Terminal 2 e mostre a coluna **REPLICAS** subindo (Gateway 2 → 4 → 8, Pedidos 3 → 5 → 6...).

**Fala:**
> "Para o pico da campanha uso o HorizontalPodAutoscaler. Pedidos escala de 3 a 12 réplicas por CPU e memória, e o Gateway de 2 a 10. A subida pode dobrar as réplicas a cada 30 segundos, e a descida é lenta, para não oscilar no fim do pico. Estoque e Pagamentos usam o VPA só em modo de recomendação, porque HPA e VPA na mesma métrica entrariam em conflito. Estou gerando carga agora e... aqui o HPA já está criando réplicas automaticamente."

### Cena 7 — Pipeline CI/CD (3:15–3:40)
**Tela:** VS Code `.github/workflows/ci-cd.yaml`. Role pelos 4 jobs. Se o repositório estiver no GitHub, mostre a aba **Actions** com uma execução verde.
**Fala:**
> "A entrega é automatizada no GitHub Actions em quatro etapas: lint de código, Dockerfiles, manifestos e Terraform; testes unitários e uma compra de ponta a ponta com o Compose; build com scan de vulnerabilidades do Trivy e publicação no GHCR; e deploy na main, com aprovação de ambiente, credenciais vindas dos secrets do GitHub e rollback automático se o rollout falhar."

### Cena 8 — Terraform e encerramento (3:40–4:00)
**Tela:** VS Code `terraform/main.tf`.
**Fala:**
> "A infraestrutura AWS, com VPC, cluster EKS, node group e banco RDS, está em Terraform, com um arquivo por ambiente, e é validada no pipeline. Como próximos passos, deixo o deploy canary e o mTLS com service mesh para quando o número de serviços justificar. Obrigado!"

---

## Parte C — Depois de gravar

1. **Revise o vídeo**: duração de até 4:00, áudio audível, terminal legível. Se passar do tempo, corte pausas no Clipchamp (Windows) ou encurte a Cena 3.
2. **Publique no YouTube:** youtube.com → **Criar** → **Enviar vídeo** → título "Loja Veloz – Cloud DevOps: Microsserviços, Kubernetes e CI/CD" → em **Visibilidade**, escolha **Não listado** → **Salvar**. Copie o link (`https://youtu.be/...`).
3. **Inclua o link no README e nos PDFs:** cole o link sozinho no arquivo `docs/video-url.txt`, salve e rode:
   ```powershell
   pip install reportlab pypdf
   python docs/gerar_pdfs.py
   ```
   A saída deve mostrar `Link do vídeo: https://youtu.be/...`. Se preferir, mande o link para o Claude fazer essa etapa.
4. **Desligue o ambiente**, se quiser:
   ```powershell
   docker compose down
   ```

---

## Se algo der errado durante a gravação

| Problema | Solução |
|---|---|
| `smoke.js` falha ou demora | Rode `docker compose ps`; se algum serviço não estiver `healthy`, rode `docker compose up -d --wait` e repita. |
| `kubectl` não responde | Confira no Docker Desktop se o Kubernetes está **running** e rode `.\scripts\preparar-demo-k8s.ps1` de novo. |
| HPA mostra `<unknown>` | Falta o metrics-server (instruções no README, seção Kubernetes). |
| HPA não sobe a tempo | Mostre o resultado gravado em `evidencias/kubernetes/hpa.txt` (Gateway de 2 para 10 réplicas, 100% de sucesso). |
| Sem Docker na máquina | Use a execução nativa do Windows (README, seção 2) ou o workflow **Ensaio do vídeo** no GitHub Actions. |
