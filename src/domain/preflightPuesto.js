// SPC-001 Fase 5 — diagnóstico INDICATIVO, nunca un control de autorización.
// El backend/RLS y los locks reales determinan permisos. No usar aquí payloads,
// UUID, nombres, legajos ni credenciales.
const CODIGOS = Object.freeze({
  SIN_VERIFICAR: 'NO_VERIFICADO',
  LIBRE: 'SIN_EVIDENCIA',
  ABIERTA: 'PRUEBA_ABIERTA',
  ENVIO_PREVIO: 'ENVIO_PENDIENTE',
  HUERFANO: 'EVIDENCIA_HUERFANA',
  INTERVENCION: 'REVISION_MANUAL',
  INCIERTO: 'CONFIRMACION_INCIERTA',
  CONFIRMADA_LIMPIA: 'CONFIRMADA',
  CONFIRMADA_CON_RESIDUOS: 'RESIDUOS_LOCALES',
});
const CODIGOS_CHECK = Object.freeze(['AUTH', 'STORAGE', 'WEB_LOCKS', 'CONTEXTO_SEGURO', 'RED']);
const CODIGOS_BLOQUEO = Object.freeze([...CODIGOS_CHECK, 'EVIDENCIA_LOCAL', 'EVIDENCIA_NO_VERIFICADA']);
const ESTADOS_INTERVENCION = new Set(['HUERFANO', 'INTERVENCION', 'INCIERTO', 'CONFIRMADA_CON_RESIDUOS']);

/**
 * Prueba NO destructiva de lectura/escritura: usa clave aleatoria y la borra
 * sólo si coincide con su marcador. Nunca toca claves industriales existentes.
 * No demuestra espacio libre suficiente para un ensayo completo.
 */
export function verificarEscrituraStorage(storage, crearId) {
  if (!storage || typeof crearId !== 'function') return false;
  let key = null;
  const marcador = 'spc-preflight-v1';
  let escrito = false;
  try {
    const id = crearId();
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(id)) return false;
    key = '__spc_preflight_write_' + id;
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, marcador);
    escrito = true;
    if (storage.getItem(key) !== marcador) return false;
    storage.removeItem(key);
    escrito = false;
    return storage.getItem(key) === null;
  } catch {
    return false;
  } finally {
    if (escrito && key) {
      try {
        if (storage.getItem(key) === marcador) storage.removeItem(key);
      } catch { /* No borrar otra evidencia ante un fallo de Storage. */ }
    }
  }
}

export function evaluarPreflight({
  estadoLocal = 'SIN_VERIFICAR', tieneLock, authVerificada,
  storageDisponible, navegadorSeguro, online,
} = {}) {
  const checks = [
    // AUTH significa: perfil de UI obtenido tras validar Auth; no una
    // consulta de sesión a Supabase en tiempo real durante este diagnóstico.
    { codigo: 'AUTH', ok: authVerificada === true, bloqueante: true },
    { codigo: 'STORAGE', ok: storageDisponible === true, bloqueante: true },
    { codigo: 'WEB_LOCKS', ok: tieneLock === true, bloqueante: true },
    { codigo: 'CONTEXTO_SEGURO', ok: navegadorSeguro === true, bloqueante: true },
    // navigator.onLine es sólo una señal local, nunca un ping a Supabase.
    { codigo: 'RED', ok: online === true, bloqueante: false },
  ];
  const estado = Object.hasOwn(CODIGOS, estadoLocal) ? estadoLocal : 'SIN_VERIFICAR';
  const bloqueantes = checks.filter(c => c.bloqueante && !c.ok).map(c => c.codigo);
  if (ESTADOS_INTERVENCION.has(estado)) bloqueantes.push('EVIDENCIA_LOCAL');
  if (estado === 'SIN_VERIFICAR') bloqueantes.push('EVIDENCIA_NO_VERIFICADA');
  const habilitado = bloqueantes.length === 0;
  const puedeCrearNueva = habilitado && ['LIBRE', 'CONFIRMADA_LIMPIA'].includes(estado);
  const puedeRecuperar = habilitado && ['ABIERTA', 'ENVIO_PREVIO'].includes(estado);
  return {
    version: 1,
    estado: CODIGOS[estado],
    habilitado,
    puedeCrearNueva,
    puedeRecuperar, // Operación local; NO supone RPC exitosa.
    puedeConsultarRemoto: puedeRecuperar && online === true,
    checks,
    bloqueantes,
    modo: !habilitado ? 'BLOQUEADO' : online === true ? 'NORMAL' : 'SIN_RED',
  };
}

/**
 * Lista blanca cerrada: el soporte puede compartir estos códigos genéricos,
 * jamás se copia el objeto de origen ni excepciones del navegador.
 */
export function reportePreflightSeguro(evaluacion) {
  if (!evaluacion || evaluacion.version !== 1) throw new Error('Preflight inválido');
  return {
    version: 1,
    estado: Object.values(CODIGOS).includes(evaluacion.estado)
      ? evaluacion.estado : 'NO_VERIFICADO',
    modo: ['BLOQUEADO', 'NORMAL', 'SIN_RED'].includes(evaluacion.modo)
      ? evaluacion.modo : 'BLOQUEADO',
    checks: (Array.isArray(evaluacion.checks) ? evaluacion.checks : [])
      .filter(c => c && typeof c === 'object' && CODIGOS_CHECK.includes(c.codigo))
      .map(c => ({ codigo: c.codigo, ok: c.ok === true })),
    bloqueantes: (Array.isArray(evaluacion.bloqueantes) ? evaluacion.bloqueantes : [])
      .filter(c => CODIGOS_BLOQUEO.includes(c)),
  };
}
