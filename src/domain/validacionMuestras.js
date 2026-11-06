// SIDES 2.0 SPC-003 — verificación PREVIA a la aprobación de Calidad.
// Nunca autoriza una muestra ni interpreta un aviso manual como OT verificado.
import { CABEZALES_POR_MUESTRA, validarResultadoEstanqueidad } from './estanqueidad.js';

export const RESULTADO_PREVALIDACION = Object.freeze({
  CANDIDATA: 'CANDIDATA_PARA_REVISION',
  BLOQUEADA: 'BLOQUEADA',
});

const texto = v => typeof v === 'string' && v.trim().length > 0;
const estadosNoValidos = new Set(['PENDIENTE', 'ANULADA', 'ANULADO', 'CANCELADA']);

export function evaluarPrevalidacionMuestra(p) {
  const motivos = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return { estado: RESULTADO_PREVALIDACION.BLOQUEADA, motivos: ['REGISTRO_INVALIDO'], aptaEstadistica: false };
  }

  if (!texto(p.requestId)) motivos.push('SIN_SOLICITUD_VERIFICABLE');
  if (p.maquina !== 'MAQ-010') motivos.push('FUERA_DEL_PILOTO');
  if (p.origenEvento !== 'MANUAL_NO_OT') motivos.push('ORIGEN_NO_DOCUMENTADO');
  if (!texto(p.codigoProducto) || !texto(p.caja) || !texto(p.lote)) {
    motivos.push('REFERENCIAS_INCOMPLETAS');
  }
  if (p.cabezalesInspeccionados !== CABEZALES_POR_MUESTRA) motivos.push('MUESTRA_NO_20');
  if (estadosNoValidos.has(p.estadoFinal) || !['OK', 'RECHAZADO'].includes(p.estado)) {
    motivos.push('NO_ES_ENSAYO');
  } else {
    const valor = validarResultadoEstanqueidad({
      estado: p.estado, tipos: p.tipos, cantidadesTipos: p.cantidadesTipos,
      cabezalesFalla: p.cabezalesFalla,
    });
    // Evitar conversiones silenciosas Number(null) y Number('') => 0.
    if (!Number.isInteger(p.cabezalesFalla) || !valor.ok ||
        !Array.isArray(p.tipos) || !p.cantidadesTipos ||
        typeof p.cantidadesTipos !== 'object') {
      motivos.push('CANTIDADES_INCONSISTENTES');
    }
  }

  return {
    estado: motivos.length === 0 ? RESULTADO_PREVALIDACION.CANDIDATA : RESULTADO_PREVALIDACION.BLOQUEADA,
    motivos,
    aptaEstadistica: false,
    requiereDecisionCalidad: motivos.length === 0,
  };
}

/**
 * El cliente NO emite aprobación. Solo valida formato y prepara un pedido.
 * El servidor comprobará rol, protocolo vigente, origen, prueba, evidencia,
 * estado y bitácora, ignorando cualquier marca de aprobación del navegador.
 */
export function construirSolicitudRevisionMuestra({
  pruebaId, protocoloId, evidenciaReferencia, decision, motivo,
} = {}) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID.test(pruebaId || '') || !UUID.test(protocoloId || '')) {
    throw new Error('Referencia de prueba o protocolo inválida.');
  }
  if (!['VALIDAR_DESCRIPTIVA', 'RECHAZAR', 'REVOCAR'].includes(decision)) {
    throw new Error('La decisión de Calidad no es válida.');
  }
  if (!texto(evidenciaReferencia) || !/^[A-Za-z0-9_./:-]{6,160}$/.test(evidenciaReferencia)) {
    throw new Error('Se necesita una referencia verificable de evidencia.');
  }
  if (decision !== 'VALIDAR_DESCRIPTIVA' &&
      (!texto(motivo) || motivo.trim().length > 300)) {
    throw new Error('La decisión requiere un motivo documentado.');
  }
  return {
    p_prueba_id: pruebaId,
    p_protocolo_id: protocoloId,
    p_evidencia_ref: evidenciaReferencia,
    p_decision: decision,
    p_motivo: texto(motivo) ? motivo.trim() : null,
  };
}
