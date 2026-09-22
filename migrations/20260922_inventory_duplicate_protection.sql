-- Protección contra discos duplicados por usuario y formato.
--
-- 1. Ejecuta primero las consultas de diagnóstico. Si devuelven filas,
--    resuelve esos duplicados manualmente antes de continuar: este script no borra datos.

SELECT
  usuario,
  discogs_id,
  lower(btrim(COALESCE(formato, ''))) AS formato_normalizado,
  COUNT(*) AS cantidad,
  array_agg(id ORDER BY created_at) AS ids
FROM inventory
WHERE NULLIF(btrim(discogs_id), '') IS NOT NULL
GROUP BY usuario, discogs_id, lower(btrim(COALESCE(formato, '')))
HAVING COUNT(*) > 1;

SELECT
  usuario,
  lower(btrim(artista)) AS artista_normalizado,
  lower(btrim(disco)) AS disco_normalizado,
  COALESCE(año, -1) AS año_normalizado,
  lower(btrim(COALESCE(formato, ''))) AS formato_normalizado,
  COUNT(*) AS cantidad,
  array_agg(id ORDER BY created_at) AS ids
FROM inventory
WHERE NULLIF(btrim(discogs_id), '') IS NULL
GROUP BY
  usuario,
  lower(btrim(artista)),
  lower(btrim(disco)),
  COALESCE(año, -1),
  lower(btrim(COALESCE(formato, '')))
HAVING COUNT(*) > 1;

-- 2. Ejecuta estas sentencias solo cuando las consultas anteriores no devuelvan filas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unique_discogs_format
  ON inventory (usuario, discogs_id, lower(btrim(COALESCE(formato, ''))))
  WHERE NULLIF(btrim(discogs_id), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unique_manual_format
  ON inventory (
    usuario,
    lower(btrim(artista)),
    lower(btrim(disco)),
    COALESCE(año, -1),
    lower(btrim(COALESCE(formato, '')))
  )
  WHERE NULLIF(btrim(discogs_id), '') IS NULL;
