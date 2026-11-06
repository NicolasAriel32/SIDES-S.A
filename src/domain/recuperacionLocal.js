// SPC-001 Fase 3: clasificación y recuperación conservadora de registros locales.
// Nunca crea pruebas ni confirma resultados sin consultar el servidor autenticado.
const resultado = (estado, mensaje, extra = {}) => ({ estado, mensaje, ...extra });

export function inspeccionarRegistrosLocales({ maquinaId, senales, borradores, intentos }) {
  const senalLeida = senales.leer(maquinaId);
  const borradorLeido = borradores.inspeccionar(maquinaId);
  const intento = intentos.leer(maquinaId);

  if (senalLeida.error || borradorLeido.error || intento?.error) {
    return resultado('INTERVENCION', senalLeida.error || borradorLeido.error ||
      intento.error, { requestId: null });
  }

  const senal = senalLeida.senal;
  const borrador = borradorLeido.borrador;
  const ids = [senal?.requestId, borradorLeido.requestId, intento?.requestId].filter(Boolean);

  if (!senal && !borrador && !intento) return resultado('LIBRE', null, { requestId: null });
  if (senal && (typeof senal.requestId !== 'string' || !senal.requestId ||
                senal.maquina !== maquinaId)) {
    return resultado('INTERVENCION', 'La señal local carece de una identidad válida; conservá los datos.');
  }
  if (intento && (intento.version !== 1 || intento.maquina !== maquinaId ||
      !intento.requestId || intento.payload?.request_id !== intento.requestId ||
      intento.payload?.id_maquina !== maquinaId)) {
    return resultado('INTERVENCION', 'El intento de envío local es inválido; no se modificó.');
  }
  if (new Set(ids).size !== 1) {
    return resultado('INTERVENCION', 'Hay identificadores distintos entre señal, borrador e intento. Requiere revisión.');
  }
  const requestId = ids[0] || null;
  if (!requestId) return resultado('INTERVENCION', 'Registro local sin identificador recuperable.');
  if (senal && !intento) {
    return resultado('ABIERTA', null, { requestId, senal, borrador });
  }
  if (senal && intento) {
    return resultado('ENVIO_PREVIO', 'Existe un envío previo: primero se debe comprobar su resultado.',
      { requestId, senal, borrador });
  }
  if (intento) {
    return resultado('HUERFANO', 'Existe un envío sin señal local: se debe consultar el servidor.',
      { requestId, senal: null, borrador });
  }
  return resultado('INTERVENCION', 'Existe un borrador sin señal ni envío. No se borró.', { requestId });
}

// Sólo invocar después de que la RPC o consulta autenticada confirmó una prueba.
// El orden conserva el intento de envío hasta el último paso para recuperar un ACK perdido.
export function limpiarTrasConfirmacion({ maquinaId, requestId, senales, borradores, intentos, pruebaId }) {
  if (!pruebaId || !requestId) {
    return resultado('INTERVENCION', 'No existe confirmación verificable de la prueba.');
  }
  const previo = inspeccionarRegistrosLocales({ maquinaId, senales, borradores, intentos });
  if (previo.estado === 'INTERVENCION' || previo.requestId && previo.requestId !== requestId) {
    return resultado('INTERVENCION', 'El almacenamiento cambió o no es consistente; no se eliminó.');
  }
  if (previo.estado === 'LIBRE') {
    return resultado('CONFIRMADA_LIMPIA', null, { pruebaId });
  }
  if (previo.senal && !senales.eliminarSiCoincide(maquinaId, requestId)) {
    return resultado('CONFIRMADA_CON_RESIDUOS', 'La prueba se guardó, pero no pudo limpiarse la señal local.', { pruebaId });
  }
  if (!borradores.borrarConfirmado(maquinaId, requestId)) {
    return resultado('CONFIRMADA_CON_RESIDUOS', 'La prueba se guardó, pero el borrador permanece en el navegador.', { pruebaId });
  }
  if (!intentos.borrarConfirmado(maquinaId, requestId)) {
    return resultado('CONFIRMADA_CON_RESIDUOS', 'La prueba se guardó, pero permanece la evidencia del intento anterior.', { pruebaId });
  }
  return resultado('CONFIRMADA_LIMPIA', null, { pruebaId });
}

export async function recuperarEstadoLocal({ maquinaId, senales, borradores, intentos, consultar }) {
  const actual = inspeccionarRegistrosLocales({ maquinaId, senales, borradores, intentos });
  if (actual.estado !== 'ENVIO_PREVIO' && actual.estado !== 'HUERFANO') return actual;
  let remoto;
  try {
    remoto = await consultar(actual.requestId);
  } catch {
    return resultado('INCIERTO', 'No se pudo comprobar la prueba en el servidor; conservá los datos.',
      { requestId: actual.requestId });
  }
  if (remoto?.estado === 'CONFIRMADA' && remoto.pruebaId) {
    return limpiarTrasConfirmacion({ maquinaId, requestId: actual.requestId, senales,
      borradores, intentos, pruebaId: remoto.pruebaId });
  }
  if (remoto?.estado === 'NO_ENCONTRADA' && actual.estado === 'ENVIO_PREVIO') {
    return resultado('ENVIO_PREVIO', 'No se encontró la prueba. Reintentá con el mismo UUID y contenido original.',
      { requestId: actual.requestId, senal: actual.senal, borrador: actual.borrador });
  }
  if (remoto?.estado === 'NO_ENCONTRADA') {
    return resultado('INTERVENCION', 'No se encontró el envío huérfano y no existe señal para retomarlo.',
      { requestId: actual.requestId });
  }
  return resultado('INCIERTO', 'La confirmación no está disponible. Se conservaron los datos.',
    { requestId: actual.requestId });
}
