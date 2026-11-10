// Cierre de contramuestra: único canal de escritura para la nueva UI.
// La decisión OK/DISCREPANCIA se calcula en la RPC, no en el navegador.
// El servidor recupera cantidad defectuosa digital y valida autor/estado.
export async function completarContramuestraEnServidor(supabase, verificacionId, hallazgo) {
  if (!supabase || typeof supabase.rpc !== 'function' ||
      typeof verificacionId !== 'string' || !verificacionId ||
      !hallazgo || typeof hallazgo !== 'object') {
    return null;
  }

  const args = {
    p_verificacion_id: verificacionId,
    p_muestras_presentes: hallazgo.muestrasPresentes,
    p_cantidad_encontrada: hallazgo.cantidadEncontrada,
    p_defectuosos_encontrados: hallazgo.defectuososEncontrados,
    p_coincide_etiqueta_lote: hallazgo.coincideEtiquetaLote,
    p_coincide_caja: hallazgo.coincideCaja,
    p_observaciones: hallazgo.observaciones || null,
  };
  try {
    const { data, error } = await supabase.rpc('vf_completar_contramuestra_segura', args);
    if (error || !data || data.verificacion_id !== verificacionId ||
        !['OK', 'DISCREPANCIA'].includes(data.resultado) ||
        data.cantidad_encontrada !== hallazgo.cantidadEncontrada ||
        data.defectuosos_encontrados !== hallazgo.defectuososEncontrados) {
      return null;
    }
    return { id: verificacionId, resultado: data.resultado, duplicado: data.duplicado === true };
  } catch {
    return null;
  }
}
