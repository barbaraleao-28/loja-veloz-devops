// Desligamento gracioso (12-Factor: disposability).
// Ao receber SIGTERM do Kubernetes, a réplica passa a responder 503 em /ready,
// pede aos clientes que não reutilizem conexões keep-alive e espera alguns segundos
// para os Endpoints pararem de enviar tráfego. Só então fecha o servidor.
let encerrando = false;

function emEncerramento() {
  return encerrando;
}

function registrar(server, log, atrasoMs = Number(process.env.SHUTDOWN_DELAY_MS || 5000)) {
  server.prependListener('request', (req, res) => {
    if (encerrando) res.setHeader('Connection', 'close');
  });
  const parar = sinal => {
    if (encerrando) return;
    encerrando = true;
    log('INFO', `${sinal} recebido: drenando tráfego antes de encerrar`, { atrasoMs });
    setTimeout(() => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
    }, atrasoMs);
    setTimeout(() => process.exit(0), atrasoMs + 15000).unref();
  };
  process.on('SIGTERM', () => parar('SIGTERM'));
  process.on('SIGINT', () => parar('SIGINT'));
}

module.exports = { registrar, emEncerramento };
