// Gera tráfego contínuo de leitura (GET /api/pedidos) e conta respostas por status.
// Uso: GATEWAY_URL=http://127.0.0.1:18081 DURACAO_S=60 CONCORRENCIA=20 node scripts/carga.js
const base = process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
const duracaoMs = Number(process.env.DURACAO_S || 60) * 1000;
const concorrencia = Number(process.env.CONCORRENCIA || 20);
const fim = Date.now() + duracaoMs;
const contagem = {};
let total = 0;

async function trabalhador() {
  while (Date.now() < fim) {
    let chave;
    try {
      const r = await fetch(base + '/api/pedidos', { signal: AbortSignal.timeout(5000) });
      await r.arrayBuffer();
      chave = String(r.status);
    } catch (e) {
      chave = 'erro_rede';
    }
    contagem[chave] = (contagem[chave] || 0) + 1;
    total++;
  }
}

Promise.all(Array.from({ length: concorrencia }, trabalhador)).then(() => {
  const ok = contagem['200'] || 0;
  console.log(JSON.stringify({ total, por_status: contagem, sucesso_pct: Number((100 * ok / total).toFixed(2)) }));
});
