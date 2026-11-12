const { Pool } = require('pg');
const { createClient } = require('redis');
const pool = new Pool({
  host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD, connectionTimeoutMillis: 2500
});
const redis = createClient({url: process.env.REDIS_URL, disableOfflineQueue: true,
  socket: {connectTimeout: 2500}});
redis.on('error', e => console.error(JSON.stringify({service:'pedidos-service', erro:e.message})));

async function encerrarReserva(db, reservaId, estado) {
  const result = await db.query(`
    WITH reserva AS (
      UPDATE reservas SET estado = $2 WHERE id = $1 AND estado = 'aberta'
      RETURNING sku, quantidade
    )
    UPDATE produtos_estoque p SET
      quantidade_reservada = p.quantidade_reservada - r.quantidade,
      quantidade_disponivel = p.quantidade_disponivel +
        CASE WHEN $2 = 'liberada' THEN r.quantidade ELSE 0 END
    FROM reserva r WHERE p.sku = r.sku`, [reservaId, estado]);
  return result.rowCount;
}

async function liberarReserva(reservaId) {
  await encerrarReserva(pool, reservaId, 'liberada');
}

async function save(order, event) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (!await encerrarReserva(db, order.reserva_id, 'baixada')) throw new Error('Reserva indisponível para baixa');
    await db.query('INSERT INTO pedidos (id,cliente_id,sku,quantidade,valor_total,status,pagamento_id,trace_id,detalhes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [order.pedido_id,order.cliente_id,order.sku,order.quantidade,order.valor_total,order.status,order.pagamento_id,order.trace_id,order]);
    await db.query('INSERT INTO eventos_outbox(tipo_evento,agregado_id,payload,trace_id,publicado) VALUES($1,$2,$3,$4,false)',
      [event.tipo,order.pedido_id,event,order.trace_id]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
async function list() {
  const orders=await pool.query('SELECT detalhes, count(*) OVER() AS total FROM pedidos ORDER BY criado_em DESC LIMIT 30');
  const events=await pool.query('SELECT payload, publicado FROM eventos_outbox ORDER BY id DESC LIMIT 10');
  return {total:Number(orders.rows[0]?.total||0), pedidos:orders.rows.map(r=>r.detalhes),
    eventos_recentes:events.rows.map(r=>({...r.payload,publicado:r.publicado}))};
}
let busy=false;
async function publish() {
  if (busy || !redis.isReady) return;
  busy=true;
  let db;
  try {
    db=await pool.connect();
    await db.query('BEGIN');
    const {rows}=await db.query('SELECT id,payload FROM eventos_outbox WHERE NOT publicado ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED');
    for (const row of rows) {
      await redis.xAdd('pedidos:eventos','*',{evento:JSON.stringify(row.payload)});
      await db.query('UPDATE eventos_outbox SET publicado=true WHERE id=$1',[row.id]);
    }
    await db.query('COMMIT');
  } catch(error) {
    if(db) await db.query('ROLLBACK');
    console.error(JSON.stringify({etapa:'outbox',erro:error.message}));
  } finally { if(db) db.release(); busy=false; }
}
function start() {
  redis.connect().catch(e=>console.error(e.message));
  setInterval(publish,750).unref();
}
module.exports={pool,save,list,start,liberarReserva};
