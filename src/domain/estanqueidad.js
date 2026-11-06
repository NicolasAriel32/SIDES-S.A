// SPC-001: validaciones de interfaz y datos, replicadas autoritativamente en la RPC.
// Cada tipo registra la cantidad de CABEZALES afectados por ese tipo; no se asume
// que un cabezal sólo pueda presentar una clase de defecto.
export const CABEZALES_POR_MUESTRA = 20;

const fallo = (mensaje) => ({ ok: false, mensaje });
const correcto = () => ({ ok: true, mensaje: null });

export function validarResultadoEstanqueidad({
  estado, tipos = [], cabezalesFalla = 0, cantidadesTipos = {}, autoPendiente = false,
}) {
  if (autoPendiente === true && estado === 'PENDIENTE') {
    return Number(cabezalesFalla) === 0 &&
      Array.isArray(tipos) && tipos.length === 0 &&
      cantidadesTipos && Object.keys(cantidadesTipos).length === 0
      ? correcto() : fallo('Un pendiente automático no representa una prueba realizada.');
  }

  const n = Number(cabezalesFalla);
  if (!Number.isInteger(n) || n < 0 || n > CABEZALES_POR_MUESTRA) {
    return fallo(`Los cabezales únicos afectados deben estar entre 0 y ${CABEZALES_POR_MUESTRA}.`);
  }
  if (!Array.isArray(tipos) || !tipos.every(x => typeof x === 'string' && x.trim())) {
    return fallo('La lista de tipos de falla no es válida.');
  }
  if (new Set(tipos).size !== tipos.length) {
    return fallo('Un tipo de falla no puede seleccionarse dos veces.');
  }
  if (!cantidadesTipos || typeof cantidadesTipos !== 'object' || Array.isArray(cantidadesTipos)) {
    return fallo('Las cantidades por tipo de falla no son válidas.');
  }

  if (estado === 'OK') {
    return n === 0 && tipos.length === 0 && Object.keys(cantidadesTipos).length === 0
      ? correcto() : fallo('Una prueba OK requiere cero cabezales afectados y ningún defecto.');
  }

  if (estado === 'RECHAZADO') {
    if (n < 1) return fallo('Indicá al menos un cabezal con falla (de los 20 inspeccionados).');
    if (tipos.length < 1) return fallo('Seleccioná al menos un tipo de falla.');
    if (Object.keys(cantidadesTipos).length !== tipos.length ||
        Object.keys(cantidadesTipos).some(k => !tipos.includes(k))) {
      return fallo('Indicá una cantidad para cada tipo seleccionado, sin tipos adicionales.');
    }
    let suma = 0;
    for (const tipo of tipos) {
      const valor = cantidadesTipos[tipo];
      const cantidad = Number(valor);
      if (valor === '' || valor === null || valor === undefined ||
          !Number.isInteger(cantidad) || cantidad < 1 || cantidad > n) {
        return fallo(`Cantidad inválida en ${tipo}: debe ser entre 1 y ${n} cabezales.`);
      }
      suma += cantidad;
    }
    // Condición necesaria: todo cabezal afectado debe figurar en al menos un tipo.
    // Se admite suma > n porque una unidad puede presentar múltiples tipos.
    if (suma < n) return fallo('La suma por tipo no puede ser menor a los cabezales únicos afectados.');
    return correcto();
  }
  return fallo('El resultado de la prueba no es válido.');
}

export function resumirPruebasConFalla(pruebas = []) {
  const evaluables = pruebas.filter(p =>
    p.estadoFinal !== 'PENDIENTE' &&
    (p.estado === 'OK' || p.estado === 'RECHAZADO')
  );
  const conFalla = evaluables.filter(p => p.estado === 'RECHAZADO').length;
  return {
    evaluables: evaluables.length,
    conFalla,
    ok: evaluables.length - conFalla,
    porcentajeConFalla: evaluables.length > 0
      ? Math.round(100 * conFalla / evaluables.length)
      : null,
  };
}
