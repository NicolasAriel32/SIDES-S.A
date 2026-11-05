// SPC-001: contrato ejecutable entre el formulario existente y la RPC en PostgreSQL.
// No se generan identificadores aquí: un reintento debe reutilizar el UUID original.
import { validarResultadoEstanqueidad } from '../domain/estanqueidad.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function construirPayloadPruebaEstanqueidad(test) {
  const validez = validarResultadoEstanqueidad({
    estado: test.estado, tipos: test.tipos, cabezalesFalla: test.cabezalesFalla,
    cantidadesTipos: test.cantidadesTipos || {}, autoPendiente: test.autoPendiente === true,
  });
  if (!validez.ok) throw new Error(validez.mensaje);
  if (!UUID.test(test.requestId || '')) {
    throw new Error('Solicitud sin UUID válido y estable. Reabrí el registro manual.');
  }
  if (!test.maquina || typeof test.maquina !== 'string') {
    throw new Error('Debe seleccionarse una máquina.');
  }
  return {
    request_id: test.requestId,
    id_maquina: test.maquina,
    fecha_inicio_manual: test.fechaSenal || null,
    codigo_producto: test.codigoProducto || null,
    numero_caja: test.caja || null,
    numero_lote: test.lote || null,
    resultado: test.autoPendiente ? 'PENDIENTE' : test.estado,
    auto_pendiente: test.autoPendiente === true,
    cabezales_afectados: test.cabezalesFalla || 0,
    tipos: test.tipos || [],
    cantidades_por_tipo: test.cantidadesTipos || {},
    observaciones: test.observaciones || null,
  };
}

export async function registrarPruebaEstanqueidad(supabase, test) {
  const payload = construirPayloadPruebaEstanqueidad(test);
  // Una sola llamada RPC transaccional, sin fallback a INSERTs directos.
  const respuesta = await supabase.rpc('registrar_prueba_estanqueidad_spc', { p: payload });
  return { ...respuesta, payload };
}
