-- Asocia las suscripciones push a su usuario propietario.
-- Las suscripciones existentes quedan sin propietario hasta que ese dispositivo
-- inicie sesión nuevamente y la aplicación las vuelva a registrar.

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS usuario TEXT REFERENCES users(usuario) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_usuario
  ON push_subscriptions (usuario);

-- Verificación: el resultado debería bajar a cero cuando los dispositivos
-- existentes hayan vuelto a iniciar sesión.
SELECT COUNT(*) AS suscripciones_sin_propietario
FROM push_subscriptions
WHERE usuario IS NULL;
