// SPC-002 - lectura paginada y acotada; NO escribe ni habilita controles de planta.
// La cuenta exacta es sobre las filas visibles según RLS: NO es cobertura OT.
import { MAQUINA_PILOTO_SPC } from '../domain/spcDescriptivo.js';

export const ESTADOS_CONSULTA_SPC = Object.freeze({
  COMPLETO: 'COMPLETO',
  PARCIAL: 'PARCIAL',
  ERROR: 'ERROR',
});
export const TAMANO_PAGINA_SPC = 100;
export const MAX_FILAS_SPC = 2000;

const COLUMNAS = [
  'id', 'id_maquina', 'created_at', 'codigo_producto',
  'resultado', 'estado_final', 'cantidad_cabezales_afectados',
  'spc_cabezales_inspeccionados', 'spc_uso_estadistico',
  'spc_origen_evento', 'fallas:pruebas_fallas(tipo_falla_id,cantidad_items_afectados)',
].join(',');

const fechaConZona = valor => (
  typeof valor === 'string' &&
  /(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(valor) &&
  Number.isFinite(Date.parse(valor))
) ? valor : null;

export function normalizarPruebaSpc(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.fallas !== null && row.fallas !== undefined && !Array.isArray(row.fallas)) return null;
  const fallas = row.fallas;
  const detalle = Array.isArray(fallas) ? fallas : null;

  return {
    supabase_id: row.id,
    maquina: row.id_maquina,
    codigoProducto: row.codigo_producto,
    estado: row.resultado,
    estadoFinal: row.estado_final,
    cabezalesInspeccionados: row.spc_cabezales_inspeccionados,
    cabezalesFalla: row.cantidad_cabezales_afectados,
    aptitudSpc: row.spc_uso_estadistico,
    origenEvento: row.spc_origen_evento,
    // created_at en esquema actual es timestamp WITHOUT time zone;
    // NO asumir UTC desde el navegador.
    timestamp: fechaConZona(row.created_at),
    tipos: detalle ? detalle.map(f => f.tipo_falla_id) : null,
    cantidadesTipos: detalle
      ? Object.fromEntries(detalle.map(f => [f.tipo_falla_id, f.cantidad_items_afectados]))
      : null,
  };
}

const respuesta = (estado, rows, codigo, totalEsperado = null) => ({
  estado, rows, codigo, totalEsperado, recuperados: rows.length,
});

export async function consultarSpcPiloto(
  supabase,
  {
    maquina = MAQUINA_PILOTO_SPC,
    desde,
    hasta,
    tamanoPagina = TAMANO_PAGINA_SPC,
    maxFilas = MAX_FILAS_SPC,
  } = {},
) {
  if (!supabase || typeof supabase.from !== 'function' ||
      maquina !== MAQUINA_PILOTO_SPC ||
      !Number.isInteger(tamanoPagina) || tamanoPagina < 1 || tamanoPagina > 1000 ||
      !Number.isInteger(maxFilas) || maxFilas < 1 ||
      !fechaConZona(desde) || !fechaConZona(hasta) ||
      Date.parse(desde) >= Date.parse(hasta)) {
    return respuesta(ESTADOS_CONSULTA_SPC.ERROR, [], 'PARAMETROS_INVALIDOS');
  }

  const filas = [];
  const idsVistos = new Set();
  let totalEsperado = null;
  try {
    while (filas.length < maxFilas) {
      const desdeIndice = filas.length;
      const pedido = Math.min(tamanoPagina, maxFilas - desdeIndice);
      const { data, error, count } = await supabase.from('pruebas')
        .select(COLUMNAS, { count: 'exact' })
        .eq('id_maquina', maquina)
        .gte('created_at', desde)
        .lte('created_at', hasta)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(desdeIndice, desdeIndice + pedido - 1);

      if (error) return respuesta(ESTADOS_CONSULTA_SPC.ERROR, [], 'CONSULTA_FALLIDA');
      if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) {
        return respuesta(ESTADOS_CONSULTA_SPC.ERROR, [], 'RESPUESTA_INVALIDA');
      }
      if (totalEsperado === null) totalEsperado = count;
      // Si hubo cambios concurrentes, no afirmar paginación completa.
      if (count !== totalEsperado || data.length > pedido || (data.length === 0 && filas.length < count)) {
        return respuesta(ESTADOS_CONSULTA_SPC.PARCIAL, filas, 'COBERTURA_INCIERTA', totalEsperado);
      }
      if (data.some(row => !row || !row.id || !row.id_maquina || row.id_maquina !== maquina)) {
        return respuesta(ESTADOS_CONSULTA_SPC.ERROR, [], 'RESPUESTA_INVALIDA');
      }

      const normalizadas = data.map(normalizarPruebaSpc);
      if (normalizadas.some(x => x === null)) {
        return respuesta(ESTADOS_CONSULTA_SPC.ERROR, [], 'DETALLE_INVALIDO');
      }
      // Un cambio concurrente puede desplazar páginas y repetir un ID;
      // aunque la cantidad final coincida, NO se considera cobertura completa.
      if (normalizadas.some(x => idsVistos.has(x.supabase_id)) ||
          new Set(normalizadas.map(x => x.supabase_id)).size !== normalizadas.length) {
        return respuesta(ESTADOS_CONSULTA_SPC.PARCIAL, filas, 'COBERTURA_INCIERTA', totalEsperado);
      }
      for (const x of normalizadas) idsVistos.add(x.supabase_id);
      filas.push(...normalizadas);
      if (filas.length === totalEsperado) {
        return respuesta(ESTADOS_CONSULTA_SPC.COMPLETO, filas, null, totalEsperado);
      }
      if (filas.length > totalEsperado || data.length < pedido) {
        return respuesta(ESTADOS_CONSULTA_SPC.PARCIAL, filas, 'COBERTURA_INCIERTA', totalEsperado);
      }
    }
    return respuesta(ESTADOS_CONSULTA_SPC.PARCIAL, filas, 'LIMITE_DE_REGISTROS', totalEsperado);
  } catch {
    return respuesta(ESTADOS_CONSULTA_SPC.ERROR, [], 'EXCEPCION_DE_LECTURA');
  }
}
