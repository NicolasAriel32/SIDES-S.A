// =================================================================
// Capa de datos · Módulos Control de Calidad y Recontrol
// Todas las lecturas/escrituras a Supabase pasan por acá.
// Las vistas reciben datos ya transformados a la forma que usan.
// =================================================================

import { supabase } from '../supabase.js'

const throwIf = (error, ctx) => {
  if (error) throw new Error(`[calidad/${ctx}] ${error.message}`)
}

// ─── Helpers de formato ──────────────────────────────────────────
// Los timestamps de la DB son "timestamp without time zone" en UTC.
const asDate = (ts) => (ts ? new Date(ts.endsWith('Z') ? ts : ts + 'Z') : null)
export const fmtHora = (ts) => {
  const d = asDate(ts)
  return d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''
}
export const fmtFecha = (ts) => {
  const d = asDate(ts)
  return d ? d.toLocaleDateString('es-AR') : ''
}

// =================================================================
// CATÁLOGOS
// =================================================================
export async function fetchCatalogos() {
  const [prod, insp, def, maq] = await Promise.all([
    supabase.from('especifc_producto').select('*').eq('activo', true).order('nombre_producto'),
    supabase.from('inspectores_calidad').select('legajo, nombre').eq('activo', true).order('legajo'),
    supabase.from('tipos_falla').select('id, nombre, gravedad').order('nombre'),
    supabase.from('maquinas').select('id, nombre, activa').order('id'),
  ])
  throwIf(prod.error, 'productos')
  throwIf(insp.error, 'inspectores')
  throwIf(def.error, 'defectos')
  throwIf(maq.error, 'maquinas')

  // productos como mapa { nombre: {id, largo_min, largo_max, largo_nom, apertura_min, apertura_max} }
  const productos = {}
  for (const p of prod.data) {
    productos[p.nombre_producto] = {
      id: p.id,
      largo_min: Number(p.largo_min_mm),
      largo_max: Number(p.largo_max_mm),
      largo_nom: Number(p.largo_nom_mm),
      apertura_min: Number(p.apertura_min_g),
      apertura_max: Number(p.apertura_max_g),
    }
  }
  return {
    productos,
    inspectores: insp.data,
    defectos: def.data,                       // [{id:'PCD', nombre:'Pico descolorido', gravedad}]
    maquinas: maq.data.filter(m => m.activa !== false).map(m => m.id),
  }
}

// =================================================================
// SESIÓN DE TURNO
// =================================================================
const sesionToFront = (s) => s && ({
  uuid: s.id,
  id: s.codigo,
  fecha: new Date(s.fecha + 'T00:00:00').toLocaleDateString('es-AR'),
  turno: s.turno_codigo,
  inspectores: s.inspectores || [],
})

export async function fetchSesionAbierta() {
  const { data, error } = await supabase
    .from('sesiones_calidad')
    .select('*')
    .eq('estado', 'ABIERTA')
    .order('created_at', { ascending: false })
    .limit(1)
  throwIf(error, 'fetchSesionAbierta')
  return sesionToFront(data?.[0])
}

