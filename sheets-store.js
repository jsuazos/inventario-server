import { supabase } from './db.js';

export async function getAll() {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error leyendo suscripciones push:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    usuario: row.usuario,
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
    createdAt: row.created_at,
  }));
}

export async function getByUser(usuario) {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('usuario', usuario)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error leyendo suscripciones push del usuario:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    usuario: row.usuario,
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
    createdAt: row.created_at,
  }));
}

export async function add(subscription, usuario) {
  if (!subscription || !subscription.endpoint || !usuario) {
    throw new Error('Suscripción o usuario inválidos');
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      usuario,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh || '',
      auth: subscription.keys?.auth || '',
    }, { onConflict: 'endpoint' });

  if (error) {
    console.error('Error agregando suscripción push:', error.message);
    throw new Error('Error al guardar suscripción push');
  }

  return true;
}

export async function remove(endpoint, usuario) {
  if (!endpoint || !usuario) return false;

  const { data, error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('usuario', usuario)
    .select('endpoint');

  if (error) {
    console.error('Error eliminando suscripción push:', error.message);
    throw new Error('Error al eliminar suscripción push');
  }

  return (data || []).length > 0;
}

export async function removeAny(endpoint) {
  if (!endpoint) return false;

  const { data, error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .select('endpoint');

  if (error) {
    console.error('Error eliminando suscripción push inválida:', error.message);
    return false;
  }

  return (data || []).length > 0;
}

export async function diagnose() {
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: true });

  return {
    ok: !error,
    subscriptionsCount: count || 0,
    error: error ? error.message : null,
  };
}
