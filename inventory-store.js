import { supabase } from './db.js';

function normalizeItem(item = {}) {
  const numericDiscogsId = String(item.discogsId || item.ID || '').replace(/\D+/g, '');
  return {
    discogs_id: numericDiscogsId ? `r${numericDiscogsId}` : (item.ID || ''),
    artista: item.Artista || '',
    disco: item.Disco || '',
    año: item.Año ? Number(item.Año) : null,
    genero: item.Genero || '',
    tipo: item.Tipo || '',
    formato: item.Formato || '',
    estilo: item.Estilo || item.Estilos || '',
    disqueria: item.Disqueria || item.Sello || item.Label || '',
    catalogo: item.Catalogo || item.Catalog || '',
    img: item.img || '',
    img_full: item.imgFULL || '',
    visible: item.Visible ? item.Visible === 'SI' || item.Visible === true : true,
    recibido: item.Recibido ? item.Recibido === 'SI' || item.Recibido === true : true,
    orden: item.Orden || `${(item.Artista || '').toLowerCase()} - ${item.Año || ''}`,
    origen: item.Origen || item.Pais || item.País || '',
    origen_iso: item.OrigenISO || item.PaisISO || item.PaísISO || '',
  };
}

function denormalizeItem(row) {
  if (!row) return null;
  return {
    ID: row.discogs_id || '',
    Artista: row.artista || '',
    Disco: row.disco || '',
    Año: row.año ? String(row.año) : '',
    Genero: row.genero || '',
    Tipo: row.tipo || '',
    Formato: row.formato || '',
    Estilo: row.estilo || '',
    Disqueria: row.disqueria || '',
    Catalogo: row.catalogo || '',
    img: row.img || '',
    imgFULL: row.img_full || '',
    Visible: row.visible ? 'SI' : 'NO',
    Recibido: row.recibido ? 'SI' : 'NO',
    Orden: row.orden || '',
    Origen: row.origen || '',
    OrigenISO: row.origen_iso || '',
  };
}

export async function getAll(usuario = null) {
  let query = supabase.from('inventory').select('*');

  if (usuario) {
    query = query.eq('usuario', usuario);
  }

  const { data, error } = await query.order('orden');

  if (error) {
    console.error('Error leyendo inventario:', error.message);
    return [];
  }

  return (data || []).map(denormalizeItem);
}

export async function getPublic() {
  const { data, error } = await supabase
    .from('inventory')
    .select('*')
    .eq('visible', true)
    .order('orden');

  if (error) {
    console.error('Error leyendo inventario público:', error.message);
    return [];
  }

  const items = (data || []).map(denormalizeItem);
  console.log(`📀 [Supabase] Inventario público: ${items.length} items cargados desde PostgreSQL`);
  return items;
}

export async function add(item, usuario) {
  const normalized = normalizeItem(item);

  const { data, error } = await supabase
    .from('inventory')
    .insert({ ...normalized, usuario })
    .select()
    .single();

  if (error) {
    console.error('Error agregando a inventario:', error.message);
    throw new Error('Error al guardar en inventario');
  }

  return denormalizeItem(data);
}

export async function update(originalItem, item, usuario) {
  const normalized = normalizeItem(item);

  const { data, error } = await supabase
    .from('inventory')
    .update(normalized)
    .eq('usuario', usuario)
    .eq('id', originalItem.id || originalItem.ID)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error actualizando inventario:', error.message);
    throw new Error('Error al actualizar inventario');
  }

  return denormalizeItem(data);
}

export async function softRemove(originalItem, usuario) {
  const { data, error } = await supabase
    .from('inventory')
    .update({ visible: false })
    .eq('usuario', usuario)
    .eq('id', originalItem.id || originalItem.ID)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error ocultando inventario:', error.message);
    throw new Error('Error al ocultar inventario');
  }

  return denormalizeItem(data);
}

export async function markReceived(originalItem, usuario) {
  const { data, error } = await supabase
    .from('inventory')
    .update({ recibido: true })
    .eq('usuario', usuario)
    .eq('id', originalItem.id || originalItem.ID)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error marcando como recibido:', error.message);
    throw new Error('Error al marcar como recibido');
  }

  return denormalizeItem(data);
}

export async function getLastUpdatedAt() {
  const { data, error } = await supabase
    .from('inventory')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return new Date(data[0].updated_at).getTime();
}
