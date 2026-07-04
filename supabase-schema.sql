-- ============================================================
-- Esquema Supabase (PostgreSQL) para Inventario Musical
-- Ejecutar en SQL Editor del dashboard de Supabase
-- ============================================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
  usuario     TEXT PRIMARY KEY,
  hash        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. INVENTORY (multi-usuario)
CREATE TABLE IF NOT EXISTS inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario       TEXT NOT NULL REFERENCES users(usuario) ON DELETE CASCADE,
  discogs_id    TEXT,
  artista       TEXT NOT NULL,
  disco         TEXT NOT NULL,
  año           SMALLINT,
  genero        TEXT,
  tipo          TEXT,
  formato       TEXT,
  estilo        TEXT,
  disqueria     TEXT,
  catalogo      TEXT,
  img           TEXT,
  img_full      TEXT,
  visible       BOOLEAN NOT NULL DEFAULT TRUE,
  recibido      BOOLEAN NOT NULL DEFAULT TRUE,
  orden         TEXT,
  origen        TEXT,
  origen_iso    CHAR(2),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_usuario ON inventory (usuario);
CREATE INDEX IF NOT EXISTS idx_inventory_artista ON inventory (artista);
CREATE INDEX IF NOT EXISTS idx_inventory_visible ON inventory (visible);
CREATE INDEX IF NOT EXISTS idx_inventory_genero  ON inventory (genero);
CREATE INDEX IF NOT EXISTS idx_inventory_orden   ON inventory (orden);

-- 3. WISHLIST (multi-usuario)
CREATE TABLE IF NOT EXISTS wishlist (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario       TEXT NOT NULL REFERENCES users(usuario) ON DELETE CASCADE,
  wishlist_key  TEXT NOT NULL,
  discogs_id    TEXT,
  artista       TEXT NOT NULL,
  disco         TEXT NOT NULL,
  año           SMALLINT,
  tipo          TEXT,
  genero        TEXT,
  img           TEXT,
  img_full      TEXT,
  recibido      BOOLEAN DEFAULT FALSE,
  notes         TEXT,
  priority      TEXT,
  status        TEXT DEFAULT 'wishlist',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),

  UNIQUE (usuario, wishlist_key)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_usuario ON wishlist (usuario);

-- 4. PUSH SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 5. SYNC METADATA (para background-check)
CREATE TABLE IF NOT EXISTS sync_metadata (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Trigger: actualizar updated_at automáticamente
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_wishlist_updated_at
  BEFORE UPDATE ON wishlist
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Insertar usuarios existentes
-- ============================================================
INSERT INTO users (usuario, hash) VALUES
  ('jsuazo', '$2b$10$VT886k5c5AdBAkEALgzv4O/Qp33DnAJTTCW5qhkliEsKKMH0WSg9e'),
  ('sfritz', '$2b$10$QKxxTAO8vvvsfzuJr9xaC.C8RieBERZt/0Vi4DD6NIVs7Q4ZDnQgi')
ON CONFLICT (usuario) DO NOTHING;
