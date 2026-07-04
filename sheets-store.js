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
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
    createdAt: row.created_at,
  }));
}

export async function add(subscription) {
  if (!subscription || !subscription.endpoint) return [];

  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('endpoint', subscription.endpoint)
    .maybeSingle();

  if (existing) {
    const subs = await getAll();
    return subs;
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .insert({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh || '',
      auth: subscription.keys?.auth || '',
    });

  if (error) {
    console.error('Error agregando suscripción push:', error.message);
    return await getAll();
  }

  return await getAll();
}

export async function remove(endpoint) {
  if (!endpoint) return [];

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);

  if (error) {
    console.error('Error eliminando suscripción push:', error.message);
  }

  return await getAll();
}

export async function diagnose() {
  const { data, error, count } = await supabase
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: false })
    .limit(1);

  const allSubs = await getAll();

  return {
    ok: !error,
    subscriptionsCount: allSubs.length,
    rawRowCount: allSubs.length,
    header: ['endpoint', 'p256dh', 'auth', 'created_at'],
    firstDataRow: data && data.length > 0 ? {
      endpoint: data[0].endpoint.substring(0, 50) + '...',
      hasKeys: !!(data[0].p256dh && data[0].auth),
    } : null,
    error: error ? error.message : null,
  };
}
