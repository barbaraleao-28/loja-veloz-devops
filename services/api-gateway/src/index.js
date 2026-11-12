const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.GATEWAY_PORT || process.env.PORT || 8080);
const SERVICE_NAME = 'api-gateway';
const APP_VERSION = process.env.APP_VERSION || '1.2.1';

const PEDIDOS_SERVICE_URL = process.env.PEDIDOS_SERVICE_URL || 'http://localhost:3001';
const PAGAMENTOS_SERVICE_URL = process.env.PAGAMENTOS_SERVICE_URL || 'http://localhost:3002';
const ESTOQUE_SERVICE_URL = process.env.ESTOQUE_SERVICE_URL || 'http://localhost:3003';

const tracesRecentes = [];
const logsCorrelacionados = [];
const metricas = {
  requestsTotal: 0,
  requests2xx: 0,
  requests4xx: 0,
  requests5xx: 0,
  latenciaSomaMs: 0
};

function logEstruturado(level, msg, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    version: APP_VERSION,
    ...meta,
    message: msg
  };
  logsCorrelacionados.unshift(entry);
  if (logsCorrelacionados.length > 50) logsCorrelacionados.pop();
  console.log(JSON.stringify(entry));
}

function lerJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Loja Veloz | Plataforma Pedidos Veloz - Console Cloud DevOps & Observabilidade</title>
  <style>
    :root {
      --bg: #0b1120;
      --panel: #111827;
      --border: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #38bdf8;
      --success: #22c55e;
      --warn: #f59e0b;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 20px 28px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .badge {
      background: rgba(34, 197, 94, 0.15);
      color: var(--success);
      border: 1px solid rgba(34, 197, 94, 0.4);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-k8s {
      background: rgba(56, 189, 248, 0.15);
      color: var(--primary);
      border: 1px solid rgba(56, 189, 248, 0.4);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
    }
    .kpi-title { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .kpi-val { font-size: 24px; font-weight: 700; margin-top: 6px; color: var(--text); }
    .kpi-sub { font-size: 12px; color: var(--success); margin-top: 4px; }
    .main-grid {
      display: grid;
      grid-template-columns: 1.15fr 1fr;
      gap: 16px;
    }
    h2 { font-size: 15px; margin-bottom: 12px; color: var(--primary); display: flex; align-items: center; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; font-size: 11.5px; text-transform: uppercase; }
    .status-pill {
      background: rgba(34, 197, 94, 0.18);
      color: #4ade80;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .trace-box {
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .trace-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 8px;
      font-family: Consolas, monospace;
      color: #e2e8f0;
    }
    .span-row {
      display: grid;
      grid-template-columns: 140px 1fr 65px;
      align-items: center;
      gap: 8px;
      margin: 5px 0;
      font-size: 11.5px;
    }
    .span-bar-bg {
      background: #1e293b;
      height: 16px;
      border-radius: 4px;
      position: relative;
      overflow: hidden;
    }
    .span-bar {
      height: 100%;
      border-radius: 4px;
      font-size: 10px;
      line-height: 16px;
      padding-left: 6px;
      color: #0b1120;
      font-weight: 700;
      white-space: nowrap;
    }
    .log-stream {
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      font-family: Consolas, monospace;
      font-size: 11px;
      color: #cbd5e1;
      max-height: 170px;
      overflow-y: auto;
      margin-top: 12px;
    }
    .log-line { margin-bottom: 4px; line-height: 1.4; }
    .hl-trace { color: #38bdf8; }
    .hl-srv { color: #a855f7; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div>
        <h1 style="font-size: 20px;">⚡ Loja Veloz — Plataforma Distribuída "Pedidos Veloz"</h1>
        <p style="font-size: 12.5px; color: var(--muted); margin-top: 2px;">API Gateway + Microsserviços (Pedidos, Estoque, Pagamentos) | Logs e métricas</p>
      </div>
    </div>

  </header>

  <div class="kpi-grid">
    <div class="card">
      <div class="kpi-title">Requisições no API Gateway</div>
      <div class="kpi-val" id="kpi-req">0</div>
      <div class="kpi-sub">Contagem desde o início do processo</div>
    </div>
    <div class="card">
      <div class="kpi-title">Pedidos Confirmados & Pagos</div>
      <div class="kpi-val" id="kpi-ped">0</div>
      <div class="kpi-sub">Pedidos persistidos no PostgreSQL</div>
    </div>
    <div class="card">
      <div class="kpi-title">Latência média dos pedidos recentes</div>
      <div class="kpi-val" id="kpi-lat">0 ms</div>
      <div class="kpi-sub">SLO Alvo: &lt; 150 ms (Campanha)</div>
    </div>
    <div class="card">
      <div class="kpi-title">Estratégia proposta</div>
      <div class="kpi-val" style="font-size: 18px; margin-top: 10px;">RollingUpdate + PSA</div>
      <div class="kpi-sub">Non-Root UID 10001 | maxUnavailable: 0</div>
    </div>
  </div>

  <div class="main-grid">
    <div class="card">
      <h2>
        <span>📦 Pedidos Recentes Processados em Microsserviços</span>
        <span style="font-size:11px; color:var(--muted);">PostgreSQL + Eventos</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>Pedido ID</th>
            <th>Cliente</th>
            <th>SKU / Produto</th>
            <th>Valor Total</th>
            <th>Pagamento</th>
            <th>Trace ID (W3C)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="tabela-pedidos"></tbody>
      </table>

      <h2 style="margin-top: 16px;">
        <span>📊 Catálogo e Reserva de Estoque em Tempo Real (estoque-service)</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Produto</th>
            <th>Preço Unit.</th>
            <th>Disponível</th>
            <th>Reservado</th>
          </tr>
        </thead>
        <tbody id="tabela-estoque"></tbody>
      </table>
    </div>

    <div class="card">
      <h2>
        <span>🔍 Etapas medidas pelo Gateway</span>
        <span style="font-size:11px; color:var(--muted);">Propagação x-trace-id</span>
      </h2>
      <div id="lista-traces"></div>

      <h2 style="margin-top: 12px;">
        <span>📜 Stream de Logs Estruturados JSON (12-Factor stdout)</span>
      </h2>
      <div class="log-stream" id="lista-logs"></div>
    </div>
  </div>

  <script>
    async function carregarPainel() {
      const [resPedidos, resEstoque, resTraces] = await Promise.all([
        fetch('/api/pedidos').then(r => r.json()),
        fetch('/api/estoque').then(r => r.json()),
        fetch('/api/traces').then(r => r.json())
      ]);

      document.getElementById('kpi-req').textContent = resTraces.metricas.requestsTotal;
      document.getElementById('kpi-ped').textContent = resPedidos.total;
      const mediaLat = resTraces.traces.length
        ? (resTraces.traces.reduce((acc, t) => acc + t.totalDurationMs, 0) / resTraces.traces.length).toFixed(1)
        : '0';
      document.getElementById('kpi-lat').textContent = mediaLat + ' ms';

      const tbodyPed = document.getElementById('tabela-pedidos');
      tbodyPed.innerHTML = resPedidos.pedidos.slice(0, 5).map(p => \`
        <tr>
          <td style="font-family:monospace; font-weight:600; color:#38bdf8;">\${p.pedido_id}</td>
          <td>\${p.cliente_id}</td>
          <td>\${p.sku} (\${p.quantidade}x)</td>
          <td>R$ \${p.valor_total.toFixed(2)}</td>
          <td>\${p.metodo_pagamento} <small style="color:#94a3b8;">(\${p.pagamento_id})</small></td>
          <td style="font-family:monospace; color:#a855f7;">\${p.trace_id.slice(0, 14)}...</td>
          <td><span class="status-pill">\${p.status}</span></td>
        </tr>
      \`).join('');

      const tbodyEst = document.getElementById('tabela-estoque');
      tbodyEst.innerHTML = resEstoque.itens.map(i => \`
        <tr>
          <td style="font-family:monospace;">\${i.sku}</td>
          <td>\${i.nome}</td>
          <td>R$ \${i.preco_unitario.toFixed(2)}</td>
          <td style="color:#4ade80; font-weight:600;">\${i.quantidade_disponivel} un.</td>
          <td style="color:#f59e0b; font-weight:600;">\${i.quantidade_reservada} un.</td>
        </tr>
      \`).join('');

      const divTraces = document.getElementById('lista-traces');
      divTraces.innerHTML = resTraces.traces.slice(0, 2).map(t => \`
        <div class="trace-box">
          <div class="trace-header">
            <span><strong>traceId:</strong> <span style="color:#38bdf8;">\${t.traceId}</span></span>
            <span><strong>Pedido:</strong> \${t.pedidoId || 'N/A'} | <strong>Total:</strong> \${t.totalDurationMs} ms</span>
          </div>
          \${t.spans.map((s, idx) => {
            const colors = ['#38bdf8', '#a855f7', '#22c55e', '#f59e0b', '#ec4899'];
            const largura = Math.max(1, Math.min(100,100*s.durationMs / Math.max(t.totalDurationMs,0.001)));
            
            return \`
              <div class="span-row">
                <span style="font-family:monospace; color:#e2e8f0;">\${s.service}</span>
                <div class="span-bar-bg">
                  <div class="span-bar" style="width:\${largura}%; margin-left:\${0}%; background:\${colors[idx % 5]};">
                    \${s.operation}
                  </div>
                </div>
                <span style="text-align:right; font-family:monospace; color:#94a3b8;">\${s.durationMs} ms</span>
              </div>
            \`;
          }).join('')}
        </div>
      \`).join('');

      const divLogs = document.getElementById('lista-logs');
      divLogs.innerHTML = resTraces.logs.slice(0, 6).map(l => \`
        <div class="log-line">
          [\${l.timestamp.split('T')[1].slice(0,8)}] <span class="hl-srv">\${l.service}</span>
          <span class="hl-trace">traceId=\${(l.traceId || '').slice(0,12)}</span>
          status=\${l.statusCode || 200} msg="\${l.message}"
        </div>
      \`).join('');
    }
    carregarPainel();
  </script>
</body>
</html>`;
}

// Leituras (GET) são idempotentes: uma falha de rede, como uma conexão encerrada por uma
// réplica em desligamento durante o rollout, ganha uma nova tentativa antes de virar 502.
async function consultar(url,res,traceId,spanId,tentativas=2) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      const upstream=await fetch(url,{signal:AbortSignal.timeout(5000),headers:{'x-trace-id':traceId,'x-span-id':spanId}});
      const body=await upstream.text(); res.writeHead(upstream.status); return res.end(body);
    } catch {
      if (i === tentativas) { res.writeHead(502); return res.end(JSON.stringify({erro:'Serviço indisponível',traceId})); }
    }
  }
}
function criarServidorGateway(urlsOverride = {}) {
  const urlPedidos = urlsOverride.pedidosUrl || PEDIDOS_SERVICE_URL;
  const urlEstoque = urlsOverride.estoqueUrl || ESTOQUE_SERVICE_URL;
  const urlPagamentos = urlsOverride.pagamentosUrl || PAGAMENTOS_SERVICE_URL;

  return http.createServer(async (req, res) => {
    const inicio = performance.now();
    const traceId = /^[a-f0-9]{32}$/.test(req.headers['x-trace-id']) ? req.headers['x-trace-id'] : crypto.randomBytes(16).toString('hex');
    const gatewaySpanId = crypto.randomBytes(8).toString('hex');
    require('./telemetry').observe(req,res,SERVICE_NAME,traceId,gatewaySpanId,null);
    metricas.requestsTotal++;

    res.setHeader('x-trace-id', traceId);
    res.setHeader('x-span-id', gatewaySpanId);

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      metricas.requests2xx++;
      return res.end(renderDashboardHtml());
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'GET' && url.pathname === '/health') {
      metricas.requests2xx++;
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'UP', service: SERVICE_NAME, version: APP_VERSION }));
    }

    if (req.method === 'GET' && url.pathname === '/ready') {
      if (require('./shutdown').emEncerramento()) { res.writeHead(503); return res.end('{"ready":false,"motivo":"encerrando"}'); }
      metricas.requests2xx++;
      res.writeHead(200);
      return res.end(JSON.stringify({
        ready: true,
        upstreams: { pedidos: urlPedidos, estoque: urlEstoque, pagamentos: urlPagamentos }
      }));
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.writeHead(200);
      return res.end([
        '# HELP gateway_http_requests_total Total de requisicoes recebidas no API Gateway',
        '# TYPE gateway_http_requests_total counter',
        `gateway_http_requests_total{service="${SERVICE_NAME}"} ${metricas.requestsTotal}`,
        `gateway_http_responses_total{code="2xx"} ${metricas.requests2xx}`,
        `gateway_http_responses_total{code="4xx"} ${metricas.requests4xx}`,
        `gateway_http_responses_total{code="5xx"} ${metricas.requests5xx}`,
        '# HELP gateway_latency_ms_sum Soma da latencia em milissegundos no API Gateway',
        '# TYPE gateway_latency_ms_sum counter',
        `gateway_latency_ms_sum ${metricas.latenciaSomaMs.toFixed(2)}`
      ].join('\n') + '\n');
    }

    if (req.method === 'GET' && url.pathname === '/api/traces') {
      metricas.requests2xx++;
      res.writeHead(200);
      return res.end(JSON.stringify({
        service: SERVICE_NAME,
        metricas,
        traces: tracesRecentes.slice(0, 15),
        logs: logsCorrelacionados.slice(0, 20)
      }));
    }

    if (req.method === 'GET' && url.pathname === '/api/estoque') {
      return consultar(urlEstoque+'/estoque', res, traceId, gatewaySpanId);
    }
    if(req.method==='GET' && url.pathname==='/api/pedidos'){
      return consultar(urlPedidos+'/pedidos',res,traceId,gatewaySpanId);
    }
    if (req.method === 'POST' && url.pathname === '/api/pedidos') {
      try {
        const body = await lerJsonBody(req);
        const upstream = await fetch(`${urlPedidos}/pedidos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-trace-id': traceId,
            'x-span-id': gatewaySpanId,
            'traceparent': `00-${traceId}-${gatewaySpanId}-01`
          },
          body: JSON.stringify(body)
        });
        const data = await upstream.json();
        const totalDurationMs = Number((performance.now() - inicio).toFixed(2));
        metricas.latenciaSomaMs += totalDurationMs;

        if (upstream.ok) metricas.requests2xx++;
        else if (upstream.status < 500) metricas.requests4xx++;
        else metricas.requests5xx++;

        const traceCompleto = {
          traceId,
          rootSpanId: gatewaySpanId,
          pedidoId: data.pedido ? data.pedido.pedido_id : data.pedido_id,
          status: upstream.status,
          totalDurationMs,
          timestamp: new Date().toISOString(),
          spans: [
            {
              service: 'api-gateway',
              operation: 'POST /api/pedidos (Ingress)',
              spanId: gatewaySpanId,
              parentSpanId: null,
              status: upstream.status,
              durationMs: totalDurationMs
            },
            {
              service: 'pedidos-service',
              operation: 'POST /pedidos (Orquestrador)',
              spanId: data.spanId || crypto.randomBytes(8).toString('hex'),
              parentSpanId: gatewaySpanId,
              status: upstream.status,
              durationMs: data.durationMs ?? totalDurationMs
            },
            ...(data.spans || [])
          ]
        };
        tracesRecentes.unshift(traceCompleto);

        logEstruturado(upstream.ok ? 'INFO' : 'WARN', `Requisição POST /api/pedidos finalizada (${upstream.status})`, {
          traceId, spanId: gatewaySpanId, pedidoId: traceCompleto.pedidoId, statusCode: upstream.status, durationMs: totalDurationMs
        });

        res.writeHead(upstream.status);
        return res.end(JSON.stringify({ ...data, trace: traceCompleto }));
      } catch (err) {
        metricas.requests5xx++;
        res.writeHead(502);
        return res.end(JSON.stringify({ erro: `Falha de comunicação no API Gateway: ${err.message}`, traceId }));
      }
    }

    metricas.requests4xx++;
    res.writeHead(404);
    res.end(JSON.stringify({ erro: 'Rota não encontrada no API Gateway' }));
  });
}

if (require.main === module) {
  const server = criarServidorGateway();
  server.listen(PORT, () => {
    logEstruturado('INFO', `API Gateway iniciado na porta ${PORT}`, { port: PORT });
  });
  require('./shutdown').registrar(server, logEstruturado);
}

module.exports = {
  criarServidorGateway,

  renderDashboardHtml,
  tracesRecentes,
  logsCorrelacionados,
  metricas
};
