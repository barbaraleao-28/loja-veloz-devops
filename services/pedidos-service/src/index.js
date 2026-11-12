const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PEDIDOS_PORT || process.env.PORT || 3001);
const SERVICE_NAME = 'pedidos-service';
const APP_VERSION = process.env.APP_VERSION || '1.2.1';

const ESTOQUE_SERVICE_URL = process.env.ESTOQUE_SERVICE_URL || 'http://localhost:3003';
const PAGAMENTOS_SERVICE_URL = process.env.PAGAMENTOS_SERVICE_URL || 'http://localhost:3002';

const store = require('./store');


const metricas = {
  requestsTotal: 0,
  pedidosConcluidos: 0,
  pedidosFalha: 0,
  eventosPublicados: 0,
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

async function chamarServicoJson(urlCompleta, payload, { traceId, spanId }) {
  const inicio = performance.now();
  try {
    const res = await fetch(urlCompleta, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trace-id': traceId,
        'x-span-id': spanId,
        'traceparent': `00-${traceId}-${spanId}-01`
      },
      signal: AbortSignal.timeout(5000), body: JSON.stringify(payload)
    });
    const data = await res.json();
    const duracaoMs = Number((performance.now() - inicio).toFixed(2));
    return { status: res.status, ok: res.ok, data, duracaoMs };
  } catch (err) { throw new Error('Serviço indisponível: '+err.message); }
}

async function orquestrarCriacaoPedido(dados, { traceId, spanId, parentSpanId },Urls = {}) {
  const urlEstoque = Urls.estoqueUrl || ESTOQUE_SERVICE_URL;
  const urlPagamentos = Urls.pagamentosUrl || PAGAMENTOS_SERVICE_URL;

  const { cliente_id, sku, quantidade, metodo_pagamento = 'PIX' } = dados;
  if (typeof cliente_id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(cliente_id) || typeof sku !== 'string' || !Number.isSafeInteger(quantidade) || quantidade <= 0 || !['PIX','CARTAO','BOLETO'].includes(metodo_pagamento)) {
    return {
      ok: false,
      codigo: 400,
      erro: 'Campos obrigatórios: cliente_id, sku e quantidade.'
    };
  }

  const pedidoId = 'PED-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const spans = [];

  // Passo 1: Reserva no Estoque-Service
  const resEstoque = await chamarServicoJson(
    `${urlEstoque}/estoque/reservar`,
    { sku, quantidade: Number(quantidade) },
    { traceId, spanId }
  );

  spans.push({
    service: 'estoque-service',
    operation: 'POST /estoque/reservar',
    spanId: resEstoque.data.spanId || crypto.randomBytes(8).toString('hex'),
    parentSpanId: spanId,
    status: resEstoque.status,
    durationMs: resEstoque.duracaoMs
  });

  if (!resEstoque.ok) {
    return {
      ok: false,
      codigo: resEstoque.status,
      erro: resEstoque.data.erro || 'Falha ao reservar estoque',
      pedido_id: pedidoId,
      status: 'FALHA_ESTOQUE',
      spans
    };
  }

  // Passo 2: Processamento no Pagamentos-Service
  const valorTotal = resEstoque.data.valor_total;
  const resPagamento = await chamarServicoJson(
    `${urlPagamentos}/pagamentos/processar`,
    {
      pedido_id: pedidoId,
      cliente_id,
      valor: valorTotal,
      metodo: metodo_pagamento
    },
    { traceId, spanId }
  );

  spans.push({
    service: 'pagamentos-service',
    operation: 'POST /pagamentos/processar',
    spanId: resPagamento.data.spanId || crypto.randomBytes(8).toString('hex'),
    parentSpanId: spanId,
    status: resPagamento.status,
    durationMs: resPagamento.duracaoMs
  });

  if (!resPagamento.ok) {
    if ([400, 422].includes(resPagamento.status)) {
      await store.liberarReserva(resEstoque.data.reserva_id);
    }
    return {
      ok: false,
      codigo: resPagamento.status,
      erro: resPagamento.data.motivo || resPagamento.data.erro || 'Pagamento recusado',
      pedido_id: pedidoId,
      status: 'FALHA_PAGAMENTO',
      spans
    };
  }

  // Passo 3: Persistência do Pedido e Publicação do Evento PedidoCriado (Outbox / Mensageria)
  const novoPedido = {
    pedido_id: pedidoId,
    cliente_id,
    sku,
    produto_nome: resEstoque.data.nome,
    quantidade: Number(quantidade),
    valor_total: valorTotal,
    metodo_pagamento,
    reserva_id: resEstoque.data.reserva_id,
    pagamento_id: resPagamento.data.pagamento_id,
    autorizacao_externa: resPagamento.data.autorizacao_externa,
    status: 'PAGO_E_CONFIRMADO',
    trace_id: traceId,
    criado_em: new Date().toISOString()
  };

  const inicioBanco = performance.now();

  const evento = {
    evento_id: 'EVT-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    tipo: 'PedidoCriado',
    agregado_id: pedidoId,
    trace_id: traceId,
    payload: {
      pedido_id: pedidoId,
      cliente_id,
      sku,
      valor_total: valorTotal,
      status: novoPedido.status
    },
    criado_em: new Date().toISOString()
  };
  await store.save(novoPedido, evento);

  spans.push({
    service: 'pedidos-service',
    operation: 'PostgreSQL: pedido e outbox',
    spanId: crypto.randomBytes(8).toString('hex'),
    parentSpanId: spanId,
    status: 201,
    durationMs: Number((performance.now()-inicioBanco).toFixed(2))
  });

  return {
    ok: true,
    codigo: 201,
    pedido: novoPedido,
    evento_registrado: evento.tipo,
    spans
  };
}

