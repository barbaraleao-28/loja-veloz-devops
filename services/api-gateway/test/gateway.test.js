const test = require('node:test');
const assert = require('node:assert/strict');
const { criarServidorGateway, renderDashboardHtml } = require('../src/index');
test('Gateway sinaliza falha quando Pedidos está indisponível', async () => {
  const srv=criarServidorGateway({pedidosUrl:'http://127.0.0.1:1'});
  await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));
  try {
    const r=await fetch('http://127.0.0.1:'+srv.address().port+'/api/pedidos');
    assert.equal(r.status,502);
  } finally {await new Promise(ok=>srv.close(ok));}
});
test('Painel disponibiliza tabela de pedidos',()=>assert.match(renderDashboardHtml(),/tabela-pedidos/));
test('Gateway responde /health para a livenessProbe', async () => {
  const srv=criarServidorGateway({pedidosUrl:'http://127.0.0.1:1'});
  await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));
  try {
    const r=await fetch('http://127.0.0.1:'+srv.address().port+'/health');
    assert.equal(r.status,200);
    assert.equal((await r.json()).status,'UP');
  } finally {await new Promise(ok=>srv.close(ok));}
});
