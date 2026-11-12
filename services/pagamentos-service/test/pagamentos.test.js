const test = require('node:test');
const assert = require('node:assert/strict');
const { processarTransacao } = require('../src/index');

test('pagamentos-service: deve aprovar pagamento válido dentro do limite operacional', () => {
  const res = processarTransacao({
    pedido_id: 'PED-1001',
    cliente_id: 'CLI-01',
    valor: 2199.00,
    metodo: 'PIX'
  });

  assert.equal(res.ok, true);
  assert.equal(res.codigo, 200);
  assert.equal(res.transacao.status, 'APROVADO');
  assert.match(res.transacao.pagamento_id, /^PAY-/);
  assert.match(res.transacao.autorizacao_externa, /^AUTH-/);
});

test('pagamentos-service: deve recusar pagamento acima do teto antifraude (R$ 50.000)', () => {
  const res = processarTransacao({
    pedido_id: 'PED-9999',
    cliente_id: 'CLI-02',
    valor: 75000.00,
    metodo: 'CARTAO_CREDITO'
  });

  assert.equal(res.ok, false);
  assert.equal(res.codigo, 422);
  assert.equal(res.transacao.status, 'RECUSADO');
});

test('pagamentos-service: deve rejeitar payload sem pedido_id ou valor inválido', () => {
  const res = processarTransacao({ pedido_id: '', valor: -10 });
  assert.equal(res.ok, false);
  assert.equal(res.codigo, 400);
});

test('pagamentos-service: /ready só indica prontidão quando a chave do provedor está configurada', async () => {
  const { criarServidorPagamentos } = require('../src/index');
  const original = process.env.PAYMENT_PROVIDER_API_KEY;
  const srv = criarServidorPagamentos();
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + srv.address().port + '/ready';
  try {
    delete process.env.PAYMENT_PROVIDER_API_KEY;
    assert.equal((await fetch(url)).status, 503);
    process.env.PAYMENT_PROVIDER_API_KEY = 'sk_test_unitario';
    assert.equal((await fetch(url)).status, 200);
  } finally {
    if (original === undefined) delete process.env.PAYMENT_PROVIDER_API_KEY;
    else process.env.PAYMENT_PROVIDER_API_KEY = original;
    await new Promise(ok => srv.close(ok));
  }
});
