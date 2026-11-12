const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PAGAMENTOS_PORT || process.env.PORT || 3002);
const SERVICE_NAME = 'pagamentos-service';
const APP_VERSION = process.env.APP_VERSION || '1.2.1';
// A chave vem do ambiente (Secret no Kubernetes). Sem ela a réplica não deve receber tráfego.
const providerKeyPresent = () => Boolean(process.env.PAYMENT_PROVIDER_API_KEY);

const historicoPagamentos = [];
const metricas = {
  requestsTotal: 0,
  pagamentosAprovados: 0,
  pagamentosRecusados: 0,
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
  console.log(JSON.stringify(entry));
}

function extrairTraceContext(req) {
  const traceId = req.headers['x-trace-id'] || crypto.randomBytes(16).toString('hex');
  const parentSpanId = req.headers['x-span-id'] || null;
  const spanId = crypto.randomBytes(8).toString('hex');
  return { traceId, parentSpanId, spanId };
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

function processarTransacao({ pedido_id, valor, metodo = 'PIX', cliente_id }) {
  if (!pedido_id || typeof valor !== 'number' || valor <= 0) {
    return {
      ok: false,
      codigo: 400,
      erro: 'Dados de pagamento inválidos: pedido_id e valor positivo são obrigatórios.'
    };
  }

  // Regra de simulação de antifraude / limite do gateway externo
  if (valor > 50000) {
    return {
      ok: false,
      codigo: 422,
      transacao: {
        pagamento_id: 'PAY-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        pedido_id,
        valor,
        metodo,
        status: 'RECUSADO',
        motivo: 'Valor acima do limite automático do adquirente externo'
      }
    };
  }

  const transacao = {
    pagamento_id: 'PAY-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    pedido_id,
    cliente_id: cliente_id || 'CLI-ANON',
    valor: Number(valor.toFixed(2)),
    metodo,
    status: 'APROVADO',
    autorizacao_externa: 'AUTH-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
    processado_em: new Date().toISOString()
  };

  historicoPagamentos.unshift(transacao);
  return { ok: true, codigo: 200, transacao };
}

function criarServidorPagamentos() {
  return http.createServer(async (req, res) => {
    const inicio = performance.now();
    const { traceId, parentSpanId, spanId } = extrairTraceContext(req);
    require('./telemetry').observe(req,res,SERVICE_NAME,traceId,spanId,parentSpanId);
    metricas.requestsTotal++;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('x-trace-id', traceId);
    res.setHeader('x-span-id', spanId);

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'UP', service: SERVICE_NAME, version: APP_VERSION }));
    }

    if (req.method === 'GET' && url.pathname === '/ready') {
      if (require('./shutdown').emEncerramento()) { res.writeHead(503); return res.end('{"ready":false,"motivo":"encerrando"}'); }
      const pronto = providerKeyPresent();
      res.writeHead(pronto ? 200 : 503);
      return res.end(JSON.stringify({ ready: pronto, provider_key_configured: pronto }));
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.writeHead(200);
      return res.end([
        '# HELP pagamentos_http_requests_total Total de requisicoes HTTP no servico de pagamentos',
        '# TYPE pagamentos_http_requests_total counter',
        `pagamentos_http_requests_total{service="${SERVICE_NAME}"} ${metricas.requestsTotal}`,
        '# HELP pagamentos_transacoes_total Total de pagamentos processados por status',
        '# TYPE pagamentos_transacoes_total counter',
        `pagamentos_transacoes_total{status="aprovado"} ${metricas.pagamentosAprovados}`,
        `pagamentos_transacoes_total{status="recusado"} ${metricas.pagamentosRecusados}`,
        '# HELP pagamentos_latency_ms_sum Soma da latencia em milissegundos',
        '# TYPE pagamentos_latency_ms_sum counter',
        `pagamentos_latency_ms_sum ${metricas.latenciaSomaMs.toFixed(2)}`
      ].join('\n') + '\n');
    }

    if (req.method === 'GET' && url.pathname === '/pagamentos') {
      res.writeHead(200);
      return res.end(JSON.stringify({ service: SERVICE_NAME, total: historicoPagamentos.length, pagamentos: historicoPagamentos.slice(0, 25) }));
    }

    if (req.method === 'POST' && url.pathname === '/pagamentos/processar') {
      try {
        const body = await lerJsonBody(req);
        const resultado = processarTransacao(body);
        const duracao = Number((performance.now() - inicio).toFixed(2));
        metricas.latenciaSomaMs += duracao;

        if (!resultado.ok) {
          metricas.pagamentosRecusados++;
          logEstruturado('WARN', `Pagamento recusado ou inválido para pedido ${body.pedido_id}`, {
            traceId, spanId, parentSpanId, pedidoId: body.pedido_id, valor: body.valor, statusCode: resultado.codigo, durationMs: duracao
          });
          res.writeHead(resultado.codigo);
          return res.end(JSON.stringify({ ...(resultado.transacao || { erro: resultado.erro }), traceId, spanId }));
        }

        metricas.pagamentosAprovados++;
        logEstruturado('INFO', `Pagamento ${resultado.transacao.pagamento_id} aprovado via ${resultado.transacao.metodo}`, {
          traceId, spanId, parentSpanId, pagamentoId: resultado.transacao.pagamento_id, pedidoId: body.pedido_id, valor: body.valor, autorizacao: resultado.transacao.autorizacao_externa, statusCode: 200, durationMs: duracao
        });
        res.writeHead(200);
        return res.end(JSON.stringify({ ...resultado.transacao, traceId, spanId, durationMs: duracao }));
      } catch (err) {
        res.writeHead(400);
        return res.end(JSON.stringify({ erro: err.message, traceId }));
      }
    }

    res.writeHead(404);
    res.end(JSON.stringify({ erro: 'Rota não encontrada no pagamentos-service' }));
  });
}

if (require.main === module) {
  const server = criarServidorPagamentos();
  server.listen(PORT, () => {
    logEstruturado('INFO', `Microsserviço ${SERVICE_NAME} iniciado na porta ${PORT}`, { port: PORT });
  });
  require('./shutdown').registrar(server, logEstruturado);
}

module.exports = { criarServidorPagamentos, processarTransacao };
