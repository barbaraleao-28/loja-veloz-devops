// Envia um span OTLP/HTTP para cada requisição de negócio concluída.
function observe(req, res, service, traceId, spanId, parentSpanId) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || req.method !== 'POST') return;
  const started = BigInt(Date.now()) * 1000000n;
  const tick = process.hrtime.bigint();
  res.once('finish', () => {
    const span = {
      traceId, spanId, name: req.method + ' ' + req.url.split('?')[0], kind: 2,
      startTimeUnixNano: started.toString(),
      endTimeUnixNano: (started + process.hrtime.bigint() - tick).toString(),
      attributes: [{key:'http.response.status_code',value:{intValue:String(res.statusCode)}}],
      status: {code:res.statusCode >= 500 ? 2 : 0}
    };
    if (parentSpanId) span.parentSpanId = parentSpanId;
    const body={resourceSpans:[{
      resource:{attributes:[{key:'service.name',value:{stringValue:service}}]},
      scopeSpans:[{scope:{name:'pedidos-veloz.http'},spans:[span]}]
    }]};
    fetch(endpoint.replace(/\/$/, '')+'/v1/traces',{
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(2500)
    }).then(r=>{if(!r.ok)throw Error('OTLP HTTP '+r.status);})
      .catch(e=>console.error(JSON.stringify({service,telemetria:e.message})));
  });
}
module.exports={observe};
