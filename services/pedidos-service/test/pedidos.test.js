const test = require('node:test');
const assert = require('node:assert/strict');
const { orquestrarCriacaoPedido } = require('../src/index');

test('pedidos-service: deve rejeitar pedido com campos obrigatórios ausentes', async () => {
  const resultado = await orquestrarCriacaoPedido(
    { cliente_id: '', sku: '' },
    { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', parentSpanId: null }
  );

  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 400);
});

test('pedidos-service: deve rejeitar método de pagamento não suportado', async () => {
  const resultado = await orquestrarCriacaoPedido(
    { cliente_id: 'CLI-01', sku: 'SKU-MOU-04', quantidade: 1, metodo_pagamento: 'CHEQUE' },
    { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', parentSpanId: null }
  );
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 400);
});
