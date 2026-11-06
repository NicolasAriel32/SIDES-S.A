// VF-002: asignacion transaccional. Ningun dato del turno, cantidad,
// operador, ni ID de prueba proviene del navegador. Unico contrato: RPC.
const ESTADOS = new Set([
  'CREADA', 'YA_ASIGNADA', 'ASIGNADA_A_OTRO',
  'SIN_PRUEBAS', 'LEGADO_EXISTENTE',
]);

export async function asegurarAsignacionTurnoEnServidor(supabase) {
  if (!supabase || typeof supabase.rpc !== 'function') {
    throw new Error('VF_ASIGNACION_SERVICIO_NO_DISPONIBLE');
  }
  let respuesta;
  try {
    // No se permite pasar IDs, cantidad, limites horarios ni usuario.
    respuesta = await supabase.rpc('vf_asegurar_verificaciones_turno_anterior');
  } catch {
    throw new Error('VF_ASIGNACION_ERROR');
  }
  const { data, error } = respuesta || {};
  if (error || !data || Array.isArray(data) || typeof data !== 'object' ||
      !ESTADOS.has(data.estado) ||
      !Number.isSafeInteger(data.cantidad) || data.cantidad < 0 ||
      typeof data.asignada_a_mi !== 'boolean' ||
      typeof data.turno_inicio_utc !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(data.turno_inicio_utc) ||
      !Number.isFinite(Date.parse(data.turno_inicio_utc))) {
    throw new Error('VF_ASIGNACION_RESPUESTA_INVALIDA');
  }
  if ((data.estado === 'SIN_PRUEBAS' && (data.cantidad !== 0 || data.asignada_a_mi)) ||
      (data.estado === 'CREADA' && (data.cantidad < 1 || data.cantidad > 2 || !data.asignada_a_mi)) ||
      (data.estado === 'YA_ASIGNADA' && (data.cantidad < 1 || data.cantidad > 2 || !data.asignada_a_mi)) ||
      (data.estado === 'ASIGNADA_A_OTRO' && data.asignada_a_mi) ||
      (data.estado === 'LEGADO_EXISTENTE' && (data.cantidad < 1 || data.asignada_a_mi))) {
    throw new Error('VF_ASIGNACION_RESPUESTA_INVALIDA');
  }
  return {
    estado: data.estado, cantidad: data.cantidad,
    asignadaAMi: data.asignada_a_mi,
    turnoInicioUtc: data.turno_inicio_utc,
  };
}
