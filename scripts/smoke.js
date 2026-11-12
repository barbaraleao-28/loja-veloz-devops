const assert=require('node:assert/strict');
const base=process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
async function run(){
  const input={cliente_id:'CLI-TESTE',sku:'SKU-MOU-04',quantidade:1,metodo_pagamento:'PIX'};
  const res=await fetch(base+'/api/pedidos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  const result=await res.json();
  assert.equal(res.status,201,JSON.stringify(result));
  const lista=await (await fetch(base+'/api/pedidos')).json();
  assert.ok(lista.pedidos.some(p=>p.pedido_id===result.pedido.pedido_id));
  console.log(JSON.stringify({http:res.status,pedido:result.pedido,traceId:result.traceId,consulta:'OK'},null,2));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
