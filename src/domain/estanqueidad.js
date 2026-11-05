// Reglas puras de estanqueidad reutilizadas por la UI y la capa de datos.
// No reemplazan constraints, autorizacion ni guardado transaccional en PostgreSQL.
export const CABEZALES_POR_MUESTRA = 20;

const fallo = (mensaje) => ({ ok: false, mensaje });
const correcto = () => ({ ok: true, mensaje: null });

export function validarResultadoEstanqueidad({ estado, tipos = [], cabezalesFalla = 0, autoPendiente = false }) {
  // El estado PENDIENTE automatico no representa una muestra ensayada.
  if (autoPendiente === true && estado === 'PENDIENTE') return correcto();

  const n = Number(cabezalesFalla);
  if (!Number.isInteger(n) || n < 0 || n > CABEZALES_POR_MUESTRA) {
    return fallo(`La cantidad de cabezales con falla debe ser un entero entre 0 y ${CABEZALES_POR_MUESTRA}.`);
  }
  if (!Array.isArray(tipos) || !tipos.every(tipo => typeof tipo === 'string' && tipo.trim().length > 0)) {
    return fallo('La lista de tipos de falla no es válida.');
  }
  if (new Set(tipos).size !== tipos.length) {
    return fallo('No se puede registrar dos veces el mismo tipo de falla.');
  }

  if (estado === 'OK') {
    return n === 0 && tipos.length === 0
      ? correcto()
      : fallo('Una prueba OK no puede contener cabezales afectados ni tipos de falla.');
  }
  if (estado === 'RECHAZADO') {
    if (n === 0) return fallo('Indicá al menos un cabezal con falla (de los 20 inspeccionados).');
    if (tipos.length === 0) return fallo('Seleccioná al menos un tipo de falla.');
    return correcto();
  }
  return fallo('El resultado de la prueba no es válido.');
}

// Este KPI es por PRUEBA, no por cabezal: no equivale a p, DPU ni NC oficiales.
export function resumirPruebasConFalla(pruebas = []) {
  const evaluables = pruebas.filter(p =>
    p.estadoFinal !== 'PENDIENTE' &&
    (p.estado === 'OK' || p.estado === 'RECHAZADO')
  );
  const conFalla = evaluables.filter(p => p.estado === 'RECHAZADO').length;
  const ok = evaluables.length - conFalla;
  return {
    evaluables: evaluables.length,
    conFalla,
    ok,
    porcentajeConFalla: evaluables.length > 0
      ? Math.round(100 * conFalla / evaluables.length)
      : null,
  };
}