function criarServidorPedidos(urlsOverride = {}) {
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
      try { await store.pool.query('SELECT 1'); res.writeHead(200); return res.end('{"ready":true}'); }
      catch { res.writeHead(503); return res.end('{"ready":false}'); }
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.writeHead(200);
      return res.end([
        '# HELP pedidos_http_requests_total Total de requisicoes HTTP no servico de pedidos',
        '# TYPE pedidos_http_requests_total counter',
        `pedidos_http_requests_total{service="${SERVICE_NAME}"} ${metricas.requestsTotal}`,
        '# HELP pedidos_criados_total Total de pedidos processados por resultado',
        '# TYPE pedidos_criados_total counter',
        `pedidos_criados_total{status="concluido"} ${metricas.pedidosConcluidos}`,
        `pedidos_criados_total{status="falha"} ${metricas.pedidosFalha}`,
        '# HELP pedidos_latency_ms_sum Soma da latencia em milissegundos',
        '# TYPE pedidos_latency_ms_sum counter',
        `pedidos_latency_ms_sum ${metricas.latenciaSomaMs.toFixed(2)}`
      ].join('\n') + '\n');
    }

    if (req.method === 'GET' && url.pathname === '/pedidos') {
      try { const data=await store.list(); res.writeHead(200); return res.end(JSON.stringify(data)); }
      catch { res.writeHead(503); return res.end('{"erro":"Banco indisponível"}'); }
    }

    if (req.method === 'POST' && url.pathname === '/pedidos') {
      try {
        const body = await lerJsonBody(req);
        const resultado = await orquestrarCriacaoPedido(body, { traceId, spanId, parentSpanId }, urlsOverride);
        const duracao = Number((performance.now() - inicio).toFixed(2));
        metricas.latenciaSomaMs += duracao;

        if (!resultado.ok) {
          metricas.pedidosFalha++;
          logEstruturado('WARN', `Falha na criação do pedido: ${resultado.erro}`, {
            traceId, spanId, parentSpanId, status: resultado.status, statusCode: resultado.codigo, durationMs: duracao
          });
          res.writeHead(resultado.codigo);
          return res.end(JSON.stringify({ ...resultado, traceId, spanId, durationMs: duracao }));
        }

        metricas.pedidosConcluidos++;
        logEstruturado('INFO', `Pedido ${resultado.pedido.pedido_id} finalizado e evento PedidoCriado registrado`, {
          traceId, spanId, parentSpanId, pedidoId: resultado.pedido.pedido_id, valorTotal: resultado.pedido.valor_total, statusCode: 201, durationMs: duracao
        });
        res.writeHead(201);
        return res.end(JSON.stringify({ ...resultado, traceId, spanId, durationMs: duracao }));
      } catch (err) {
        metricas.pedidosFalha++;
        logEstruturado('ERROR', `Erro inesperado ao criar pedido: ${err.message}`, { traceId, spanId });
        res.writeHead(500);
        return res.end(JSON.stringify({ erro: err.message, traceId }));
      }
    }

    res.writeHead(404);
    res.end(JSON.stringify({ erro: 'Rota não encontrada no pedidos-service' }));
  });
}

if (require.main === module) {
  store.start();
  const server = criarServidorPedidos();
  server.listen(PORT, () => {
    logEstruturado('INFO', `Microsserviço ${SERVICE_NAME} iniciado na porta ${PORT}`, { port: PORT });
  });
  require('./shutdown').registrar(server, logEstruturado);
}

module.exports = { criarServidorPedidos, orquestrarCriacaoPedido };
