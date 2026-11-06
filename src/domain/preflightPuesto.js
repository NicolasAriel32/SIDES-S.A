// SPC-001 Fase 5: preflight seguro para soporte y puesta en marcha.
// Nunca serializar payloads, legajos, tokens, contraseñas, UUID ni datos de pruebas.
const ESTADOS = new Set(['LIBRE','ABIERTA','ENVIO_PREVIO','HUERFANO','INTERVENCION','INCIERTO','CONFIRMADA_LIMPIA','CONFIRMADA_CON_RESIDUOS']);
const CODIGOS = Object.freeze({
  LIBRE:'SIN_EVIDENCIA', ABIERTA:'PRUEBA_ABIERTA',
  ENVIO_PREVIO:'ENVIO_PENDIENTE', HUERFANO:'EVIDENCIA_HUERFANA',
  INTERVENCION:'REVISION_MANUAL', INCIERTO:'CONFIRMACION_INCIERTA',
  CONFIRMADA_LIMPIA:'CONFIRMADA', CONFIRMADA_CON_RESIDUOS:'RESIDUOS_LOCALES',
});
export function evaluarPreflight({ estadoLocal, tieneLock, authVerificada, storageDisponible, navegadorSeguro, online }) {
  const checks = [
    { codigo:'AUTH', ok:authVerificada === true, bloqueante:true },
    { codigo:'STORAGE', ok:storageDisponible === true, bloqueante:true },
    { codigo:'WEB_LOCKS', ok:tieneLock === true, bloqueante:true },
    { codigo:'CONTEXTO_SEGURO', ok:navegadorSeguro === true, bloqueante:true },
    { codigo:'RED', ok:online === true, bloqueante:false },
  ];
  const estado = ESTADOS.has(estadoLocal) ? estadoLocal : 'INTERVENCION';
  const requiereIntervencion = ['HUERFANO','INTERVENCION','INCIERTO','CONFIRMADA_CON_RESIDUOS'].includes(estado);
  const bloqueantes = checks.filter(c=>c.bloqueante && !c.ok).map(c=>c.codigo);
  if(requiereIntervencion) bloqueantes.push('EVIDENCIA_LOCAL');
  // Si hay envío previo, sólo se permite reconciliar/reintentar el UUID congelado.
  const puedeCrearNueva = bloqueantes.length===0 && estado==='LIBRE';
  const puedeRecuperar = bloqueantes.length===0 && estado!=='LIBRE';
  return Object.freeze({
    version:1, estado:CODIGOS[estado], habilitado:bloqueantes.length===0,
    puedeCrearNueva, puedeRecuperar,
    checks, bloqueantes,
    modo:bloqueantes.length ? 'BLOQUEADO' : online === true ? 'NORMAL' : 'SIN_RED',
  });
}
export function reportePreflightSeguro(evaluacion) {
  // Lista blanca explícita: jamás copiar el objeto de entrada ni errores crudos.
  if (!evaluacion || evaluacion.version !== 1) throw new Error('Preflight inválido');
  return {
    version:1,
    estado:ESTADOS.has(evaluacion.estado) ? CODIGOS[evaluacion.estado] :
      Object.values(CODIGOS).includes(evaluacion.estado) ? evaluacion.estado : 'REVISION_MANUAL',
    modo:['BLOQUEADO','NORMAL','SIN_RED'].includes(evaluacion.modo) ? evaluacion.modo : 'BLOQUEADO',
    checks:(Array.isArray(evaluacion.checks)?evaluacion.checks:[])
      .filter(c=>['AUTH','STORAGE','WEB_LOCKS','CONTEXTO_SEGURO','RED'].includes(c.codigo))
      .map(c=>({codigo:c.codigo,ok:c.ok===true})),
    bloqueantes:(Array.isArray(evaluacion.bloqueantes)?evaluacion.bloqueantes:[])
      .filter(c=>['AUTH','STORAGE','WEB_LOCKS','CONTEXTO_SEGURO','EVIDENCIA_LOCAL'].includes(c)),
  };
}
