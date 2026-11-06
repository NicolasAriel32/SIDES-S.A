// SPC-003: contratos con RPCs de validación de muestras.
// NO se invocan desde la UI hasta aprobar despliegue y pruebas Auth en staging.
import { construirSolicitudRevisionMuestra } from '../domain/validacionMuestras.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const zona = s => typeof s === 'string' &&
  /(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(s) &&
  Number.isFinite(Date.parse(s));

export async function solicitarRevisionMuestra(supabase, datos) {
  const payload = construirSolicitudRevisionMuestra(datos);
  if (!supabase || typeof supabase.rpc !== 'function') {
    throw new Error('Servicio de validación no disponible.');
  }
  const { data, error } = await supabase.rpc('spc_resolver_validacion_muestra', payload);
  if (error || !data || typeof data !== 'object' ||
      !['VALIDAR_DESCRIPTIVA', 'RECHAZAR', 'REVOCAR'].includes(data.decision)) {
    throw new Error('No se pudo confirmar la decisión de Calidad.');
  }
  // El RPC decide la identidad, permisos, protocolo, snapshot y auditoría.
  // No se envía actor, rol ni una marca de aptitud desde el navegador.
  return {
    decision: data.decision,
    eventoId: data.evento_id,
    estadoEstadistico: 'SOLO_OBSERVACION',
  };
}

export async function consultarValidacionesMuestra(supabase, pruebaIds) {
  if (!supabase || typeof supabase.rpc !== 'function' ||
      !Array.isArray(pruebaIds) || pruebaIds.length > 100 ||
      !pruebaIds.every(id => UUID.test(id))) {
    throw new Error('Consulta de validaciones inválida.');
  }
  if (!pruebaIds.length) return new Map();
  const { data, error } = await supabase.rpc('spc_estados_validacion_muestra', {
    p_prueba_ids: pruebaIds,
  });
  if (error || !Array.isArray(data)) {
    throw new Error('No se pudieron consultar las validaciones.');
  }

  const permitidos = new Set(pruebaIds);
  const salida = new Map();
  for (const row of data) {
    if (!row || !permitidos.has(row.prueba_id) || salida.has(row.prueba_id) ||
        !['VALIDADA_DESCRIPTIVA', 'NO_VALIDADA'].includes(row.estado)) {
      throw new Error('Respuesta de validaciones inconsistente.');
    }
    if (row.estado === 'VALIDADA_DESCRIPTIVA') {
      if (!zona(row.ensayo_utc) || !zona(row.validado_en) ||
          typeof row.protocolo_codigo !== 'string' ||
          !Number.isInteger(row.protocolo_version) || row.protocolo_version < 1) {
        throw new Error('Validación incompleta.');
      }
      salida.set(row.prueba_id, {
        pruebaId: row.prueba_id,
        estado: row.estado,
        ensayoUtc: row.ensayo_utc,
        validadoEn: row.validado_en,
        protocoloCodigo: row.protocolo_codigo,
        protocoloVersion: row.protocolo_version,
      });
    } else {
      salida.set(row.prueba_id, {
        pruebaId: row.prueba_id, estado: row.estado,
      });
    }
  }
  return salida;
}
