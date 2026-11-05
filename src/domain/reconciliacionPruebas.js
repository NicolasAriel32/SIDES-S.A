// Exclusión por señal usando Web Locks (origin + perfil del navegador).
// Fail-closed: localStorage NO ofrece compare-and-swap atómico entre pestañas.
export async function conBloqueoDePrueba(lockManager, legajo, maquina, requestId, operacion) {
  if (!lockManager || typeof lockManager.request !== 'function') {
    throw new Error('Este navegador no admite bloqueo seguro entre pestañas. No se envió la prueba.');
  }
  if (!legajo || !maquina || !requestId || typeof operacion !== 'function') {
    throw new Error('Solicitud incompleta para bloqueo de envío.');
  }
  const nombre = ['spc-001', legajo, maquina, requestId].map(encodeURIComponent).join(':');
  return lockManager.request(nombre, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw new Error('La prueba se está procesando en otra pestaña. Esperá y volvé a revisar.');
    return operacion();
  });
}

// Consultar por UUID antes de reenviar si el resultado previo fue ambiguo.
// Sólo se puede afirmar "no encontrada" cuando la lectura está autorizada y fue exitosa.
export async function consultarConfirmacionPrueba(cliente, requestId) {
  if (!requestId) return { estado: 'INCIERTO', motivo: 'UUID ausente' };
  try {
    const { data, error } = await cliente.from('pruebas')
      .select('id,numero_secuencial,spc_request_id')
      .eq('spc_request_id', requestId).maybeSingle();
    if (error) return { estado: 'INCIERTO', motivo: error.message };
    if (!data) return { estado: 'NO_ENCONTRADA' };
    return { estado: 'CONFIRMADA', pruebaId: data.id, numeroSecuencial: data.numero_secuencial };
  } catch (e) {
    return { estado: 'INCIERTO', motivo: e?.message || 'Sin conexión' };
  }
}
