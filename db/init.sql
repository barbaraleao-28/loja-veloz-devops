-- ============================================================================
-- LOJA VELOZ - Plataforma Distribuída "Pedidos Veloz"
-- Script de inicialização do Banco de Dados PostgreSQL
-- ============================================================================

CREATE TABLE IF NOT EXISTS produtos_estoque (
    sku VARCHAR(50) PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    preco_unitario NUMERIC(10, 2) NOT NULL,
    quantidade_disponivel INTEGER NOT NULL CHECK (quantidade_disponivel >= 0),
    quantidade_reservada INTEGER NOT NULL DEFAULT 0,
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pedidos (
    id VARCHAR(64) PRIMARY KEY,
    cliente_id VARCHAR(64) NOT NULL,
    sku VARCHAR(50) NOT NULL REFERENCES produtos_estoque(sku),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    valor_total NUMERIC(10, 2) NOT NULL,
    status VARCHAR(30) NOT NULL, -- CRIADO, RESERVADO, PAGO, FALHA
    pagamento_id VARCHAR(64),
    trace_id VARCHAR(64) NOT NULL,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pagamentos (
    id VARCHAR(64) PRIMARY KEY,
    pedido_id VARCHAR(64) NOT NULL,
    valor NUMERIC(10, 2) NOT NULL,
    metodo VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL, -- APROVADO, RECUSADO
    autorizacao_externa VARCHAR(64),
    trace_id VARCHAR(64) NOT NULL,
    processado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eventos_outbox (
    id SERIAL PRIMARY KEY,
    tipo_evento VARCHAR(60) NOT NULL, -- ex: PedidoCriado, PagamentoAprovado
    Agregado_id VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    trace_id VARCHAR(64) NOT NULL,
    publicado BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Carga inicial de produtos para a campanha promocional da Loja Veloz
INSERT INTO produtos_estoque (sku, nome, preco_unitario, quantidade_disponivel, quantidade_reservada)
VALUES
    ('SKU-NOTE-01', 'Notebook Gamer Veloz Pro 16GB', 4899.90, 45, 2),
    ('SKU-MON-02', 'Monitor Ultrawide 34" 144Hz', 2199.00, 80, 5),
    ('SKU-TEC-03', 'Teclado Mecânico RGB Switch Blue', 349.90, 150, 12),
    ('SKU-MOU-04', 'Mouse Wireless UltraLeve 26000 DPI', 289.50, 200, 8),
    ('SKU-HEAD-05', 'Headset Surround 7.1 Cancelamento Ruído', 499.00, 65, 3)
ON CONFLICT (sku) DO NOTHING;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS detalhes JSONB;

CREATE TABLE IF NOT EXISTS reservas (
    id TEXT PRIMARY KEY,
    sku VARCHAR(64) NOT NULL REFERENCES produtos_estoque(sku),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    estado TEXT NOT NULL CHECK (estado IN ('aberta', 'baixada', 'liberada'))
);