export async function crearSesion({ turno, inspectores, userId }) {
  const now = new Date()
  const codigo = `SES-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const { data, error } = await supabase
    .from('sesiones_calidad')
    .insert({ codigo, turno_codigo: turno, inspectores, abierta_por: userId || null })
    .select()
    .single()
  throwIf(error, 'crearSesion')
  return sesionToFront(data)
}

export async function actualizarSesion(sesionUuid, { turno, inspectores }) {
  const { data, error } = await supabase
    .from('sesiones_calidad')
    .update({ turno_codigo: turno, inspectores })
    .eq('id', sesionUuid)
    .select()
    .single()
  throwIf(error, 'actualizarSesion')
  return sesionToFront(data)
}

export async function cerrarSesion(sesionUuid) {
  const { error } = await supabase
    .from('sesiones_calidad')
    .update({ estado: 'CERRADA', cerrada_at: new Date().toISOString() })
    .eq('id', sesionUuid)
  throwIf(error, 'cerrarSesion')
}

// =================================================================
// ÓRDENES POR MÁQUINA
// =================================================================
export async function fetchOrdenesActivas() {
  const { data, error } = await supabase
    .from('ordenes_maquina')
    .select('*')
    .eq('activa', true)
  throwIf(error, 'fetchOrdenesActivas')
  // mapa por máquina
  const map = {}
  for (const o of data) {
    map[o.maquina_id] = {
      orden_maquina_id: o.id,
      especifc_producto_id: o.especifc_producto_id,
      producto: o.nombre_producto,
      lote: o.numero_lote,
      cliente: o.cliente || '',
      orden_id: o.orden_produccion || '',
    }
  }
  return map
}

/** Cierra la orden activa (si existe) y abre una nueva. */
export async function cambiarOrden({ maquinaId, producto, especifcProductoId, lote, cliente, ordenId, sesionUuid }) {
  const { error: errCierre } = await supabase
    .from('ordenes_maquina')
    .update({ activa: false, cerrada_en: new Date().toISOString() })
    .eq('maquina_id', maquinaId)
    .eq('activa', true)
  throwIf(errCierre, 'cambiarOrden.cierre')

  const { data, error } = await supabase
    .from('ordenes_maquina')
    .insert({
      maquina_id: maquinaId,
      especifc_producto_id: especifcProductoId || null,
      nombre_producto: producto,
      numero_lote: lote,
      cliente: cliente || null,
      orden_produccion: ordenId || null,
      sesion_apertura_id: sesionUuid || null,
    })
    .select()
    .single()
  throwIf(error, 'cambiarOrden.alta')
  return {
    orden_maquina_id: data.id,
    especifc_producto_id: data.especifc_producto_id,
    producto: data.nombre_producto,
    lote: data.numero_lote,
    cliente: data.cliente || '',
    orden_id: data.orden_produccion || '',
  }
}

// =================================================================
// CONTROLES DE CALIDAD
// =================================================================
const controlToFront = (r) => {
  const ap = ['', '', '', ''], lg = ['', '', '', '']
  const alertasAp = [false, false, false, false], alertasLg = [false, false, false, false]
  for (const m of r.mediciones || []) {
    const i = m.posicion_cabezal - 1
    if (i < 0 || i > 3) continue
    if (m.tipo_medicion === 'APERTURA') { ap[i] = String(Number(m.valor)); alertasAp[i] = m.fuera_rango }
    else { lg[i] = String(Number(m.valor)); alertasLg[i] = m.fuera_rango }
  }
  return {
    id_reg: r.id,
    numero_secuencial: r.numero_secuencial,
    id_maquina: r.id_maquina,
    orden_maquina_id: r.orden_maquina_id,
    nro_caja: r.numero_caja,
    hora: fmtHora(r.fecha_hora),
    fecha: fmtFecha(r.fecha_hora),
    sesion_id: r.sesion_id,
    lote: r.numero_lote,
    producto: r.nombre_producto,
    cliente: r.cliente,
    orden_id: r.orden_id,
    inspector_legajo: r.inspector_legajo,
    inspector_nombre: r.inspector_nombre,
    apertura_tapa: ap,
    largo_cabezal: lg,
    alertas_ap: alertasAp,
    alertas_lg: alertasLg,
    no_conforme: r.no_conforme ? 'Sí' : 'No',
    defectos: (r.controles_defectos || []).map(d => d.tipos_falla?.nombre || d.tipo_falla_id),
    defectos_ids: (r.controles_defectos || []).map(d => d.tipo_falla_id),
    observacion_libre: r.observacion_libre || '',
    cantidad_rechazo: r.cantidad_rechazo != null ? String(r.cantidad_rechazo) : '',
    caja_desde: r.caja_desde != null ? String(r.caja_desde) : '',
    caja_hasta: r.caja_hasta != null ? String(r.caja_hasta) : '',
    timestamp: r.fecha_hora,
    anulada: r.anulada,
  }
}

/** Controles del día (sesión actual + órdenes archivadas hoy). */
export async function fetchControlesDelDia() {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('controles_calidad')
    .select('*, mediciones(*), controles_defectos(tipo_falla_id, tipos_falla(nombre))')
    .gte('fecha_hora', hoy.toISOString())
    .eq('anulada', false)
    .order('fecha_hora', { ascending: false })
  throwIf(error, 'fetchControlesDelDia')
  return (data || []).map(controlToFront)
}

/**
 * Guarda control + 8 mediciones + defectos + NC (si corresponde)
 * en una sola transacción (RPC guardar_control_calidad).
 */
export async function guardarControl({
  maquinaId, orden, sesion, inspector, nroCaja,
  aperturas, largos, alertasAp, alertasLg,
  noConforme, defectosIds, observacion,
  cantidadRechazo, cajaDesde, cajaHasta,
}) {
  const mediciones = [
    ...aperturas.map((v, i) => ({ posicion: i + 1, tipo: 'APERTURA', valor: Number(v), unidad: 'g', fuera_rango: !!alertasAp[i] })),
    ...largos.map((v, i) => ({ posicion: i + 1, tipo: 'LARGO', valor: Number(v), unidad: 'mm', fuera_rango: !!alertasLg[i] })),
  ]
  const { data, error } = await supabase.rpc('guardar_control_calidad', {
    p: {
      id_maquina: maquinaId,
      orden_maquina_id: orden.orden_maquina_id || '',
      sesion_calidad_id: sesion.uuid || '',
      especifc_producto_id: orden.especifc_producto_id || '',
      inspector_legajo: inspector?.legajo || '',
      inspector_nombre: inspector?.nombre || '',
      numero_caja: nroCaja,
      numero_lote: orden.lote,
      nombre_producto: orden.producto,
      cliente: orden.cliente,
      orden_id: orden.orden_id || '',
      sesion_id: sesion.id,
      no_conforme: noConforme,
      observacion_libre: observacion || '',
      cantidad_rechazo: cantidadRechazo || '',
      caja_desde: cajaDesde || '',
      caja_hasta: cajaHasta || '',
      mediciones,
      defectos: defectosIds,
    },
  })
  throwIf(error, 'guardarControl')
  return data // { control_id, numero_secuencial, no_conformidad_id, numero_nc }
}

// =================================================================
// RECONTROL
// =================================================================
/** NCs abiertas/en análisis originadas en control de calidad → cola de recontrol. */
export async function fetchRechazosPendientes() {
  const { data, error } = await supabase
    .from('no_conformidades')
    .select(`
      id, numero_nc, estado, timestamp_apertura,
      controles_calidad!no_conformidades_control_calidad_id_fkey (
        id, id_maquina, nombre_producto, numero_lote, cliente,
        caja_desde, caja_hasta, cantidad_rechazo,
        inspector_nombre, observacion_libre, fecha_hora,
        controles_defectos(tipo_falla_id, tipos_falla(nombre))
      )
    `)
    .not('control_calidad_id', 'is', null)
    .in('estado', ['ABIERTA', 'EN ANALISIS'])
    .order('timestamp_apertura', { ascending: true })
  throwIf(error, 'fetchRechazosPendientes')
  return (data || [])
    .filter(nc => nc.controles_calidad)
    .map(nc => {
      const c = nc.controles_calidad
      return {
        id: nc.id,
        numero: nc.numero_nc,
        estado: 'PENDIENTE',
        estado_nc: nc.estado,
        control_calidad_id: c.id,
        fecha_apertura: `${fmtFecha(nc.timestamp_apertura)} ${fmtHora(nc.timestamp_apertura)}`,
        inspector_abrio: c.inspector_nombre || '—',
        id_maquina: c.id_maquina,
        producto: c.nombre_producto,
        lote: c.numero_lote,
        cliente: c.cliente,
        caja_desde: c.caja_desde != null ? String(c.caja_desde) : '',
        caja_hasta: c.caja_hasta != null ? String(c.caja_hasta) : '',
        cantidad_rechazo: c.cantidad_rechazo || 0,
        defectos: (c.controles_defectos || []).map(d => d.tipos_falla?.nombre || d.tipo_falla_id),
        observacion: c.observacion_libre || '',
      }
    })
}

/** Recontroles ya hechos hoy (para la sección "recontrolados"). */
export async function fetchRecontrolesDelDia() {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('recontroles')
    .select(`
      id, numero_secuencial, resultado, kg_merma,
      cabezales_descartados, cabezales_recuperados, fecha_hora,
      no_conformidades!recontroles_no_conformidad_id_fkey (
        numero_nc,
        controles_calidad!no_conformidades_control_calidad_id_fkey (id_maquina, nombre_producto, numero_lote)
      )
    `)
    .gte('fecha_hora', hoy.toISOString())
    .eq('anulado', false)
    .order('fecha_hora', { ascending: false })
  throwIf(error, 'fetchRecontrolesDelDia')
  return (data || []).map(r => {
    const nc = r.no_conformidades
    const c = nc?.controles_calidad
    return {
      id: r.id,
      numero: nc?.numero_nc,
      estado: 'RECONTROLADO',
      id_maquina: c?.id_maquina || '—',
      producto: c?.nombre_producto || '—',
      lote: c?.numero_lote || '—',
      _resultado: r.resultado,
      _merma: Number(r.kg_merma || 0),
      _descartados: r.cabezales_descartados,
      _recuperados: r.cabezales_recuperados,
    }
  })
}

/** Guarda recontrol + defectos y cierra/avanza la NC (RPC guardar_recontrol). */
export async function guardarRecontrol({
  noConformidadId, controlCalidadId, inspector,
  accionPrevia, reinspeccionados, descartados,
  resultado, kgMerma, esFinal, observaciones, defectosIds,
}) {
  const { data, error } = await supabase.rpc('guardar_recontrol', {
    p: {
      no_conformidad_id: noConformidadId,
      control_calidad_id: controlCalidadId || '',
      inspector_legajo: inspector?.legajo || '',
      inspector_nombre: inspector?.nombre || '',
      accion_previa: accionPrevia,
      cabezales_reinspeccionados: reinspeccionados,
      cabezales_descartados: descartados,
      resultado,
      kg_merma: kgMerma != null ? String(kgMerma) : '',
      es_recontrol_final: esFinal,
      observaciones: observaciones || '',
      defectos: defectosIds,
    },
  })
  throwIf(error, 'guardarRecontrol')
  return data // { recontrol_id, numero_secuencial, numero_intento }
}
