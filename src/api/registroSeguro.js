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
      const anterior = await consultarConfirmacionPrueba(supabase, test.requestId);
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

    const consulta = await consultarConfirmacionPrueba(supabase, test.requestId);
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
