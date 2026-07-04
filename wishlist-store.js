import { supabase } from './db.js';

function normalizeWishlistItem(item = {}) {
  const numericDiscogsId = String(item.discogsId || item.ID || '').replace(/\D+/g, '');
  return {
    wishlist_key: buildWishlistKey(item),
    discogs_id: numericDiscogsId || '',
    artista: item.Artista || '',
    disco: item.Disco || '',
    año: item.Año ? Number(item.Año) : null,
    tipo: item.Tipo || '',
    genero: item.Genero || '',
    img: item.img || '',
    img_full: item.imgFULL || '',
    recibido: item.Recibido ? item.Recibido === 'SI' || item.Recibido === true : false,
    notes: item.notes || '',
    priority: item.priority || '',
    status: item.status || 'wishlist',
  };
}

function denormalizeWishlistItem(row) {
  if (!row) return null;
  return {
    rowId: row.id,
    usuario: row.usuario,
    wishlistKey: row.wishlist_key,
    discogsId: row.discogs_id,
    Artista: row.artista,
    Disco: row.disco,
    Año: row.año ? String(row.año) : '',
    Tipo: row.tipo,
    Genero: row.genero,
    img: row.img,
    imgFULL: row.img_full,
    Recibido: row.recibido ? 'SI' : 'NO',
    notes: row.notes,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function buildWishlistKey(item = {}) {
  if (item.discogsId || item.ID) {
    return `discogs:${String(item.discogsId || item.ID).trim()}`;
  }

  const artista = String(item.Artista || '').trim().toLowerCase();
  const disco = String(item.Disco || '').trim().toLowerCase();
  const anio = String(item.Año || '').trim().toLowerCase();
  const tipo = String(item.Tipo || '').trim().toLowerCase();

  return `wanted:${artista}|${disco}|${anio}|${tipo}`;
}

export async function getAll() {
  const { data, error } = await supabase
    .from('wishlist')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error leyendo wishlist:', error.message);
    return [];
  }

  return (data || []).map(denormalizeWishlistItem);
}

export async function getByUser(usuario) {
  const { data, error } = await supabase
    .from('wishlist')
    .select('*')
    .eq('usuario', usuario)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`Error leyendo wishlist de ${usuario}:`, error.message);
    return [];
  }

  return (data || []).map(denormalizeWishlistItem);
}

export async function add(usuario, item) {
  const wishlistKey = buildWishlistKey(item);

  const { data: existing } = await supabase
    .from('wishlist')
    .select('*')
    .eq('usuario', usuario)
    .eq('wishlist_key', wishlistKey)
    .maybeSingle();

  if (existing) {
    return denormalizeWishlistItem(existing);
  }

  const normalized = normalizeWishlistItem(item);

  const { data, error } = await supabase
    .from('wishlist')
    .insert({ ...normalized, usuario })
    .select()
    .single();

  if (error) {
    console.error('Error agregando a wishlist:', error.message);
    throw new Error('Error al guardar en wishlist');
  }

  return denormalizeWishlistItem(data);
}

export async function remove(usuario, rowId) {
  const { data, error } = await supabase
    .from('wishlist')
    .delete()
    .eq('usuario', usuario)
    .eq('id', rowId)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') return false;
    console.error('Error quitando de wishlist:', error.message);
    throw new Error('Error al quitar de wishlist');
  }

  return !!data;
}

export async function update(usuario, rowId, item) {
  const wishlistKey = buildWishlistKey(item);

  if (wishlistKey) {
    const { data: duplicated } = await supabase
      .from('wishlist')
      .select('id')
      .eq('usuario', usuario)
      .eq('wishlist_key', wishlistKey)
      .neq('id', rowId)
      .maybeSingle();

    if (duplicated) {
      return denormalizeWishlistItem(duplicated);
    }
  }

  const normalized = normalizeWishlistItem(item);

  const { data, error } = await supabase
    .from('wishlist')
    .update(normalized)
    .eq('usuario', usuario)
    .eq('id', rowId)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error actualizando wishlist:', error.message);
    throw new Error('Error al actualizar wishlist');
  }

  return denormalizeWishlistItem(data);
}
