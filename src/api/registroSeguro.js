import { construirPayloadPruebaEstanqueidad, registrarPruebaEstanqueidad } from './estanqueidad.js';
import { crearAlmacenIntentos } from '../domain/intentosRegistro.js';
import { conBloqueoDePrueba, consultarConfirmacionPrueba } from '../domain/reconciliacionPruebas.js';

// Aislamiento de operaciones: snapshot -> comprobar resultado anterior ->
// RPC idempotente -> reconciliar ACK perdido. Sin reintento automático.
export async function guardarPruebaSegura({ supabase, test, storage, lockManager }) {
  return conBloqueoDePrueba(lockManager, test.legajoOperario, test.maquina, test.requestId, async () => {
    const intentos = crearAlmacenIntentos(storage, test.legajoOperario);
    const payload = construirPayloadPruebaEstanqueidad(test);
    const intento = intentos.preparar(test.maquina, test.requestId, payload);

    const confirmada = consulta => ({
      data: {
        prueba_id: consulta.pruebaId,
        numero_secuencial: consulta.numeroSecuencial,
        duplicado: true,
      },
      error: null,
      payload: intento.payload,
    });

    if (intento.yaExistia) {
      const anterior = await consultarConfirmacionPrueba(supabase, test.requestId, { legajo: test.legajoOperario, maquina: test.maquina });
      if (anterior.estado === 'CONFIRMADA') return confirmada(anterior);
    }

    let envio;
    try {
      envio = await registrarPruebaEstanqueidad(supabase, test);
    } catch (e) {
      envio = {
        data: null,
        error: { message: e?.message || 'Se perdió la respuesta de red.' },
        payload: intento.payload,
      };
    }

    if (!envio.error && envio.data?.prueba_id) return envio;

    const consulta = await consultarConfirmacionPrueba(supabase, test.requestId, { legajo: test.legajoOperario, maquina: test.maquina });
    if (consulta.estado === 'CONFIRMADA') return confirmada(consulta);

    return {
      ...envio,
      payload: intento.payload,
      error: envio.error || { message: consulta.estado === 'INCIERTO'
        ? 'Resultado incierto: conservá el formulario y verificá antes de reenviar.'
        : 'No se confirmó el registro de la prueba.' },
    };
  });
}


// Reintento explícito, nunca en segundo plano. Es especialmente necesario
// para un PENDIENTE automático: su formulario no contiene un ensayo físico,
// pero el payload exacto quedó persistido antes del primer envío.
export async function reintentarIntentoGuardado({ supabase, storage, lockManager, legajo, maquina, requestId }) {
  return conBloqueoDePrueba(lockManager, legajo, maquina, requestId, async () => {
    const intento = crearAlmacenIntentos(storage, legajo).leer(maquina);
    if (!intento || intento.error || intento.requestId !== requestId ||
        intento.payload?.request_id !== requestId || intento.payload?.id_maquina !== maquina) {
      throw new Error('No existe un intento íntegro para este operario, máquina y UUID.');
    }
    const identidad = { legajo, maquina };
    const confirmado = consulta => ({
      data: { prueba_id: consulta.pruebaId, numero_secuencial: consulta.numeroSecuencial, duplicado: true },
      error: null, payload: intento.payload,
    });
    const anterior = await consultarConfirmacionPrueba(supabase, requestId, identidad);
    if (anterior.estado === 'CONFIRMADA') return confirmado(anterior);

    // El operador eligió manualmente reintentar. La RPC valida servidor/actor
    // y deduplica por UUID y contenido; NUNCA reconstruir el payload desde UI.
    let envio;
    try {
      envio = await supabase.rpc('registrar_prueba_estanqueidad_spc', { p: intento.payload });
    } catch (e) {
      envio = { data: null, error: { message: e?.message || 'No hubo respuesta del servidor.' } };
    }
    if (!envio.error && envio.data?.prueba_id) return { ...envio, payload: intento.payload };

    const posterior = await consultarConfirmacionPrueba(supabase, requestId, identidad);
    if (posterior.estado === 'CONFIRMADA') return confirmado(posterior);
    return { data: null, payload: intento.payload, error: envio.error ||
      { message: 'No se confirmó el envío. Los datos continúan guardados localmente.' } };
  });
}
