// SIDES 2.0 — SPC-002: resumen descriptivo sin decisiones automáticas.
// La aprobación estadística es responsabilidad de Calidad, no del navegador.
import { CABEZALES_POR_MUESTRA, validarResultadoEstanqueidad } from './estanqueidad.js';

export const MAQUINA_PILOTO_SPC = 'MAQ-010';
const aptitudAutorizada = 'VALIDADO';

const cadena = x => typeof x === 'string' && x.trim().length > 0;
const productoDe = p => cadena(p?.codigoProducto) ? p.codigoProducto.trim() : null;
const idDe = p => {
  const id = p?.supabase_id ?? p?.id;
  return cadena(id) ? id : null;
};
const esEnsayo = p => !['PENDIENTE', 'ANULADA', 'ANULADO', 'CANCELADA'].includes(p?.estadoFinal) &&
  (p?.estado === 'OK' || p?.estado === 'RECHAZADO');

function categorizarMuestra(p) {
  if (p.aptitudSpc !== aptitudAutorizada) return 'NO_VALIDADO';
  if (!productoDe(p) || p.cabezalesInspeccionados !== CABEZALES_POR_MUESTRA ||
      !Number.isInteger(p.cabezalesFalla) ||
      !cadena(p.timestamp) || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(p.timestamp) ||
      !Number.isFinite(Date.parse(p.timestamp))) {
    return 'INCOMPLETO';
  }
  return validarResultadoEstanqueidad({
    estado: p.estado, cabezalesFalla: p.cabezalesFalla,
    tipos: p.tipos, cantidadesTipos: p.cantidadesTipos,
  }).ok ? 'APTA' : 'INCOMPLETO';
}

const crearSerie = producto => ({
  producto, ensayosRegistrados: 0, muestrasAptas: 0,
  muestrasNoValidadas: 0, muestrasIncompletas: 0, muestrasDuplicadas: 0,
  cabezalesInspeccionados: 0, cabezalesDefectuosos: 0,
  proporcionDefectuosa: null,
});

/**
 * Sólo procesa registros leídos mediante los servicios existentes (RLS).
 * No demuestra cobertura de consulta, cumplimiento OT ni estabilidad del proceso.
 * Nunca mezcla proporciones entre productos diferentes.
 */
export function resumirSpcPiloto(pruebas = [], maquina = MAQUINA_PILOTO_SPC) {
  const filtradas = (Array.isArray(pruebas) ? pruebas : [])
    .filter(p => p && typeof p === 'object' && p.maquina === maquina);
  const ids = new Map();
  for (const p of filtradas) {
    const id = idDe(p);
    if (id) ids.set(id, (ids.get(id) || 0) + 1);
  }

  const total = {
    maquina, registrosRecuperados: filtradas.length,
    pendientesONoEnsayos: 0, ensayosRegistrados: 0,
    muestrasAptas: 0, muestrasNoValidadas: 0,
    muestrasIncompletas: 0, muestrasDuplicadas: 0,
    porProducto: [], limitesControl: null,
    cumplimientoOT: null, alertasAutomaticas: false,
  };
  const series = new Map();
  for (const p of filtradas) {
    if (!esEnsayo(p)) {
      total.pendientesONoEnsayos++;
      continue;
    }
    total.ensayosRegistrados++;
    const producto = productoDe(p) || 'SIN_PRODUCTO';
    if (!series.has(producto)) series.set(producto, crearSerie(producto));
    const serie = series.get(producto);
    serie.ensayosRegistrados++;

    const id = idDe(p);
    const categoria = id && ids.get(id) > 1 ? 'DUPLICADO' : categorizarMuestra(p);
    if (categoria === 'APTA') {
      total.muestrasAptas++;
      serie.muestrasAptas++;
      serie.cabezalesInspeccionados += p.cabezalesInspeccionados;
      serie.cabezalesDefectuosos += Number(p.cabezalesFalla);
    } else if (categoria === 'NO_VALIDADO') {
      total.muestrasNoValidadas++;
      serie.muestrasNoValidadas++;
    } else if (categoria === 'DUPLICADO') {
      total.muestrasDuplicadas++;
      serie.muestrasDuplicadas++;
    } else {
      total.muestrasIncompletas++;
      serie.muestrasIncompletas++;
    }
  }

  total.porProducto = [...series.values()].map(s => ({
    ...s, proporcionDefectuosa: s.cabezalesInspeccionados > 0
      ? s.cabezalesDefectuosos / s.cabezalesInspeccionados : null,
  })).sort((a, b) => a.producto.localeCompare(b.producto));
  return total;
}
