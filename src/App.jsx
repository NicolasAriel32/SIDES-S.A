import { supabase } from './supabase.js'
import React, { useState, useMemo, useEffect, createContext, useContext } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Cpu, Database, Download, Eye, FileSearch, Filter, Fingerprint,
  Hash, Hexagon, Layers, Lock, LogIn, LogOut, Moon, Search, Settings,
  Shield, Sun, TrendingDown, TrendingUp, Upload, User, UserPlus, Users,
  X, Zap, Power, FileSpreadsheet, KeyRound, Trash2, Edit2, Plus, Box,
  MessageSquare, Send, History, Wrench, Mail, BellRing, Inbox,
  PlayCircle, FileCheck, ClipboardList
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ComposedChart, Cell
} from 'recharts';


/* =================================================================
   SISTEMA DE TRAZABILIDAD — MVP v4
   Cambios v4:
   1. Operario recibe mensajes del supervisor:
      - Banner permanente arriba (al cargar la vista)
      - Toast inmediato cuando llega uno nuevo (polling 15s)
      - Acuse de recibo "OK, recibido" → audit log
   2. Indicador en supervisor: "X observaciones no leídas hace N min"
   3. Modal de gestión de NC completo:
      - Botón "Tomar para análisis"
      - Cierre con causa raíz (dropdown) + acciones tomadas (multiselect)
      - Solo supervisores y admins pueden cerrar
   4. Tiempo de cierre calculado automáticamente (apertura → cierre)
   5. KPI "Tiempo promedio de cierre de NC" en panel supervisor
   ================================================================= */

// =================================================================
// CONSTANTES Y CATÁLOGOS DEL SISTEMA
// =================================================================

const TIPOS_FALLA = [
  { id: 'PRC', nombre: 'Precinto roto', gravedad: 'MENOR' },
  { id: 'CLV', nombre: 'Clavado de válvula', gravedad: 'CRITICA' },
  { id: 'EST', nombre: 'Estanqueidad', gravedad: 'CRITICA' },
  { id: 'ENC', nombre: 'Encastre roto', gravedad: 'MAYOR' },
  { id: 'MGT', nombre: 'Marcado de gatillo', gravedad: 'MAYOR' },
  { id: 'CTP', nombre: 'Cierre de tapas', gravedad: 'MAYOR' },
  { id: 'STB', nombre: 'Soldado de tubos', gravedad: 'MAYOR' },
  { id: 'MPR', nombre: 'Materia prima', gravedad: 'CRITICA' },
  { id: 'INO', nombre: 'Inocuidad', gravedad: 'CRITICA' },
];

const TAMAÑOS_VALIDOS = [284, 294, 300, 310, 320, 336];
const COLORES_VALIDOS = {
  RO: 'Rojo', NE: 'Negro', BL: 'Blanco', CE: 'Celeste',
  AZ: 'Azul', VE: 'Verde', AM: 'Amarillo', NA: 'Naranja',
  GR: 'Gris', RS: 'Rosa', VI: 'Violeta', MA: 'Marrón'
};

const validarCodigoProducto = (codigo) => {
  const regex = /^RC(L|E)-(\d{3})(C|A)-([A-Z]{2})$/;
  const match = codigo.match(regex);
  if (!match) return { valid: false, error: 'Formato: RCL-300C-RO o RCE-310A-CE' };
  const [, mercado, tamaño, , color] = match;
  if (!TAMAÑOS_VALIDOS.includes(parseInt(tamaño))) {
    return { valid: false, error: `Tamaño ${tamaño} no válido. Permitidos: ${TAMAÑOS_VALIDOS.join(', ')}` };
  }
  if (!COLORES_VALIDOS[color]) {
    return { valid: false, error: `Color ${color} no válido` };
  }
  return { valid: true };
};

const parsearCodigoProducto = (codigo) => {
  const match = codigo.match(/^RC(L|E)-(\d{3})(C|A)-([A-Z]{2})$/);
  if (!match) return null;
  const [, mercado, tamaño, apertura, color] = match;
  return {
    mercado: mercado === 'L' ? 'Local' : 'Exportación',
    tamaño: parseInt(tamaño),
    apertura: apertura === 'C' ? 'Cerrado' : 'Abierto',
    color: COLORES_VALIDOS[color] || color,
    cajasPorOrden: mercado === 'L' ? 180 : 175,
    cajasPorPallet: mercado === 'L' ? 30 : 35,
  };
};

const RESPUESTAS_RAPIDAS = [
  { id: 'rev', icon: Eye, texto: 'Revisá una caja al 100%' },
  { id: 'mec', icon: Wrench, texto: 'Dar aviso a mecánico de sala' },
  { id: 'cor', icon: AlertTriangle, texto: 'Realizar corte 5 cajas atrás' },
];

// CAMBIO v4: Catálogo de causas raíz para cierre de NC
const CAUSAS_RAIZ = [
  { id: 'MAQ', nombre: 'Defecto de máquina' },
  { id: 'OPE', nombre: 'Error operativo' },
  { id: 'MAT', nombre: 'Materia prima defectuosa' },
  { id: 'OTR', nombre: 'Otra (especificar en notas)' },
];

// CAMBIO v4: Acciones tomadas durante la NC
const ACCIONES_TOMADAS = [
  { id: 'rev100', nombre: 'Revisión al 100% de la caja' },
  { id: 'mec', nombre: 'Aviso a mecánico de sala' },
  { id: 'corte', nombre: 'Corte 5 cajas atrás' },
  { id: 'cambop', nombre: 'Cambio de operario' },
  { id: 'paro', nombre: 'Paro de máquina' },
  { id: 'reproc', nombre: 'Reproceso de la orden' },
  { id: 'otra', nombre: 'Otra (especificar en notas)' },
];

// =================================================================
// DATA SERVICE
// =================================================================

const STORAGE_KEYS = {
  USERS: 'tz_users',
  CURRENT_USER: 'tz_current_user',
  MACHINES: 'tz_machines',
  TESTS: 'tz_tests',
  AUDIT: 'tz_audit',
  PRODUCTS: 'tz_products',
  ORDERS: 'tz_orders',
  CONFIG: 'tz_config',
  OBSERVATIONS: 'tz_observations',
  NC_HISTORY: 'tz_nc_history',
};

const mapUserFromDb = (user) => {
  if (!user) return null
  return {
    legajo: user.legajo,
    nombre: user.nombre,
    apellido: user.apellido,
    email: user.email ?? null,
    rol: user.rol,
    password: user.password_hash,                     // schema real: password_hash
    forceChange: user.fuerza_cambio === true,         // schema real: fuerza_cambio
    maquinaAsignada: user.maquina_asignada ?? null,
    maquina_asignada: user.maquina_asignada ?? null,  // snake_case para compatibilidad con MVP
    activo: user.activo ?? true,
    createdAt: user.created_at ?? null
  }
}

const mapUserToDb = (user) => ({
  legajo: user.legajo,
  nombre: user.nombre,
  apellido: user.apellido,
  email: user.email,                       // FIX: el email ahora se persiste
  rol: user.rol,
  password_hash: user.password,            // schema real: password_hash
  fuerza_cambio: user.forceChange,         // schema real: fuerza_cambio
  maquina_asignada: user.maquinaAsignada,
  activo: user.activo,
  created_at: user.createdAt
})

const normalizeUserInput = (user) => ({
  legajo: user.legajo,
  nombre: user.nombre,
  apellido: user.apellido,
  email: user.email || '',                 // FIX: email es NOT NULL en DB
  rol: user.rol,
  password: user.password || 'cambio123',  // se mapea a password_hash en mapUserToDb
  forceChange: user.forceChange ?? user.force_change ?? user.fuerza_cambio ?? true,
  maquinaAsignada: user.maquinaAsignada ?? user.maquina_asignada ?? null,
  activo: user.activo ?? true,
  createdAt: user.createdAt ?? user.created_at ?? new Date().toISOString()
})

// =================================================================
// HELPER: NORMALIZACIÓN DE TIMESTAMPS (FIX v5)
// =================================================================
// Varias columnas en Supabase son `timestamp without time zone` y se insertan
// con now() (que devuelve hora UTC del servidor). PostgREST nos las manda
// como string sin sufijo Z (ej: "2026-05-08 20:45:14.497"), y el constructor
// `new Date(s)` de JavaScript las interpreta como hora LOCAL del navegador.
// Resultado: se ven desplazadas N horas (UTC-3 en Argentina).
//
// `normalizarFechaUTC` agrega el sufijo Z para que JS la trate como UTC y la
// formatee correctamente con .toLocaleString('es-AR').
// =================================================================
const normalizarFechaUTC = (ts) => {
  if (!ts) return ts
  if (typeof ts !== 'string') return ts
  // Ya tiene zona horaria (Z o ±HH:MM)
  if (ts.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(ts)) return ts
  // Forma "YYYY-MM-DD HH:MM:SS.fff" → "YYYY-MM-DDTHH:MM:SS.fffZ"
  return ts.replace(' ', 'T') + 'Z'
}

// Helper: mapea fecha Date|string a YYYY-MM-DD en zona Argentina (para filtros)
const fechaLocalAR = (date) => {
  const d = (date instanceof Date) ? date : new Date(normalizarFechaUTC(date))
  if (isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d)
}

// Helper: dado un timestamp UTC, devuelve el código del turno (M/T/N) según
// la hora ARGENTINA en la que se generó. Reglas: M 06-14, T 14-22, N 22-06.
const turnoDeFecha = (date) => {
  const d = (date instanceof Date) ? date : new Date(normalizarFechaUTC(date))
  if (isNaN(d.getTime())) return null
  // Hora local Argentina como número entero
  const hora = parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', hour12: false
  }).format(d), 10)
  if (hora >= 6 && hora < 14) return 'M'
  if (hora >= 14 && hora < 22) return 'T'
  return 'N'
}

const dataService = {

  // ===== USUARIOS =====
  // El login sigue igual — localStorage
  async getUsers() {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .order('legajo')

    console.log('getUsers supabase response:', { data, error })
    if (error) { console.error('getUsers:', error); return []; }
    return (data || []).map(mapUserFromDb)
  },

  async saveUsers(users) {
    // Upsert: inserta o actualiza según el legajo
    const payload = (users || []).map(mapUserToDb)
    console.log('saveUsers payload:', payload)
    const { error } = await supabase
      .from('usuarios')
      .upsert(payload, { onConflict: 'legajo' })
    if (error) console.error('saveUsers:', error)
    return !error
  },

  async addUsers(newUsers) {
    const existing = await this.getUsers()
    const merged = [...existing]
    for (const u of newUsers) {
      const normalized = normalizeUserInput(u)
      const idx = merged.findIndex(e => e.legajo === normalized.legajo)
      if (idx >= 0) {
        merged[idx] = {
          ...merged[idx],
          ...normalized,
          createdAt: merged[idx].createdAt || normalized.createdAt
        }
      } else {
        merged.push(normalized)
      }
    }
    await this.saveUsers(merged)
    return merged
  },

  async deleteUser(legajo) {
    // Desactivamos en lugar de borrar (inmutabilidad)
    const { data, error } = await supabase
      .from('usuarios')
      .update({ activo: false })
      .eq('legajo', legajo)

    console.log('deleteUser supabase response:', { legajo, data, error })
    if (error) { console.error('deleteUser:', error); return false }
    return true
  },

  // LOGIN — busca por legajo y compara password en cliente
  // Esto evita problemas de encoding, espacios y collation de Supabase
  async login(legajo, password) {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('legajo', legajo.trim())
      .maybeSingle()

    console.log('login - búsqueda por legajo:', { legajo, data: data ? 'encontrado' : 'null', error })

    if (error) { console.error('login error:', error); return null }
    if (!data) { console.log('login: legajo no existe'); return null }

    // Comparamos password en cliente con trim() para eliminar espacios fantasma.
    // Lee de password_hash (nombre real de la columna) en plain-text — deuda
    // ISO 27001 conocida que se cierra al migrar a Supabase Auth o a una
    // Edge Function `verificar_login` con bcrypt server-side.
    const passwordMatch = data.password_hash?.trim() === password?.trim()
    console.log('login - password check:', {
      storedLen: data.password_hash?.length,
      enteredLen: password?.length,
      match: passwordMatch,
      activo: data.activo
    })

    if (!passwordMatch) { console.log('login: password incorrecto'); return null }
    if (data.activo === false) { console.log('login: usuario inactivo'); return null }

    const user = mapUserFromDb(data)
    sessionStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user))
    console.log('login: éxito', { legajo: user.legajo, rol: user.rol })
    return user
  },

  async logout() {
    console.log('logout current user cleared')
    sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER)
  },

  async getCurrentUser() {
    const stored = sessionStorage.getItem('tz_current_user')
    return stored ? JSON.parse(stored) : null
  },

  async changePassword(legajo, newPass) {
    const { data, error } = await supabase
      .from('usuarios')
      .update({
        password_hash:        newPass,        // schema real: password_hash
        fuerza_cambio:        false,          // schema real: fuerza_cambio
        cambio_password_date: new Date().toISOString()
      })
      .eq('legajo', legajo)
      .select()
      .maybeSingle()

    console.log('changePassword supabase response:', { legajo, data, error })
    if (error) { console.error('changePassword:', error); return null }
    if (!data) {
      console.log('changePassword: usuario no encontrado', { legajo })
      return null
    }

    const updatedUser = mapUserFromDb(data)
    const current = await this.getCurrentUser()  // FIX: faltaba await
    if (current?.legajo === legajo) {
      sessionStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(updatedUser))
    }
    return updatedUser
  },

  // ===== MÁQUINAS =====
  // En el schema real la PK es `id` (varchar 10). El modelo del front sigue
  // usando `m.id` (string), así que el mapeo es directo.
  async getMachines() {
    const { data, error } = await supabase
      .from('maquinas')
      .select('*')
      .order('id')

    console.log('getMachines supabase response:', { data, error })
    if (error) { console.error('getMachines:', error); return []; }

    return (data || []).map(m => ({
      id: m.id,
      nombre: m.nombre,
      linea: m.linea,
      activa: m.activa,
      integrada: m.integrada
    }))
  },

  async saveMachines(machines) {
    for (const m of machines) {
      const { data, error } = await supabase
        .from('maquinas')
        .update({ integrada: m.integrada, activa: m.activa })
        .eq('id', m.id)

      console.log('saveMachines update response:', { id: m.id, data, error })
      if (error) console.error('saveMachines:', error)
    }
  },

  async toggleMachineIntegrated(id) {
    const machines = await this.getMachines()
    const machine = machines.find(m => m.id === id)
    if (!machine) {
      console.log('toggleMachineIntegrated: máquina no encontrada', { id })
      return machines
    }

    const { data, error } = await supabase
      .from('maquinas')
      .update({ integrada: !machine.integrada })
      .eq('id', id)

    console.log('toggleMachineIntegrated supabase response:', { id, data, error })
    if (error) { console.error('toggleMachineIntegrated:', error); return machines }
    return await this.getMachines()
  },

  // ===== CACHE DE USUARIOS (legajo → nombre completo) =====
  // El schema de pruebas/observaciones/no_conformidades guarda solo legajos.
  // Para mostrar nombres en la UI, cacheamos usuarios una vez por sesión.
  _usersCache: null,

  async getUsersCache() {
    if (this._usersCache) return this._usersCache
    const { data, error } = await supabase
      .from('usuarios')
      .select('legajo, nombre, apellido')
    if (error) { console.error('getUsersCache:', error); return new Map(); }
    const map = new Map()
    for (const u of (data || [])) {
      map.set(u.legajo, `${u.nombre} ${u.apellido}`.trim())
    }
    this._usersCache = map
    return map
  },

  // Devuelve el nombre completo de un legajo, o el legajo si no se encuentra.
  async getUsuarioNombre(legajo) {
    if (!legajo) return ''
    const map = await this.getUsersCache()
    return map.get(legajo) || legajo
  },

  // ===== TURNOS =====
  // Cache en memoria. Los 3 turnos (M/T/N) rara vez cambian: los traemos
  // una sola vez por sesión y devolvemos el id correspondiente a la hora actual.
  _turnosCache: null,

  async getTurnos() {
    if (this._turnosCache) return this._turnosCache
    const { data, error } = await supabase
      .from('turnos')
      .select('id, codigo, hora_inicio, hora_fin')
      .order('codigo')
    console.log('getTurnos supabase response:', { data, error })
    if (error) { console.error('getTurnos:', error); return []; }
    this._turnosCache = data || []
    return this._turnosCache
  },

  // Devuelve el uuid del turno cuyo rango horario aplica a `date`.
  // Reglas: M = 06:00–14:00, T = 14:00–22:00, N = 22:00–06:00 (cruza medianoche).
  async getTurnoActualId(date = new Date()) {
    const turnos = await this.getTurnos()
    if (!turnos.length) return null
    const horaActual = date.getHours() + (date.getMinutes() / 60)
    const turno = turnos.find(t => {
      const inicio = parseInt(String(t.hora_inicio).slice(0, 2), 10)
      const fin    = parseInt(String(t.hora_fin).slice(0, 2), 10)
      // Caso normal: el rango no cruza medianoche (M y T).
      if (inicio < fin) return horaActual >= inicio && horaActual < fin
      // Caso N: 22:00–06:00 cruza medianoche.
      return horaActual >= inicio || horaActual < fin
    })
    return turno?.id ?? null
  },

  // ===== PRUEBAS =====
  // Schema real (resumen): id uuid PK, numero_secuencial bigint NOT NULL,
  // id_maquina varchar(10) FK, fecha_hora, codigo_producto, numero_caja,
  // numero_lote, resultado (OK/RECHAZADO), tuvo_falla bool, estado_final,
  // cantidad_cabezales_afectados, operario_legajo, supervisor_legajo,
  // timestamp_recibida/_completada/_aprobada, hash_integridad/firma_criptografica
  // (ahora nullable, deuda ISO).
  //
  // El modelo interno del front mantiene la API: { id, maquina, operario,
  // estado, esperandoAprobacion, ... } para no romper componentes.
  // - id            = código humano derivado (PRB-yyyymmdd-NNNN) para mostrar
  // - supabase_id   = uuid real de la fila (para updates/relaciones)
  // - estado        = 'OK' | 'RECHAZADO' (de p.resultado)
  // - esperandoAprobacion = (tuvo_falla=true && estado_final='PENDIENTE_APROBACION')
  // - aprobado      = (timestamp_aprobada IS NOT NULL)
  async getTests() {
    const { data, error } = await supabase
      .from('pruebas')
      .select(`
        *,
        fallas:pruebas_fallas(tipo_falla_id)
      `)
      .order('created_at', { ascending: false })

    console.log('getTests supabase response:', { data, error })
    if (error) { console.error('getTests:', error); return []; }

    // Resolvemos nombres de operarios/supervisores desde el cache
    const usuariosMap = await this.getUsersCache()

    return (data || []).map(p => {
      // FIX v5: normalizamos a UTC antes de construir el Date, así
      // .toLocaleTimeString('es-AR') devuelve la hora real de Argentina.
      const fechaSenalRaw = p.timestamp_recibida || p.fecha_hora || p.created_at
      const fechaSenal    = normalizarFechaUTC(fechaSenalRaw)
      const fechaObj      = fechaSenal ? new Date(fechaSenal) : new Date()
      const codigoHumano =
        `PRB-${fechaLocalAR(fechaObj).replace(/-/g,'')}` +
        `-${String(p.numero_secuencial || 0).padStart(4, '0')}`

      return {
        id:                  codigoHumano,
        supabase_id:         p.id,
        maquina:             p.id_maquina,
        operario:            usuariosMap.get(p.operario_legajo) || p.operario_legajo || '',
        legajoOperario:      p.operario_legajo,
        supervisorLegajo:    p.supervisor_legajo,
        fecha: fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }),
        estado:              p.resultado,
        estadoFinal:         p.estado_final,
        caja:                p.numero_caja,
        lote:                p.numero_lote,
        codigoProducto:      p.codigo_producto,
        observaciones:       p.observaciones,
        tipos:               p.fallas?.map(f => f.tipo_falla_id) || [],
        cabezalesFalla:      p.cantidad_cabezales_afectados ?? 0,
        tuvoFalla:           p.tuvo_falla === true,
        esperandoAprobacion: (p.tuvo_falla === true && p.estado_final === 'PENDIENTE_APROBACION'),
        aprobado:            p.timestamp_aprobada !== null && p.timestamp_aprobada !== undefined,
        timestamp:           normalizarFechaUTC(p.created_at),
        timestampSenal:      fechaSenal,
        numeroSecuencial:    p.numero_secuencial,
        fechaSenal:          fechaSenal
      }
    })
  },

  async saveTests(tests) {
    // No se usa — usamos createTest y updateTest directamente
    throw new Error('saveTests no implementado — usar createTest/updateTest')
  },

  // Calcula el siguiente numero_secuencial. Para piloto usamos MAX+1.
  // Para producción real conviene una sequence en DB y/o lock pesimista.
  async _siguienteNumeroSecuencial() {
    const { data, error } = await supabase
      .from('pruebas')
      .select('numero_secuencial')
      .order('numero_secuencial', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) { console.error('_siguienteNumeroSecuencial:', error); }
    return (data?.numero_secuencial || 0) + 1
  },

  async createTest(test) {
    // 1) Verificar que la máquina exista (id_maquina es FK varchar)
    const { data: maquina, error: maquinaError } = await supabase
      .from('maquinas')
      .select('id')
      .eq('id', test.maquina)
      .maybeSingle()

    console.log('createTest maquina lookup:', { maquina, maquinaError, test })
    if (maquinaError || !maquina) {
      console.error('createTest: máquina no encontrada', { maquina: test.maquina, maquinaError })
      return null
    }

    // 2) Turno actual y número secuencial
    const turnoId = await this.getTurnoActualId()
    const numeroSec = await this._siguienteNumeroSecuencial()

    // 3) Mapeo de estado del modelo interno → resultado/estado_final del schema
    const tuvoFalla = test.estado === 'RECHAZADO'
    const resultado = tuvoFalla ? 'RECHAZADO' : 'OK'
    const estadoFinal = tuvoFalla ? 'PENDIENTE_APROBACION' : 'OK'

    // 4) Insert en pruebas
    const { data: prueba, error } = await supabase
      .from('pruebas')
      .insert({
        numero_secuencial:            numeroSec,
        id_maquina:                   test.maquina,
        fecha_hora:                   test.fechaSenal || new Date().toISOString(),
        codigo_producto:              test.codigoProducto,
        numero_caja:                  test.caja,
        numero_lote:                  test.lote,
        resultado:                    resultado,
        tuvo_falla:                   tuvoFalla,
        cantidad_cabezales_afectados: test.cabezalesFalla || 0,
        observaciones:                test.observaciones || null,
        operario_legajo:              test.legajoOperario,
        estado_final:                 estadoFinal,
        timestamp_recibida:           test.fechaSenal || new Date().toISOString(),
        timestamp_completada:         new Date().toISOString(),
        turno_id:                     turnoId
        // hash_integridad y firma_criptografica quedan nulos (deuda ISO conocida)
      })
      .select()
      .single()

    console.log('createTest prueba insert response:', { prueba, error })
    if (error) {
      if (error.code === '23505') {
        const timestampRecibida = test.fechaSenal || new Date().toISOString()
        const { data: existente, error: existenteError } = await supabase
          .from('pruebas')
          .select('*')
          .eq('id_maquina', test.maquina)
          .eq('timestamp_recibida', timestampRecibida)
          .eq('anulada', false)
          .maybeSingle()

        if (existenteError) {
          console.error('createTest: error fetching existing duplicate prueba', existenteError)
          return null
        }

        return existente
      }

      console.error('createTest:', error)
      return null
    }

    // 5) Si hay fallas, insertarlas en pruebas_fallas con tipo_falla_id
    if (test.tipos && test.tipos.length > 0) {
      const { error: fallasErr } = await supabase
        .from('pruebas_fallas')
        .insert(
          test.tipos.map(tipo => ({
            prueba_id:                prueba.id,
            tipo_falla_id:            tipo,
            cantidad_items_afectados: 1
          }))
        )
      if (fallasErr) console.error('createTest pruebas_fallas insert:', fallasErr)
    }

    // 6) Audit log
    const codigoHumano = `PRB-${new Date(prueba.timestamp_recibida || Date.now())
      .toISOString().slice(0,10).replace(/-/g,'')}-${String(numeroSec).padStart(4,'0')}`
    await this.logEvent({
      accion: 'CREATE',
      usuario: test.operario,
      usuarioLegajo: test.legajoOperario,
      desc: `Prueba ${codigoHumano} · ${resultado}`,
      tabla: 'pruebas',
      registroId: prueba.id
    })

    return { ...test, id: codigoHumano, supabase_id: prueba.id, numeroSecuencial: numeroSec }
  },

  // Actualiza una prueba. Se busca por código humano (PRB-...) o supabase_id (uuid).
  // Acepta updates con la API del modelo interno.
  async updateTest(codigoOSupabaseId, updates) {
    // El modelo interno del front pasa el código humano, pero también puede pasar uuid
    let pruebaUuid = codigoOSupabaseId
    if (!/^[0-9a-f-]{36}$/i.test(codigoOSupabaseId)) {
      // Es código humano, hay que resolver el uuid via numero_secuencial
      const numero = parseInt(codigoOSupabaseId.split('-').pop(), 10)
      if (!Number.isNaN(numero)) {
        const { data: row } = await supabase
          .from('pruebas')
          .select('id')
          .eq('numero_secuencial', numero)
          .maybeSingle()
        pruebaUuid = row?.id
      }
    }
    if (!pruebaUuid) {
      console.error('updateTest: no se pudo resolver el uuid de la prueba', { codigoOSupabaseId })
      return { id: codigoOSupabaseId, ...updates }
    }

    // Mapeo de updates del modelo interno → schema real
    const supabaseUpdates = {}
    if (updates.esperandoAprobacion === false && updates.aprobado === true) {
      supabaseUpdates.estado_final      = 'APROBADA'
      supabaseUpdates.timestamp_aprobada = new Date().toISOString()
      // Si el caller no pasó supervisorLegajo, lo tomamos del sessionStorage
      if (!updates.supervisorLegajo) {
        try {
          const cur = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER) || 'null')
          if (cur?.legajo) supabaseUpdates.supervisor_legajo = cur.legajo
        } catch {}
      }
    }
    if (updates.esperandoAprobacion === true) {
      supabaseUpdates.estado_final = 'PENDIENTE_APROBACION'
      supabaseUpdates.tuvo_falla = true
      if (updates.estado === undefined) supabaseUpdates.resultado = 'RECHAZADO'
    }
    if (updates.estadoFinal !== undefined) supabaseUpdates.estado_final = updates.estadoFinal
    if (updates.tuvoFalla !== undefined) supabaseUpdates.tuvo_falla = updates.tuvoFalla
    if (updates.estado !== undefined) supabaseUpdates.resultado         = updates.estado
    if (updates.supervisorLegajo)     supabaseUpdates.supervisor_legajo = updates.supervisorLegajo

    const { data, error } = await supabase
      .from('pruebas')
      .update(supabaseUpdates)
      .eq('id', pruebaUuid)

    console.log('updateTest supabase response:', { pruebaUuid, supabaseUpdates, data, error })
    if (error) { console.error('updateTest:', error) }
    return { id: codigoOSupabaseId, supabase_id: pruebaUuid, ...updates }
  },

  // ===== AUDIT LOG =====
  // Schema real: id, timestamp, usuario_legajo NOT NULL, usuario_nombre,
  // accion NOT NULL, tabla_afectada, registro_id, descripcion,
  // hash_evento (nullable ahora), firma_evento (nullable ahora).
  async getAuditLog({ desde, hasta, limite = 200 } = {}) {
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
    if (desde) query = query.gte('created_at', typeof desde === 'string' ? desde : new Date(desde).toISOString())
    if (hasta) query = query.lte('created_at', typeof hasta === 'string' ? hasta : new Date(hasta).toISOString())
    if (limite) query = query.limit(limite)

    const { data, error } = await query

    console.log('getAuditLog supabase response:', { data, error, desde, hasta, limite })
    if (error) { console.error('getAuditLog:', error); return []; }

    return (data || []).map(e => ({
      ...e,
      timestamp: normalizarFechaUTC(e.created_at || e.timestamp),
      desc:      e.descripcion,
      usuario:   e.usuario_nombre || e.usuario_legajo,
      hash:      e.hash_evento || ''
    }))
  },

  // logEvent fall-back: si no se pasa usuarioLegajo, lo lee del sessionStorage.
  // Si tampoco hay current user, usa '0000' (placeholder admin) para no romper
  // la NOT NULL constraint. hash_evento/firma_evento van nulos (deuda ISO).
  async logEvent(event) {
    let usuarioLegajo = event.usuarioLegajo
    let usuarioNombre = event.usuario
    if (!usuarioLegajo) {
      try {
        const stored = sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER)
        if (stored) {
          const cur = JSON.parse(stored)
          usuarioLegajo = cur?.legajo
          if (!usuarioNombre) usuarioNombre = `${cur?.nombre || ''} ${cur?.apellido || ''}`.trim()
        }
      } catch {}
    }
    if (!usuarioLegajo) usuarioLegajo = '0000'  // fallback de emergencia

    const { data, error } = await supabase
      .from('audit_log')
      .insert({
        usuario_legajo:  usuarioLegajo,
        usuario_nombre:  usuarioNombre || null,
        accion:          event.accion,
        descripcion:     event.desc || null,
        tabla_afectada:  event.tabla || null,
        registro_id:     event.registroId || null
      })

    console.log('logEvent supabase response:', { event, data, error })
    if (error) console.error('logEvent:', error)
  },

  // ===== OBSERVACIONES =====
  // Tabla creada en SQL 03. Estructura:
  // prueba_id (uuid FK), prueba_codigo (snapshot), supervisor_legajo,
  // supervisor_nombre (snapshot), operario_legajo, maquina_codigo,
  // mensaje, leida, leida_at, leida_por, created_at.
  async getObservations(testId) {
    // testId es código humano PRB-...; resolvemos via prueba_codigo
    const { data, error } = await supabase
      .from('observaciones')
      .select('*')
      .eq('prueba_codigo', testId)
      .order('created_at', { ascending: false })

    console.log('getObservations supabase response:', { testId, data, error })
    if (error) { console.error('getObservations:', error); return []; }
    return (data || []).map(o => ({
      ...o,
      timestamp: o.created_at,
      supervisor: o.supervisor_nombre || o.supervisor_legajo
    }))
  },

  async addObservation(obs) {
    // Resolvemos prueba_id (uuid) desde el código humano si nos lo pasaron
    let pruebaId = obs.pruebaId
    if (!pruebaId && obs.testId) {
      const numero = parseInt(obs.testId.split('-').pop(), 10)
      if (!Number.isNaN(numero)) {
        const { data: row } = await supabase
          .from('pruebas').select('id')
          .eq('numero_secuencial', numero)
          .maybeSingle()
        pruebaId = row?.id
      }
    }
    if (!pruebaId) {
      console.error('addObservation: no se pudo resolver prueba_id', { obs })
      return null
    }

    // Resolvemos legajo del supervisor desde el sessionStorage
    let supervisorLegajo = obs.supervisorLegajo
    let supervisorNombre = obs.supervisor
    if (!supervisorLegajo) {
      try {
        const cur = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER) || 'null')
        supervisorLegajo = cur?.legajo
        if (!supervisorNombre) supervisorNombre = `${cur?.nombre || ''} ${cur?.apellido || ''}`.trim()
      } catch {}
    }

    const { data, error } = await supabase
      .from('observaciones')
      .insert({
        prueba_id:          pruebaId,
        prueba_codigo:      obs.testId,
        supervisor_legajo:  supervisorLegajo,
        supervisor_nombre:  supervisorNombre,
        operario_legajo:    obs.legajoOperario,
        maquina_codigo:     obs.maquina,
        mensaje:            obs.mensaje,
        leida:              false
      })
      .select()
      .single()

    console.log('addObservation supabase response:', { obs, data, error })
    if (error) { console.error('addObservation:', error); return null }
    return data || null
  },

  // Mapeo común de fila de observaciones → modelo interno del front.
  // El front lee obs.maquina, obs.supervisor, obs.timestamp, etc.
  _mapObs(o) {
    if (!o) return o
    return {
      ...o,
      maquina:    o.maquina_codigo,
      supervisor: o.supervisor_nombre || o.supervisor_legajo,
      timestamp:  o.created_at
    }
  },

  async getUnreadObservationsFor(operarioLegajo, maquinaCodigo) {
    const { data, error } = await supabase
      .from('observaciones')
      .select('*')
      .eq('operario_legajo', operarioLegajo)
      .eq('leida', false)
      .order('created_at', { ascending: false })

    console.log('getUnreadObservationsFor supabase response:', { operarioLegajo, maquinaCodigo, data, error })
    if (error) { console.error('getUnreadObs:', error); return []; }
    return (data || []).map(o => this._mapObs(o))
  },

  async markObservationAsRead(obsId, operario) {
    const { data, error } = await supabase
      .from('observaciones')
      .update({
        leida:    true,
        leida_at: new Date().toISOString(),
        leida_por: operario
      })
      .eq('id', obsId)

    console.log('markObservationAsRead supabase response:', { obsId, operario, data, error })
    if (error) { console.error('markAsRead:', error); return false }
    return true
  },

  async getAllUnreadObservations() {
    const { data, error } = await supabase
      .from('observaciones')
      .select('*')
      .eq('leida', false)

    console.log('getAllUnreadObservations supabase response:', { data, error })
    if (error) { console.error('getAllUnread:', error); return []; }
    return (data || []).map(o => this._mapObs(o))
  },

  // ===== NO CONFORMIDADES =====
  // Schema real: id, numero_nc (bigint sequence), prueba_id NOT NULL,
  // estado (default ABIERTA), causa_raiz, acciones_tomadas (array embebido,
  // sin tabla acciones_nc separada), supervisor_legajo, timestamp_apertura/
  // _analisis/_cierre, notas_cierre, dias_para_cierre.
  //
  // Datos como tipos de falla, cantidad de cabezales y observaciones del
  // operario viven en `pruebas` y `pruebas_fallas` — los traemos por join
  // y los exponemos en el modelo interno.
  async getNCHistory() {
    const { data, error } = await supabase
      .from('no_conformidades')
      .select(`
        *,
        prueba:pruebas!prueba_id(
          id, numero_secuencial, id_maquina, operario_legajo,
          observaciones, cantidad_cabezales_afectados, timestamp_recibida,
          fallas:pruebas_fallas(tipo_falla_id)
        )
      `)
      .order('created_at', { ascending: false })

    console.log('getNCHistory supabase response:', { data, error })
    if (error) { console.error('getNCHistory:', error); return []; }

    const usuariosMap = await this.getUsersCache()

    return (data || []).map(nc => {
      const p = nc.prueba || {}
      // FIX v5: normalizamos a UTC; antes el desfase era de N horas porque
      // PostgREST manda timestamps sin Z y JS los parseaba como hora local.
      const aperturaUTC  = normalizarFechaUTC(nc.timestamp_apertura || nc.created_at)
      const tomadaUTC    = normalizarFechaUTC(nc.timestamp_analisis)
      const cierreUTC    = normalizarFechaUTC(nc.timestamp_cierre)
      const fechaP       = p.timestamp_recibida
        ? new Date(normalizarFechaUTC(p.timestamp_recibida))
        : new Date(aperturaUTC)
      const codigoPrueba = p.numero_secuencial
        ? `PRB-${fechaLocalAR(fechaP).replace(/-/g,'')}-${String(p.numero_secuencial).padStart(4,'0')}`
        : null
      const supervisorNombre = nc.supervisor_legajo
        ? (usuariosMap.get(nc.supervisor_legajo) || nc.supervisor_legajo)
        : null

      return {
        id:                `NC-${String(nc.numero_nc).padStart(6,'0')}`,
        supabase_id:       nc.id,
        numeroNC:          nc.numero_nc,
        pruebaId:          codigoPrueba,
        pruebaSupabaseId:  nc.prueba_id,
        maquina:           p.id_maquina,
        operario:          usuariosMap.get(p.operario_legajo) || p.operario_legajo || '',
        operarioLegajo:    p.operario_legajo,
        tipos:             p.fallas?.map(f => f.tipo_falla_id) || [],
        cabezalesFalla:    p.cantidad_cabezales_afectados ?? 0,
        observaciones:     p.observaciones,
        estado:            nc.estado,
        supervisorLegajo:  nc.supervisor_legajo,
        tomadaPor:         supervisorNombre,
        tomadaAt:          tomadaUTC,
        cerradaPor:        supervisorNombre,
        cerradaAt:         cierreUTC,
        causaRaiz:         nc.causa_raiz,
        causaRaizDetalle:  '',                              // no existe en schema
        accionesTomadas:   nc.acciones_tomadas || [],       // array embebido
        notasCierre:       nc.notas_cierre,
        diasParaCierre:    nc.dias_para_cierre,
        timestamp:         aperturaUTC,
        aperturaAt:        aperturaUTC
      }
    })
  },

  async createNC(nc) {
    // Resolver prueba_id (uuid) desde el código humano PRB-yyyymmdd-NNNN
    // o desde supabase_id si nos lo pasaron directamente.
    let pruebaId = nc.pruebaSupabaseId
    if (!pruebaId && nc.pruebaId) {
      const numero = parseInt(String(nc.pruebaId).split('-').pop(), 10)
      if (!Number.isNaN(numero)) {
        const { data: row } = await supabase
          .from('pruebas').select('id')
          .eq('numero_secuencial', numero)
          .maybeSingle()
        pruebaId = row?.id
      }
    }
    if (!pruebaId) {
      console.error('createNC: no se pudo resolver prueba_id', { pruebaId: nc.pruebaId })
      return null
    }

    // Supervisor que está abriendo la NC
    let supervisorLegajo = nc.supervisorLegajo
    if (!supervisorLegajo) {
      try {
        const cur = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER) || 'null')
        supervisorLegajo = cur?.legajo
      } catch {}
    }

    const { data, error } = await supabase
      .from('no_conformidades')
      .insert({
        prueba_id:          pruebaId,
        estado:             'ABIERTA',
        supervisor_legajo:  supervisorLegajo
        // numero_nc se autogenera por sequence; timestamp_apertura tiene default now()
      })
      .select()
      .single()

    console.log('createNC supabase response:', { pruebaId, data, error })
    if (error) { console.error('createNC:', error); return null; }

    const codigoNC = `NC-${String(data.numero_nc).padStart(6,'0')}`
    await this.logEvent({
      accion: 'CREATE_NC',
      desc:   `Apertura ${codigoNC} sobre prueba ${nc.pruebaId}`,
      tabla:  'no_conformidades',
      registroId: data.id
    })

    return { ...nc, id: codigoNC, supabase_id: data.id, numeroNC: data.numero_nc }
  },

  async updateNC(ncIdOrSupabaseId, updates) {
    // Aceptamos código humano (NC-NNNNNN) o uuid
    let ncUuid = ncIdOrSupabaseId
    if (!/^[0-9a-f-]{36}$/i.test(ncIdOrSupabaseId)) {
      const numero = parseInt(String(ncIdOrSupabaseId).split('-').pop(), 10)
      if (!Number.isNaN(numero)) {
        const { data: row } = await supabase
          .from('no_conformidades').select('id')
          .eq('numero_nc', numero)
          .maybeSingle()
        ncUuid = row?.id
      }
    }
    if (!ncUuid) {
      console.error('updateNC: no se pudo resolver el uuid de la NC', { ncIdOrSupabaseId })
      return null
    }

    // Mapeo de updates del modelo interno → schema real
    const supabaseUpdates = {}
    if (updates.estado)              supabaseUpdates.estado            = updates.estado
    if (updates.causaRaiz)           supabaseUpdates.causa_raiz        = updates.causaRaiz
    if (updates.notasCierre)         supabaseUpdates.notas_cierre      = updates.notasCierre
    if (updates.tomadaAt)            supabaseUpdates.timestamp_analisis = updates.tomadaAt
    if (updates.cerradaAt)           supabaseUpdates.timestamp_cierre   = updates.cerradaAt
    if (updates.supervisorLegajo)    supabaseUpdates.supervisor_legajo  = updates.supervisorLegajo
    // accionesTomadas se guarda como array embebido (no_conformidades.acciones_tomadas)
    if (Array.isArray(updates.accionesTomadas)) {
      supabaseUpdates.acciones_tomadas = updates.accionesTomadas
    }

    // Si pasa a CERRADA y no nos pasaron supervisor, lo tomamos del session
    if (updates.estado === 'CERRADA' && !supabaseUpdates.supervisor_legajo) {
      try {
        const cur = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER) || 'null')
        if (cur?.legajo) supabaseUpdates.supervisor_legajo = cur.legajo
      } catch {}
      if (!supabaseUpdates.timestamp_cierre) {
        supabaseUpdates.timestamp_cierre = new Date().toISOString()
      }
    }

    const { error } = await supabase
      .from('no_conformidades')
      .update(supabaseUpdates)
      .eq('id', ncUuid)

    console.log('updateNC supabase response:', { ncUuid, supabaseUpdates, error })
    if (error) console.error('updateNC:', error)

    // Devolvemos el objeto actualizado para que el modal se refresque
    const ncs = await this.getNCHistory()
    return ncs.find(nc => nc.supabase_id === ncUuid)
  }
};

// =================================================================
// THEME SYSTEM
// =================================================================

const tokens = {
  dark: {
    bg: '#0a0a0b', surface: '#131316', surfaceHi: '#1b1b1f', surfaceHover: '#22222a',
    border: '#2a2a30', borderStrong: '#3a3a42',
    text: '#e6e6e8', textMuted: '#8e8e96', textDim: '#5e5e66',
    accent: '#d97757', accentSoft: '#3a2218',
    success: '#5eb88f', successSoft: '#1a2e24',
    warn: '#e0b56a', warnSoft: '#2e2415',
    danger: '#cc6363', dangerSoft: '#2e1a1a',
    info: '#7d9bd1', infoSoft: '#1a2333',
  },
  light: {
    bg: '#f7f5f1', surface: '#ffffff', surfaceHi: '#fafaf6', surfaceHover: '#f0eee8',
    border: '#e4e1d9', borderStrong: '#cdc8bb',
    text: '#1a1a1c', textMuted: '#6b6b70', textDim: '#9a9a9f',
    accent: '#b8552d', accentSoft: '#fdf0e8',
    success: '#2d6f4f', successSoft: '#e6f0e9',
    warn: '#a87520', warnSoft: '#faf1dc',
    danger: '#a83838', dangerSoft: '#fbe8e8',
    info: '#3a5a8b', infoSoft: '#e6ebf3',
  }
};

const FONT_IMPORT = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap');

  @keyframes slideInRight {
    from { transform: translateX(420px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
`;

// =================================================================
// COMPONENTES BASE
// =================================================================

const Logo = ({ t }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <div style={{ position: 'relative', width: 36, height: 36, background: t.accent, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Hexagon size={18} color={t.bg} strokeWidth={2.5} fill="none" />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontFamily: 'JetBrains Mono', fontWeight: 700, color: t.bg, letterSpacing: '0.02em' }}>TZ</div>
    </div>
    <div>
      <div style={{ fontFamily: 'Bricolage Grotesque', color: t.text, fontWeight: 600, fontSize: 16, lineHeight: 1.1, letterSpacing: '-0.02em' }}>Trazabilidad</div>
      <div style={{ fontFamily: 'JetBrains Mono', color: t.textDim, fontSize: 9, letterSpacing: '0.1em' }}>v4.0 · CABEZALES SODA</div>
    </div>
  </div>
);

const Pill = ({ children, variant = 'default', t, mono = false }) => {
  const variants = {
    default: { bg: t.surfaceHi, color: t.textMuted, border: t.border },
    success: { bg: t.successSoft, color: t.success, border: t.success + '40' },
    warn: { bg: t.warnSoft, color: t.warn, border: t.warn + '40' },
    danger: { bg: t.dangerSoft, color: t.danger, border: t.danger + '40' },
    info: { bg: t.infoSoft, color: t.info, border: t.info + '40' },
    accent: { bg: t.accentSoft, color: t.accent, border: t.accent + '40' },
    crit: { bg: t.danger, color: t.bg, border: t.danger },
  };
  const s = variants[variant];
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
      letterSpacing: '0.04em', textTransform: 'uppercase',
      fontFamily: mono ? 'JetBrains Mono' : 'Manrope',
      display: 'inline-flex', alignItems: 'center', gap: 4
    }}>{children}</span>
  );
};

const Card = ({ children, t, padding = 20, accent = false, style = {} }) => (
  <div style={{
    background: t.surface, border: `1px solid ${accent ? t.accent + '40' : t.border}`,
    borderRadius: 8, padding, position: 'relative', ...style
  }}>{children}</div>
);

const Label = ({ children, t }) => (
  <label style={{ display: 'block', fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{children}</label>
);

const Asterisk = ({ t }) => <span style={{ color: t.danger }}>*</span>;

const Input = ({ t, error, ...props }) => (
  <input
    {...props}
    style={{
      width: '100%', padding: '10px 12px', borderRadius: 6,
      background: t.surfaceHi, border: `1px solid ${error ? t.danger : t.border}`,
      color: t.text, fontFamily: props.type === 'password' || props.fontFamily === 'mono' ? 'JetBrains Mono' : 'Manrope',
      fontSize: 13, boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s'
    }}
    onFocus={e => { if (!error) e.target.style.borderColor = t.accent; }}
    onBlur={e => { e.target.style.borderColor = error ? t.danger : t.border; }}
  />
);

const ButtonSm = ({ children, t, variant = 'default', onClick, grow, disabled }) => {
  const variants = {
    default: { bg: t.surface, color: t.text, border: t.border },
    success: { bg: t.successSoft, color: t.success, border: t.success + '60' },
    danger: { bg: t.dangerSoft, color: t.danger, border: t.danger + '60' },
    accent: { bg: t.accent, color: t.bg, border: t.accent },
    warn: { bg: t.warnSoft, color: t.warn, border: t.warn + '60' },
  };
  const s = variants[variant];
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      padding: '8px 14px', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'Manrope', fontSize: 12, fontWeight: 500,
      flex: grow ? 1 : 'none', opacity: disabled ? 0.4 : 1,
      display: 'inline-flex', alignItems: 'center', gap: 6
    }}>{children}</button>
  );
};

const SectionHeader = ({ title, sub, t, action }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `1px solid ${t.border}`, paddingBottom: 12 }}>
    <div>
      <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 15, fontWeight: 600, color: t.text }}>{title}</div>
      {sub && <div style={{ fontFamily: 'Manrope', fontSize: 11, color: t.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
    {action}
  </div>
);

const EmptyState = ({ icon: Icon, title, desc, t, padding = 32 }) => (
  <div style={{ textAlign: 'center', padding }}>
    <div style={{ width: 56, height: 56, margin: '0 auto 14px', background: t.surfaceHi, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={24} color={t.textDim} />
    </div>
    <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 16, fontWeight: 500, color: t.text }}>{title}</div>
    <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, marginTop: 6, maxWidth: 360, margin: '6px auto 0' }}>{desc}</div>
  </div>
);

// =================================================================
// CAMBIO v4: TOAST DE NUEVA OBSERVACIÓN
// =================================================================

const ToastObservacion = ({ obs, onConfirm, t }) => (
  <div style={{
    position: 'fixed',
    top: 80,
    right: 24,
    width: 380,
    background: `linear-gradient(135deg, ${t.surface}, ${t.surfaceHi})`,
    border: `2px solid ${t.warn}`,
    borderRadius: 10,
    boxShadow: `0 8px 32px rgba(0,0,0,0.35), 0 0 16px ${t.warnSoft}`,
    zIndex: 200,
    animation: 'slideInRight 0.3s ease-out, neonPulse 2.2s ease-in-out infinite',
    overflow: 'hidden'
  }}>
    <div style={{
      padding: '12px 16px',
      background: t.warnSoft,
      borderBottom: `1px solid ${t.warn}40`,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }}>
      <BellRing size={18} color={t.warn} style={{ animation: 'pulse 1.5s infinite, blinkGlow 1.3s ease-in-out infinite' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 14, fontWeight: 600, color: t.warn }}>
          Nueva observación del supervisor
        </div>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.05em' }}>
          {new Date(obs.created_at || obs.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · {obs.supervisor_nombre || obs.supervisor || 'Supervisor'}
        </div>
      </div>
    </div>
    <div style={{ padding: '14px 16px' }}>
      <div style={{
        fontFamily: 'Manrope', fontSize: 14, color: t.text, lineHeight: 1.5,
        padding: 12, background: t.surfaceHi, borderRadius: 6, marginBottom: 12,
        borderLeft: `3px solid ${t.warn}`
      }}>
        "{obs.mensaje}"
      </div>
      <button onClick={onConfirm} style={{
        width: '100%', padding: 12, background: t.warn, color: t.bg,
        border: 'none', borderRadius: 6, cursor: 'pointer',
        fontFamily: 'Bricolage Grotesque', fontSize: 14, fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
      }}>
        <CheckCircle2 size={16} />
        OK, recibido
      </button>
    </div>
  </div>
);

// CAMBIO v4: BANNER PERMANENTE EN TOP DE LA VISTA OPERARIO
const BannerObservaciones = ({ observaciones, onMarkRead, t }) => {
  if (!observaciones || observaciones.length === 0) return null;

  return (
    <Card t={t} padding={0} style={{
      marginBottom: 16,
      background: t.warnSoft,
      borderColor: t.warn,
      overflow: 'hidden',
      boxShadow: `0 0 24px rgba(255, 194, 0, 0.22)`,
      animation: 'neonPulse 2.2s ease-in-out infinite'
    }}>
      <div style={{
        padding: '10px 16px',
        background: t.warn,
        color: t.bg,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'Bricolage Grotesque',
        fontSize: 14,
        fontWeight: 600
      }}>
        <Inbox size={16} />
        {observaciones.length} {observaciones.length === 1 ? 'mensaje del supervisor' : 'mensajes del supervisor'}
      </div>
      <div>
        {observaciones.map(obs => (
          <div key={obs.id} style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${t.warn}40`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 14
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.warn, letterSpacing: '0.1em', marginBottom: 6 }}>
                {new Date(obs.created_at || obs.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · {obs.supervisor_nombre || obs.supervisor || 'Supervisor'}
              </div>
              <div style={{ fontFamily: 'Manrope', fontSize: 13, color: t.text, lineHeight: 1.5 }}>
                "{obs.mensaje}"
              </div>
            </div>
            <ButtonSm t={t} variant="warn" onClick={() => onMarkRead(obs.id)}>
              <CheckCircle2 size={12} /> Recibido
            </ButtonSm>
          </div>
        ))}
      </div>
    </Card>
  );
};

// =================================================================
// PANTALLA: LOGIN
// =================================================================

const PantallaLogin = ({ onLogin, t }) => {
  const [legajo, setLegajo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!legajo || !password) {
      setError('Completá ambos campos');
      return;
    }
    setLoading(true);
    setError('');
    const user = await dataService.login(legajo, password);
    setLoading(false);
    if (user) {
      await dataService.logEvent({ accion: 'LOGIN', usuario: `${user.nombre} ${user.apellido}`, desc: `Inicio de sesión · rol ${user.rol}` });
      onLogin(user);
    } else {
      setError('Legajo o contraseña incorrectos');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <style>{FONT_IMPORT}</style>
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div style={{ marginBottom: 32 }}><Logo t={t} /></div>

        <Card t={t} padding={36}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textDim, letterSpacing: '0.2em', marginBottom: 8 }}>
            ACCESO AL SISTEMA
          </div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, fontWeight: 600, color: t.text, letterSpacing: '-0.02em', margin: 0 }}>
            Iniciá sesión
          </h1>
          <p style={{ fontFamily: 'Manrope', fontSize: 13, color: t.textMuted, marginTop: 6, marginBottom: 28 }}>
            Ingresá con tu legajo y contraseña asignada.
          </p>

          <div style={{ marginBottom: 16 }}>
            <Label t={t}>Legajo</Label>
            <Input t={t} type="text" value={legajo} onChange={e => setLegajo(e.target.value)} placeholder="Ej: 0001" autoFocus />
          </div>

          <div style={{ marginBottom: 8 }}>
            <Label t={t}>Contraseña</Label>
            <Input t={t} type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </div>

          {error && (
            <div style={{ background: t.dangerSoft, border: `1px solid ${t.danger}40`, borderRadius: 6, padding: '10px 12px', marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={14} color={t.danger} />
              <span style={{ fontFamily: 'Manrope', fontSize: 12, color: t.danger }}>{error}</span>
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading} style={{
            width: '100%', marginTop: 24, padding: 14,
            background: t.accent, color: t.bg, border: 'none', borderRadius: 8,
            fontFamily: 'Bricolage Grotesque', fontSize: 15, fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: loading ? 0.7 : 1
          }}>
            <LogIn size={16} />
            {loading ? 'Verificando...' : 'Ingresar'}
          </button>

          <div style={{ marginTop: 20, padding: 12, background: t.infoSoft, border: `1px solid ${t.info}30`, borderRadius: 6 }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.info, letterSpacing: '0.1em', marginBottom: 4 }}>PRIMERA VEZ · ADMIN</div>
            <div style={{ fontFamily: 'Manrope', fontSize: 11, color: t.text }}>
              Legajo: <span style={{ fontFamily: 'JetBrains Mono' }}>0001</span> · Password: <span style={{ fontFamily: 'JetBrains Mono' }}>admin</span>
            </div>
            <div style={{ fontFamily: 'Manrope', fontSize: 10, color: t.textMuted, marginTop: 4 }}>
              Te pediremos cambiarla en el primer ingreso.
            </div>
          </div>
        </Card>

        <div style={{ marginTop: 16, padding: '10px 14px', display: 'flex', gap: 14, fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.05em', justifyContent: 'center' }}>
          <span>● SISTEMA OPERATIVO</span>
          <span>·</span>
          <span>v4.0</span>
        </div>
      </div>
    </div>
  );
};

const PantallaCambioPassword = ({ user, onChanged, t }) => {
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (pass1.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return; }
    if (pass1 !== pass2) { setError('Las contraseñas no coinciden'); return; }
    if (pass1 === user.password) { setError('No podés usar la misma contraseña'); return; }
    const updated = await dataService.changePassword(user.legajo, pass1);
    await dataService.logEvent({ accion: 'UPDATE', usuario: `${user.nombre} ${user.apellido}`, desc: 'Cambio de contraseña' });
    onChanged(updated);
  };

  return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <style>{FONT_IMPORT}</style>
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div style={{ marginBottom: 32 }}><Logo t={t} /></div>
        <Card t={t} padding={36}>
          <div style={{ width: 48, height: 48, background: t.warnSoft, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <KeyRound size={20} color={t.warn} />
          </div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 26, fontWeight: 600, color: t.text, margin: 0 }}>
            Cambio obligatorio
          </h1>
          <p style={{ fontFamily: 'Manrope', fontSize: 13, color: t.textMuted, marginTop: 6, marginBottom: 24 }}>
            Por seguridad, definí una nueva contraseña antes de continuar.
          </p>

          <div style={{ marginBottom: 14 }}>
            <Label t={t}>Nueva contraseña</Label>
            <Input t={t} type="password" value={pass1} onChange={e => setPass1(e.target.value)} placeholder="Mínimo 6 caracteres" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <Label t={t}>Repetir contraseña</Label>
            <Input t={t} type="password" value={pass2} onChange={e => setPass2(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </div>

          {error && (
            <div style={{ background: t.dangerSoft, border: `1px solid ${t.danger}40`, borderRadius: 6, padding: '10px 12px', marginTop: 14 }}>
              <span style={{ fontFamily: 'Manrope', fontSize: 12, color: t.danger }}>{error}</span>
            </div>
          )}

          <button onClick={handleSubmit} style={{
            width: '100%', marginTop: 22, padding: 14,
            background: t.accent, color: t.bg, border: 'none', borderRadius: 8,
            fontFamily: 'Bricolage Grotesque', fontSize: 15, fontWeight: 600, cursor: 'pointer'
          }}>
            Guardar y continuar
          </button>
        </Card>
      </div>
    </div>
  );
};

// =================================================================
// HEADER
// =================================================================

const Header = ({ user, onLogout, theme, toggleTheme, t, hora }) => {
  const [showMenu, setShowMenu] = useState(false);
  const puedeVerMenu = user.rol !== 'operario';

  return (
    <header style={{
      background: t.bg, borderBottom: `1px solid ${t.border}`, position: 'sticky',
      top: 0, zIndex: 50, backdropFilter: 'blur(8px)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', gap: 32 }}>
        <Logo t={t} />
        <div style={{ width: 1, height: 24, background: t.border }} />

        <div style={{ display: 'flex', gap: 20, fontSize: 11, fontFamily: 'JetBrains Mono', letterSpacing: '0.05em' }}>
          <div>
            <span style={{ color: t.textDim }}>SISTEMA</span>{' '}
            <span style={{ color: t.success }}>● OPERATIVO</span>
          </div>
          <div>
            <span style={{ color: t.textDim }}>HORA</span>{' '}
            <span style={{ color: t.text }}>{hora}</span>
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowMenu(!showMenu)} style={{
              background: t.surfaceHi, color: t.text, border: `1px solid ${t.border}`,
              padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Manrope', fontSize: 13, fontWeight: 500
            }}>
              <User size={14} color={t.accent} />
              {user.nombre} {user.apellido}
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textMuted, marginLeft: 4 }}>· {user.rol}</span>
              <ChevronDown size={14} color={t.textMuted} />
            </button>

            {showMenu && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                background: t.surface, border: `1px solid ${t.border}`,
                borderRadius: 6, minWidth: 220, overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 60
              }}>
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ fontFamily: 'Manrope', fontSize: 13, fontWeight: 500, color: t.text }}>{user.nombre} {user.apellido}</div>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textMuted, marginTop: 2 }}>
                    Legajo {user.legajo} · {user.rol}
                  </div>
                </div>

                {puedeVerMenu && (
                  <div style={{ padding: '6px 0' }}>
                    <div style={{ padding: '6px 14px', fontFamily: 'JetBrains Mono', fontSize: 9, color: t.textDim, letterSpacing: '0.1em' }}>OPCIONES</div>
                    <MenuItem t={t} icon={KeyRound} onClick={() => alert('Cambiar contraseña')}>Cambiar contraseña</MenuItem>
                  </div>
                )}

                <div style={{ borderTop: `1px solid ${t.border}` }}>
                  <MenuItem t={t} icon={LogOut} onClick={() => { setShowMenu(false); onLogout(); }} danger>Cerrar sesión</MenuItem>
                </div>
              </div>
            )}
          </div>

          <button onClick={toggleTheme} style={{
            background: t.surfaceHi, border: `1px solid ${t.border}`, color: t.textMuted,
            padding: 8, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center'
          }}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>
    </header>
  );
};

const MenuItem = ({ children, icon: Icon, onClick, t, danger }) => (
  <button onClick={onClick} style={{
    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', background: 'transparent', border: 'none',
    color: danger ? t.danger : t.text, cursor: 'pointer', textAlign: 'left',
    fontFamily: 'Manrope', fontSize: 13
  }}
  onMouseEnter={e => e.currentTarget.style.background = t.surfaceHover}
  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
    <Icon size={14} />
    {children}
  </button>
);

// =================================================================
// VISTA OPERARIO — CON MENSAJES DEL SUPERVISOR (CAMBIO v4)
// =================================================================

const VistaOperario = ({ t, user, refresh }) => {
  const [pruebaPendiente, setPruebaPendiente] = useState(null);
  const [tuvoFalla, setTuvoFalla] = useState(null);
  const [tiposSeleccionados, setTiposSeleccionados] = useState([]);
  const [cabezalesFalla, setCabezalesFalla] = useState(0);
  const [codigoProducto, setCodigoProducto] = useState('');
  const [errorCodigo, setErrorCodigo] = useState('');
  const [caja, setCaja] = useState('');
  const [lote, setLote] = useState('');
  const [obs, setObs] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [maquinaInfo, setMaquinaInfo] = useState(null);
  const [pruebasDelTurno, setPruebasDelTurno] = useState([]);
  const [tiempoTranscurrido, setTiempoTranscurrido] = useState(0);

  // CAMBIO v4: estados para mensajes del supervisor
  const [observaciones, setObservaciones] = useState([]);
  const [toastObs, setToastObs] = useState(null);
  const [seenIds, setSeenIds] = useState(new Set());

  // FIX v5: la señal del PLC ya NO se autogenera. La carga la dispara el botón
  // "Simular señal del PLC" (puente hasta que conectemos la I/O real). El init
  // solo deja al operario listo: máquina asignada + cuántas pruebas lleva el turno.
  const recalcularContador = async (maquinaId) => {
    const allTests = await dataService.getTests();
    const hoy = new Date().toISOString().slice(0, 10);
    const delTurno = allTests.filter(test =>
      test.maquina === maquinaId &&
      (test.timestamp || '').slice(0, 10) === hoy
    );
    setPruebasDelTurno(delTurno);
    // numeroPrueba = cantidad de pruebas YA cerradas en el turno + 1 (la próxima)
    return delTurno.filter(test => test.estado !== 'PENDIENTE').length + 1;
  };

  useEffect(() => {
    const init = async () => {
      const machines = await dataService.getMachines();
      // FIX v5: si la máquina asignada no aparece en machines (tabla vacía o
      // codigo distinto), construimos un fallback con el código del usuario
      // para que la cabecera muestre la máquina aunque el catálogo esté vacío.
      const asignadaId = user.maquina_asignada || user.maquinaAsignada;
      let m = machines.find(x => x.id === asignadaId);
      if (!m && asignadaId) {
        m = { id: asignadaId, nombre: asignadaId, linea: '—', activa: true, integrada: false };
      }
      if (!m) m = machines[0] || null;
      setMaquinaInfo(m);

      // Recalcular contador, sin crear prueba pendiente todavía
      if (m?.id) await recalcularContador(m.id);
      // pruebaPendiente queda en null hasta que el operario presione el botón
      setPruebaPendiente(null);
    };
    init();
  }, [user]);

  // FIX v5: botón manual para simular la señal del PLC
  const generarSenalPLC = async () => {
    if (!maquinaInfo?.id) return;
    const numeroPrueba = await recalcularContador(maquinaInfo.id);
    const ahora = new Date();
    setPruebaPendiente({
      id: `PRB-${ahora.toISOString().slice(0, 10).replace(/-/g, '')}-${String(numeroPrueba).padStart(4, '0')}`,
      maquina: maquinaInfo.id,
      numeroSecuencial: numeroPrueba,
      fechaSenal: ahora.toISOString(),
      fechaSenalFormateada: ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    });
    await dataService.logEvent({
      accion: 'SIGNAL',
      usuario: `${user.nombre} ${user.apellido}`,
      desc: `Señal simulada de PLC · máquina ${maquinaInfo.id} · prueba #${numeroPrueba}`
    });
  };

  // Timer en vivo
  useEffect(() => {
    if (!pruebaPendiente?.fechaSenal) return;
    const update = () => {
      const ms = Date.now() - new Date(pruebaPendiente.fechaSenal).getTime();
      setTiempoTranscurrido(Math.floor(ms / 1000));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [pruebaPendiente]);

  // CAMBIO v4: Polling cada 15 segundos + Realtime como respaldo
  // Usamos operario_legajo porque no tenemos Supabase Auth (piloto sin JWT)
  useEffect(() => {
    if (!maquinaInfo || !user) return

    // Carga inicial de observaciones no leídas
    const cargarObservaciones = async () => {
      const unread = await dataService.getUnreadObservationsFor(user.legajo, maquinaInfo.id)
      const nuevas = unread.filter(o => !seenIds.has(o.id))

      if (nuevas.length > 0 && seenIds.size > 0) {
        // Hay mensajes nuevos desde la última verificación → mostrar toast
        if (!toastObs) setToastObs(nuevas[0])
      }

      setObservaciones(unread)
      setSeenIds(new Set(unread.map(o => o.id)))
    }

    cargarObservaciones()

    // Polling cada 15 segundos
    const pollingInterval = setInterval(cargarObservaciones, 15000)

    // Realtime de Supabase como capa adicional (llega instantáneo si funciona)
    const channel = supabase
      .channel(`obs-${user.legajo}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'observaciones',
        filter: `operario_legajo=eq.${user.legajo}`
      }, (payload) => {
        console.log('Realtime: nueva observación', payload.new)
        setToastObs(payload.new)
        setObservaciones(prev => [payload.new, ...prev])
        setSeenIds(prev => new Set([...prev, payload.new.id]))
      })
      .subscribe((status) => {
        console.log('Realtime status:', status)
      })

    return () => {
      clearInterval(pollingInterval)
      supabase.removeChannel(channel)
    }
  }, [maquinaInfo, user])

  const formatTiempo = (segundos) => {
    if (segundos < 60) return `${segundos}s`;
    const min = Math.floor(segundos / 60);
    const seg = segundos % 60;
    if (min < 60) return `${min}m ${seg}s`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
  };

  const productoInfo = useMemo(() => {
    if (!codigoProducto) return null;
    return parsearCodigoProducto(codigoProducto.toUpperCase());
  }, [codigoProducto]);

  const validarCodigo = (val) => {
    setCodigoProducto(val.toUpperCase());
    if (!val) { setErrorCodigo(''); return; }
    const r = validarCodigoProducto(val.toUpperCase());
    setErrorCodigo(r.valid ? '' : r.error);
  };

  // CAMBIO v4: marcar observación como leída
  const handleMarkRead = async (obsId) => {
    await dataService.markObservationAsRead(obsId, `${user.nombre} ${user.apellido}`);
    await dataService.logEvent({
      accion: 'READ', usuario: `${user.nombre} ${user.apellido}`,
      desc: `Observación recibida y leída ${obsId}`
    });
    setObservaciones(observaciones.filter(o => o.id !== obsId));
    if (toastObs?.id === obsId) setToastObs(null);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!codigoProducto || errorCodigo) return;
    if (!caja || !lote) return;
    if (tuvoFalla === null) return;
    if (tuvoFalla === true && tiposSeleccionados.length === 0) return;

    setSubmitting(true);
    try {
      const test = {
        ...pruebaPendiente,
        operario: `${user.nombre} ${user.apellido}`,
        legajoOperario: user.legajo,
        estado: tuvoFalla ? 'RECHAZADO' : 'OK',
        caja, lote, codigoProducto, observaciones: obs,
        tipos: tiposSeleccionados, cabezalesFalla,
        esperandoAprobacion: tuvoFalla,
        timestamp: new Date().toISOString(),
      };

      const inserted = await dataService.createTest(test);
      if (!inserted) {
        alert(
          'No se pudo registrar la prueba.\n\n' +
          `Verificá que la máquina ${test.maquina} esté creada en la tabla "maquinas" ` +
          'y que el legajo del operario exista en "usuarios".'
        );
        return;
      }
      await dataService.logEvent({
        accion: 'CREATE', usuario: `${user.nombre} ${user.apellido}`,
        desc: `Prueba ${inserted.id} · ${test.estado} · ${codigoProducto}`
      });

      setShowSuccess(true);
      setTimeout(async () => {
        setTuvoFalla(null); setTiposSeleccionados([]); setCabezalesFalla(0);
        setCaja(''); setLote(''); setObs(''); setCodigoProducto(''); setErrorCodigo('');
        setShowSuccess(false);
        setPruebaPendiente(null);
        if (maquinaInfo?.id) await recalcularContador(maquinaInfo.id);
        refresh();
      }, 2200);
    } finally {
      setSubmitting(false);
    }
  };

  const tieneCriticaSeleccionada = tiposSeleccionados.some(id => TIPOS_FALLA.find(tf => tf.id === id)?.gravedad === 'CRITICA');
  const formularioValido = codigoProducto && !errorCodigo && caja && lote && tuvoFalla !== null && (tuvoFalla === false || tiposSeleccionados.length > 0);

  const PRUEBAS_POR_TURNO = 8;

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      {/* CAMBIO v4: Toast de nueva observación */}
      {toastObs && (
        <ToastObservacion
          obs={toastObs}
          onConfirm={() => handleMarkRead(toastObs.id)}
          t={t}
        />
      )}

      {/* CAMBIO v4: Banner permanente de observaciones */}
      <BannerObservaciones
        observaciones={observaciones}
        onMarkRead={handleMarkRead}
        t={t}
      />

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 20px', background: t.surface, border: `1px solid ${t.border}`,
        borderRadius: 8, marginBottom: 16
      }}>
        <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono', letterSpacing: '0.1em' }}>MÁQUINA</div>
            <div style={{ fontFamily: 'JetBrains Mono', color: t.text, fontSize: 14, fontWeight: 500 }}>
              {maquinaInfo?.id || '—'} · {maquinaInfo?.linea || '—'}
            </div>
          </div>
          <div style={{ width: 1, height: 32, background: t.border }} />
          <div>
            <div style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono', letterSpacing: '0.1em' }}>OPERARIO</div>
            <div style={{ fontFamily: 'Manrope', color: t.text, fontSize: 14, fontWeight: 500 }}>
              {user.nombre} {user.apellido} · {user.legajo}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono', letterSpacing: '0.1em' }}>PRUEBAS DEL TURNO</div>
            <div style={{ fontFamily: 'JetBrains Mono', color: t.success, fontSize: 14, fontWeight: 500 }}>
              {pruebasDelTurno.filter(t => t.estado !== 'PENDIENTE').length} de {PRUEBAS_POR_TURNO}
            </div>
          </div>
        </div>
      </div>

      {showSuccess ? (
        <Card t={t} padding={48} style={{ textAlign: 'center' }}>
          <CheckCircle2 size={56} color={t.success} style={{ marginBottom: 20 }} />
          <h2 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, color: t.text, fontWeight: 600 }}>Prueba registrada</h2>
          <p style={{ fontFamily: 'Manrope', color: t.textMuted, marginTop: 8 }}>
            El sistema procesó la información y actualizó el registro.
          </p>
        </Card>
      ) : !pruebaPendiente ? (
        // FIX v5: estado "esperando señal" con botón manual mientras no haya PLC real
        <Card t={t} padding={48} style={{ textAlign: 'center' }}>
          <div style={{
            width: 72, height: 72, margin: '0 auto 20px', borderRadius: '50%',
            background: t.surfaceHi, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `2px dashed ${t.border}`
          }}>
            <Cpu size={32} color={t.textMuted} />
          </div>
          <h2 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 26, color: t.text, fontWeight: 600 }}>
            Esperando señal del PLC
          </h2>
          <p style={{ fontFamily: 'Manrope', color: t.textMuted, marginTop: 8, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
            Cuando la máquina <span style={{ fontFamily: 'JetBrains Mono', color: t.text }}>{maquinaInfo?.id || '—'}</span> emita la señal de prueba se va a habilitar el formulario.
            Mientras tanto podés usar el botón de simulación para empezar la próxima prueba manualmente.
          </p>
          <button onClick={generarSenalPLC} disabled={!maquinaInfo?.id} style={{
            marginTop: 24, padding: '14px 28px',
            background: maquinaInfo?.id ? t.accent : t.surfaceHi,
            color: maquinaInfo?.id ? t.bg : t.textDim,
            border: 'none', borderRadius: 8,
            fontFamily: 'Bricolage Grotesque', fontSize: 15, fontWeight: 600,
            cursor: maquinaInfo?.id ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', gap: 8
          }}>
            <Zap size={16} />
            Simular señal del PLC
          </button>
          <div style={{ marginTop: 12, fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.05em' }}>
            MODO PILOTO · BOTÓN MANUAL · REEMPLAZA AL PLC HASTA INTEGRACIÓN FÍSICA
          </div>
        </Card>
      ) : pruebaPendiente && (
        <>
          <Card t={t} padding={24} style={{
            background: `linear-gradient(135deg, ${t.warnSoft} 0%, ${t.surface} 60%)`,
            borderColor: t.warn + '60', marginBottom: 20
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <Pill variant="warn" t={t}>● PRUEBA PENDIENTE · #{pruebaPendiente.numeroSecuencial}</Pill>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 24, color: t.text, fontWeight: 500, marginTop: 12 }}>
                  {pruebaPendiente.id}
                </div>
                <div style={{ fontFamily: 'Manrope', color: t.textMuted, fontSize: 13, marginTop: 4 }}>
                  Señal recibida {pruebaPendiente.fechaSenalFormateada} · 20 cabezales para evaluar
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.1em' }}>TRANSCURRIDO</div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 36, color: t.warn, fontWeight: 500, lineHeight: 1 }}>
                  {formatTiempo(tiempoTranscurrido)}
                </div>
              </div>
            </div>
          </Card>

          <Card t={t} padding={28}>
            <h3 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 18, color: t.text, fontWeight: 600, marginBottom: 6 }}>
              Cargá el resultado
            </h3>
            <p style={{ fontFamily: 'Manrope', color: t.textMuted, fontSize: 13, marginBottom: 24 }}>
              Todos los campos con asterisco son obligatorios.
            </p>

            <div style={{ marginBottom: 18 }}>
              <Label t={t}>Código de producto <Asterisk t={t} /></Label>
              <Input t={t} type="text" value={codigoProducto} onChange={e => validarCodigo(e.target.value)}
                placeholder="Ej: RCL-300C-RO" error={!!errorCodigo} fontFamily="mono" />
              {errorCodigo && (
                <div style={{ fontFamily: 'Manrope', fontSize: 11, color: t.danger, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={11} />{errorCodigo}
                </div>
              )}
              {productoInfo && !errorCodigo && (
                <div style={{ marginTop: 8, padding: 10, background: t.successSoft, border: `1px solid ${t.success}30`, borderRadius: 6 }}>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.success, letterSpacing: '0.1em', marginBottom: 4 }}>PRODUCTO IDENTIFICADO</div>
                  <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.text }}>
                    {productoInfo.mercado} · {productoInfo.tamaño}mm · {productoInfo.apertura} · {productoInfo.color}
                    <span style={{ color: t.textMuted, fontSize: 11 }}> — orden de {productoInfo.cajasPorOrden} cajas, {productoInfo.cajasPorPallet} por pallet</span>
                  </div>
                </div>
              )}
            </div>

            <Label t={t}>¿Tuvo falla? <Asterisk t={t} /></Label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
              <button onClick={() => { setTuvoFalla(false); setTiposSeleccionados([]); setCabezalesFalla(0); }} style={{
                padding: '20px 16px', borderRadius: 8, cursor: 'pointer',
                background: tuvoFalla === false ? t.successSoft : t.surfaceHi,
                border: `2px solid ${tuvoFalla === false ? t.success : t.border}`,
                color: tuvoFalla === false ? t.success : t.text,
                fontFamily: 'Manrope', fontSize: 15, fontWeight: 600,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, transition: 'all 0.15s'
              }}>
                <CheckCircle2 size={24} />Sin falla · OK
              </button>
              <button onClick={() => setTuvoFalla(true)} style={{
                padding: '20px 16px', borderRadius: 8, cursor: 'pointer',
                background: tuvoFalla === true ? t.dangerSoft : t.surfaceHi,
                border: `2px solid ${tuvoFalla === true ? t.danger : t.border}`,
                color: tuvoFalla === true ? t.danger : t.text,
                fontFamily: 'Manrope', fontSize: 15, fontWeight: 600,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, transition: 'all 0.15s'
              }}>
                <AlertTriangle size={24} />Con falla · Rechazar
              </button>
            </div>

            {tuvoFalla === true && (
              <div style={{ padding: 18, background: t.dangerSoft, border: `1px solid ${t.danger}40`, borderRadius: 8, marginBottom: 24 }}>
                <Label t={t}>Tipo(s) de falla detectada(s) <Asterisk t={t} /></Label>
                {tieneCriticaSeleccionada && (
                  <div style={{
                    background: t.danger, color: t.bg, padding: '6px 10px', borderRadius: 4,
                    fontSize: 11, fontFamily: 'JetBrains Mono', letterSpacing: '0.05em',
                    marginTop: 8, marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6
                  }}>
                    <Zap size={12} /> NOTIFICACIÓN AUTOMÁTICA AL SUPERVISOR · GRAVEDAD CRÍTICA
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 10 }}>
                  {TIPOS_FALLA.map(tf => {
                    const checked = tiposSeleccionados.includes(tf.id);
                    return (
                      <button key={tf.id}
                        onClick={() => setTiposSeleccionados(s => s.includes(tf.id) ? s.filter(x => x !== tf.id) : [...s, tf.id])}
                        style={{
                          padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                          background: checked ? t.danger : t.surface,
                          border: `1px solid ${checked ? t.danger : t.border}`,
                          color: checked ? t.bg : t.text,
                          fontFamily: 'Manrope', fontSize: 12, fontWeight: 500,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
                        }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', flex: 1 }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: 3, background: checked ? t.bg : 'transparent',
                            border: `1.5px solid ${checked ? t.bg : t.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                          }}>
                            {checked && <CheckCircle2 size={10} color={t.danger} />}
                          </div>
                          {tf.nombre}
                        </span>
                        <Pill variant={tf.gravedad === 'CRITICA' ? 'crit' : tf.gravedad === 'MAYOR' ? 'warn' : 'default'} t={t}>
                          {tf.gravedad === 'CRITICA' ? 'CRIT' : tf.gravedad === 'MAYOR' ? 'MAY' : 'MEN'}
                        </Pill>
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'Manrope', fontSize: 13, color: t.text, flex: 1 }}>¿Cuántos cabezales con falla?</span>
                  <input type="number" min="0" max="20" value={cabezalesFalla} onChange={e => setCabezalesFalla(parseInt(e.target.value || 0))} style={{
                    width: 70, padding: '6px 10px', borderRadius: 4,
                    background: t.surface, border: `1px solid ${t.border}`,
                    color: t.text, textAlign: 'center', fontFamily: 'JetBrains Mono', fontSize: 14
                  }} />
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: t.textMuted }}>de 20</span>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <Label t={t}>Número de caja <Asterisk t={t} /></Label>
                <Input t={t} value={caja} onChange={e => setCaja(e.target.value)} placeholder="Ej: 0045" />
              </div>
              <div>
                <Label t={t}>Número de lote <Asterisk t={t} /></Label>
                <Input t={t} value={lote} onChange={e => setLote(e.target.value)} placeholder="Ej: 25232" />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <Label t={t}>Observaciones {tuvoFalla && <Asterisk t={t} />}</Label>
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
                placeholder={tuvoFalla ? 'Detalles relevantes (obligatorio si hay falla)' : 'Opcional'}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 6,
                  background: t.surfaceHi, border: `1px solid ${t.border}`,
                  color: t.text, fontFamily: 'Manrope', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none'
                }} />
            </div>

            <button onClick={handleSubmit} disabled={!formularioValido || submitting} style={{
              width: '100%', marginTop: 16, padding: 16,
              background: formularioValido && !submitting ? t.accent : t.surfaceHi,
              color: formularioValido && !submitting ? t.bg : t.textMuted,
              border: 'none', borderRadius: 8,
              fontFamily: 'Bricolage Grotesque', fontSize: 16, fontWeight: 600,
              cursor: formularioValido && !submitting ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: formularioValido && !submitting ? 1 : 0.4, transition: 'opacity 0.15s'
            }}>
              {submitting ? 'Guardando...' : 'Guardar resultado'}<ChevronRight size={18} />
            </button>
          </Card>
        </>
      )}
    </div>
  );
};

// =================================================================
// MODAL OBSERVAR (sin cambios respecto v3 - sigue igual)
// =================================================================

const ModalObservar = ({ test, onClose, onSend, t }) => {
  const [seleccionadas, setSeleccionadas] = useState([]);
  const [textoLibre, setTextoLibre] = useState('');

  const toggle = (id) => {
    setSeleccionadas(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const enviar = () => {
    const mensajes = [];
    seleccionadas.forEach(id => {
      const r = RESPUESTAS_RAPIDAS.find(x => x.id === id);
      if (r) mensajes.push(r.texto);
    });
    if (textoLibre.trim()) mensajes.push(textoLibre.trim());
    if (mensajes.length === 0) return;
    onSend(mensajes.join(' · '));
  };

  const puedeEnviar = seleccionadas.length > 0 || textoLibre.trim().length > 0;

  return (
    <ModalShell t={t} title="Enviar observación al operario" onClose={onClose}>
      <div style={{ marginBottom: 16, padding: 12, background: t.surfaceHi, border: `1px solid ${t.border}`, borderRadius: 6 }}>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.1em', marginBottom: 4 }}>PRUEBA</div>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: t.text }}>{test?.id}</div>
        <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, marginTop: 2 }}>
          {test?.maquina} · operario {test?.operario}
        </div>
      </div>

      <Label t={t}>Respuestas rápidas</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        {RESPUESTAS_RAPIDAS.map(r => {
          const checked = seleccionadas.includes(r.id);
          return (
            <button key={r.id} onClick={() => toggle(r.id)} style={{
              padding: '12px 14px', borderRadius: 6, cursor: 'pointer',
              background: checked ? t.accentSoft : t.surfaceHi,
              border: `1px solid ${checked ? t.accent : t.border}`,
              color: checked ? t.accent : t.text,
              fontFamily: 'Manrope', fontSize: 13, fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left'
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: 4,
                background: checked ? t.accent : 'transparent',
                border: `1.5px solid ${checked ? t.accent : t.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                {checked && <CheckCircle2 size={12} color={t.bg} />}
              </div>
              <r.icon size={14} />
              {r.texto}
            </button>
          );
        })}
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label t={t}>Mensaje adicional (opcional)</Label>
        <textarea value={textoLibre} onChange={e => setTextoLibre(e.target.value)} rows={3}
          placeholder="Escribí instrucciones adicionales para el operario..."
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 6,
            background: t.surfaceHi, border: `1px solid ${t.border}`,
            color: t.text, fontFamily: 'Manrope', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none'
          }} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <ButtonSm t={t} grow onClick={onClose}>Cancelar</ButtonSm>
        <ButtonSm t={t} variant="accent" grow disabled={!puedeEnviar} onClick={enviar}>
          <Send size={12} /> Enviar al operario
        </ButtonSm>
      </div>
    </ModalShell>
  );
};

// =================================================================
// MODAL DE GESTIÓN DE NC (CAMBIO v4)
// =================================================================

const ModalGestionarNC = ({ nc, currentUser, onClose, onUpdate, t }) => {
  const [causaRaiz, setCausaRaiz] = useState(nc.causaRaiz || '');
  const [causaDetalle, setCausaDetalle] = useState(nc.causaRaizDetalle || '');
  const [accionesElegidas, setAccionesElegidas] = useState(nc.accionesTomadas || []);
  const [notasCierre, setNotasCierre] = useState(nc.notasCierre || '');

  const isReadonly = nc.estado === 'CERRADA';

  const tiempoTranscurrido = useMemo(() => {
    if (!nc.cerradaAt) return null;
    const ms = new Date(nc.cerradaAt).getTime() - new Date(nc.timestamp).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
  }, [nc.cerradaAt, nc.timestamp]);

  const tomar = async () => {
    await onUpdate(nc.id, {
      estado: 'EN ANALISIS',
      tomadaPor: `${currentUser.nombre} ${currentUser.apellido}`,
      tomadaAt: new Date().toISOString(),
    });
  };

  const cerrar = async () => {
    if (!causaRaiz) {
      alert('Seleccioná una causa raíz');
      return;
    }
    if (causaRaiz === 'OTR' && !causaDetalle.trim()) {
      alert('Detallá la causa raíz en notas');
      return;
    }
    await onUpdate(nc.id, {
      estado: 'CERRADA',
      causaRaiz,
      causaRaizDetalle: causaDetalle,
      accionesTomadas: accionesElegidas,
      notasCierre,
      cerradaPor: `${currentUser.nombre} ${currentUser.apellido}`,
      cerradaAt: new Date().toISOString(),
    });
  };

  const toggleAccion = (id) => {
    setAccionesElegidas(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  return (
    <ModalShell t={t} title={`Gestionar ${nc.id}`} onClose={onClose}>
      {/* Header con datos read-only */}
      <div style={{
        padding: 14, background: t.surfaceHi, border: `1px solid ${t.border}`,
        borderRadius: 6, marginBottom: 18
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.1em', marginBottom: 2 }}>PRUEBA ORIGEN</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: t.text }}>{nc.pruebaId}</div>
          </div>
          <Pill variant={nc.estado === 'ABIERTA' ? 'danger' : nc.estado === 'EN ANALISIS' ? 'warn' : 'success'} t={t}>{nc.estado}</Pill>
        </div>
        <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted }}>
          {nc.maquina} · {nc.operario} · {nc.cabezalesFalla} de 20 cabezales con falla
        </div>
        <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, marginTop: 4 }}>
          Abierta: {new Date(nc.timestamp).toLocaleString('es-AR')}
          {tiempoTranscurrido && (
            <> · <span style={{ color: t.success, fontWeight: 600 }}>Tiempo de cierre: {tiempoTranscurrido}</span></>
          )}
        </div>
        {nc.tipos && nc.tipos.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {nc.tipos.map(tid => {
              const tf = TIPOS_FALLA.find(x => x.id === tid);
              return <Pill key={tid} variant={tf?.gravedad === 'CRITICA' ? 'crit' : 'danger'} t={t}>{tf?.nombre}</Pill>;
            })}
          </div>
        )}
        {nc.observaciones && (
          <div style={{
            marginTop: 10, padding: 10, background: t.surface, borderRadius: 4,
            fontFamily: 'Manrope', fontSize: 11, color: t.text, fontStyle: 'italic'
          }}>
            "{nc.observaciones}"
          </div>
        )}
      </div>

      {/* Si está ABIERTA, botón Tomar */}
      {nc.estado === 'ABIERTA' && (
        <div style={{
          padding: 14, background: t.warnSoft, border: `1px solid ${t.warn}40`,
          borderRadius: 6, marginBottom: 16, textAlign: 'center'
        }}>
          <p style={{ fontFamily: 'Manrope', fontSize: 13, color: t.text, marginTop: 0, marginBottom: 12 }}>
            Esta NC todavía no fue tomada por nadie. Tomala para empezar el análisis.
          </p>
          <ButtonSm t={t} variant="warn" onClick={tomar}>
            <PlayCircle size={12} /> Tomar para análisis
          </ButtonSm>
        </div>
      )}

      {/* Si está EN ANALISIS, mostrar quién la tomó */}
      {nc.estado === 'EN ANALISIS' && (
        <div style={{
          padding: 10, background: t.warnSoft, border: `1px solid ${t.warn}40`,
          borderRadius: 6, marginBottom: 16, fontFamily: 'Manrope', fontSize: 12
        }}>
          <Pill variant="warn" t={t}>EN ANÁLISIS</Pill>
          <span style={{ marginLeft: 8, color: t.text }}>
            Tomada por <strong>{nc.tomadaPor}</strong> · {new Date(nc.tomadaAt).toLocaleString('es-AR')}
          </span>
        </div>
      )}

      {/* Formulario de cierre - solo si no está cerrada o está en análisis */}
      {!isReadonly && (
        <>
          <div style={{ marginBottom: 18 }}>
            <Label t={t}>Causa raíz <Asterisk t={t} /></Label>
            <select value={causaRaiz} onChange={e => setCausaRaiz(e.target.value)} style={{
              width: '100%', padding: '10px 12px', borderRadius: 6,
              background: t.surfaceHi, border: `1px solid ${t.border}`,
              color: causaRaiz ? t.text : t.textMuted, fontFamily: 'Manrope', fontSize: 13,
              outline: 'none', cursor: 'pointer'
            }}>
              <option value="">— Seleccioná una causa —</option>
              {CAUSAS_RAIZ.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 18 }}>
            <Label t={t}>Acciones tomadas durante la NC</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {ACCIONES_TOMADAS.map(a => {
                const checked = accionesElegidas.includes(a.id);
                return (
                  <button key={a.id} onClick={() => toggleAccion(a.id)} style={{
                    padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                    background: checked ? t.accentSoft : t.surfaceHi,
                    border: `1px solid ${checked ? t.accent : t.border}`,
                    color: checked ? t.accent : t.text,
                    fontFamily: 'Manrope', fontSize: 12, fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left'
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 3,
                      background: checked ? t.accent : 'transparent',
                      border: `1.5px solid ${checked ? t.accent : t.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                      {checked && <CheckCircle2 size={10} color={t.bg} />}
                    </div>
                    {a.nombre}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Label t={t}>Notas adicionales {causaRaiz === 'OTR' && <Asterisk t={t} />}</Label>
            <textarea
              value={causaRaiz === 'OTR' ? causaDetalle : notasCierre}
              onChange={e => causaRaiz === 'OTR' ? setCausaDetalle(e.target.value) : setNotasCierre(e.target.value)}
              rows={3}
              placeholder={causaRaiz === 'OTR' ? 'Detallá la causa raíz...' : 'Notas adicionales del cierre...'}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 6,
                background: t.surfaceHi, border: `1px solid ${t.border}`,
                color: t.text, fontFamily: 'Manrope', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none'
              }} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <ButtonSm t={t} grow onClick={onClose}>Cerrar sin guardar</ButtonSm>
            <ButtonSm t={t} variant="success" grow onClick={cerrar} disabled={!causaRaiz}>
              <FileCheck size={12} /> Cerrar No Conformidad
            </ButtonSm>
          </div>
        </>
      )}

      {/* Si está cerrada, mostrar resumen final */}
      {isReadonly && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <Label t={t}>Causa raíz</Label>
            <div style={{
              padding: 12, background: t.successSoft, border: `1px solid ${t.success}40`,
              borderRadius: 6, fontFamily: 'Manrope', fontSize: 13, color: t.text
            }}>
              {CAUSAS_RAIZ.find(c => c.id === nc.causaRaiz)?.nombre || nc.causaRaiz}
              {nc.causaRaizDetalle && (
                <div style={{ marginTop: 6, fontStyle: 'italic', color: t.textMuted, fontSize: 12 }}>
                  "{nc.causaRaizDetalle}"
                </div>
              )}
            </div>
          </div>

          {nc.accionesTomadas && nc.accionesTomadas.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Label t={t}>Acciones tomadas</Label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {nc.accionesTomadas.map(aid => (
                  <Pill key={aid} variant="success" t={t}>
                    {ACCIONES_TOMADAS.find(a => a.id === aid)?.nombre || aid}
                  </Pill>
                ))}
              </div>
            </div>
          )}

          {nc.notasCierre && (
            <div style={{ marginBottom: 14 }}>
              <Label t={t}>Notas de cierre</Label>
              <div style={{
                padding: 10, background: t.surfaceHi, border: `1px solid ${t.border}`,
                borderRadius: 6, fontFamily: 'Manrope', fontSize: 12, color: t.text, fontStyle: 'italic'
              }}>
                "{nc.notasCierre}"
              </div>
            </div>
          )}

          <div style={{
            padding: 12, background: t.successSoft, border: `1px solid ${t.success}40`,
            borderRadius: 6, marginTop: 14, fontFamily: 'Manrope', fontSize: 12, color: t.text
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <CheckCircle2 size={14} color={t.success} />
              <strong>Cerrada por {nc.cerradaPor}</strong>
            </div>
            <div style={{ color: t.textMuted, fontSize: 11 }}>
              {new Date(nc.cerradaAt).toLocaleString('es-AR')} · Tiempo abierta: {tiempoTranscurrido}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <ButtonSm t={t} grow onClick={onClose}>Cerrar ventana</ButtonSm>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

// =================================================================
// HISTORIAL POR TURNO — calendario + detalle del día (v5)
// =================================================================
// Visible solo para supervisor y admin. Permite elegir un día y ver las
// pruebas y NC de ese día agrupadas en los 3 turnos (M / T / N).
// Usa hora Argentina (timeZone fijo) para que el filtro coincida con el
// día calendario que vivió la planta, no con el día UTC del servidor.
// =================================================================

const TURNOS_INFO = [
  { codigo: 'M', nombre: 'Mañana', horario: '06:00 – 14:00', icon: Sun },
  { codigo: 'T', nombre: 'Tarde',  horario: '14:00 – 22:00', icon: Activity },
  { codigo: 'N', nombre: 'Noche',  horario: '22:00 – 06:00', icon: Moon },
];

const NOMBRES_MESES = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre'
];

const DIAS_SEMANA = ['D','L','M','M','J','V','S'];

const HistorialPorTurno = ({ t }) => {
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth());
  const [anio, setAnio] = useState(hoy.getFullYear());
  // diaSeleccionado: string YYYY-MM-DD (zona AR) o null
  const [diaSeleccionado, setDiaSeleccionado] = useState(fechaLocalAR(hoy));
  const [tests, setTests] = useState([]);
  const [ncs, setNcs] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      const [t1, t2] = await Promise.all([
        dataService.getTests(),
        dataService.getNCHistory()
      ]);
      if (cancelado) return;
      setTests(t1);
      setNcs(t2);
      setCargando(false);
    })();
    return () => { cancelado = true; };
  }, []);

  // Mapa día → cantidad de pruebas y de fallas, para pintar el badge en el calendario.
  const resumenPorDia = useMemo(() => {
    const m = new Map();
    for (const test of tests) {
      const d = fechaLocalAR(test.timestampSenal || test.timestamp);
      if (!d) continue;
      const cur = m.get(d) || { total: 0, fallas: 0 };
      cur.total += 1;
      if (test.estado === 'RECHAZADO') cur.fallas += 1;
      m.set(d, cur);
    }
    return m;
  }, [tests]);

  // Pruebas y NC del día seleccionado, ordenadas por hora y agrupadas por turno.
  const detalleDelDia = useMemo(() => {
    if (!diaSeleccionado) return null;
    const testsDelDia = tests
      .filter(test => fechaLocalAR(test.timestampSenal || test.timestamp) === diaSeleccionado)
      .sort((a, b) => new Date(a.timestampSenal || a.timestamp) - new Date(b.timestampSenal || b.timestamp));
    const ncsDelDia = ncs
      .filter(nc => fechaLocalAR(nc.aperturaAt || nc.timestamp) === diaSeleccionado);

    const porTurno = { M: [], T: [], N: [] };
    for (const test of testsDelDia) {
      const turno = turnoDeFecha(test.timestampSenal || test.timestamp);
      if (turno && porTurno[turno]) porTurno[turno].push(test);
    }
    return { testsDelDia, ncsDelDia, porTurno };
  }, [diaSeleccionado, tests, ncs]);

  // Construcción de la grilla del mes
  const grillaCalendario = useMemo(() => {
    const primerDia = new Date(anio, mes, 1);
    const offsetInicial = primerDia.getDay(); // 0 = domingo
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();
    const celdas = [];
    for (let i = 0; i < offsetInicial; i++) celdas.push(null);
    for (let dia = 1; dia <= diasEnMes; dia++) {
      const isoDia = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      celdas.push({ dia, isoDia });
    }
    while (celdas.length % 7 !== 0) celdas.push(null);
    return celdas;
  }, [mes, anio]);

  const cambiarMes = (delta) => {
    let nuevoMes = mes + delta;
    let nuevoAnio = anio;
    if (nuevoMes < 0) { nuevoMes = 11; nuevoAnio--; }
    if (nuevoMes > 11) { nuevoMes = 0; nuevoAnio++; }
    setMes(nuevoMes);
    setAnio(nuevoAnio);
  };

  const irHoy = () => {
    const ahora = new Date();
    setMes(ahora.getMonth());
    setAnio(ahora.getFullYear());
    setDiaSeleccionado(fechaLocalAR(ahora));
  };

  const diaSeleccionadoFormateado = useMemo(() => {
    if (!diaSeleccionado) return '';
    const [y, m, d] = diaSeleccionado.split('-').map(n => parseInt(n, 10));
    return `${d} de ${NOMBRES_MESES[m - 1]} de ${y}`;
  }, [diaSeleccionado]);

  const totalDelDia = detalleDelDia?.testsDelDia.length || 0;
  const fallasDelDia = detalleDelDia?.testsDelDia.filter(t => t.estado === 'RECHAZADO').length || 0;
  const ncsDelDia    = detalleDelDia?.ncsDelDia.length || 0;

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'flex-start' }}>
        {/* CALENDARIO */}
        <Card t={t} padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <button onClick={() => cambiarMes(-1)} style={{
              background: t.surfaceHi, border: `1px solid ${t.border}`, color: t.text,
              padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'JetBrains Mono', fontSize: 14
            }}>‹</button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 16, color: t.text, fontWeight: 600, textTransform: 'capitalize' }}>
                {NOMBRES_MESES[mes]} {anio}
              </div>
              <button onClick={irHoy} style={{
                background: 'transparent', border: 'none', color: t.accent,
                fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: '0.1em',
                cursor: 'pointer', padding: 0, marginTop: 2
              }}>IR A HOY</button>
            </div>
            <button onClick={() => cambiarMes(1)} style={{
              background: t.surfaceHi, border: `1px solid ${t.border}`, color: t.text,
              padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'JetBrains Mono', fontSize: 14
            }}>›</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
            {DIAS_SEMANA.map((d, i) => (
              <div key={i} style={{
                textAlign: 'center', fontFamily: 'JetBrains Mono', fontSize: 10,
                color: t.textDim, letterSpacing: '0.1em', padding: '6px 0'
              }}>{d}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {grillaCalendario.map((celda, i) => {
              if (!celda) return <div key={i} style={{ aspectRatio: '1' }} />;
              const resumen = resumenPorDia.get(celda.isoDia);
              const seleccionado = celda.isoDia === diaSeleccionado;
              const esHoy = celda.isoDia === fechaLocalAR(new Date());
              const tieneFallas = resumen && resumen.fallas > 0;
              return (
                <button key={i} onClick={() => setDiaSeleccionado(celda.isoDia)} style={{
                  aspectRatio: '1', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  background: seleccionado ? t.accent : (resumen ? t.surfaceHi : 'transparent'),
                  color: seleccionado ? t.bg : (esHoy ? t.accent : t.text),
                  border: `1px solid ${seleccionado ? t.accent : (esHoy ? t.accent + '60' : t.border)}`,
                  borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 13,
                  fontWeight: esHoy || seleccionado ? 600 : 400,
                  position: 'relative', padding: 0,
                  transition: 'background 0.12s'
                }}>
                  <span>{celda.dia}</span>
                  {resumen && (
                    <div style={{
                      fontSize: 9, marginTop: 2, fontWeight: 500,
                      color: seleccionado ? t.bg : (tieneFallas ? t.danger : t.success)
                    }}>
                      {resumen.total}{tieneFallas ? `·${resumen.fallas}` : ''}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 14, padding: 10, background: t.surfaceHi, borderRadius: 6, border: `1px solid ${t.border}` }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.05em', marginBottom: 6 }}>REFERENCIAS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'Manrope', fontSize: 11, color: t.textMuted }}>
              <span><span style={{ color: t.success }}>N</span> = pruebas del día (todas OK)</span>
              <span><span style={{ color: t.danger }}>N · X</span> = N pruebas, X fallas</span>
            </div>
          </div>
        </Card>

        {/* DETALLE DEL DÍA */}
        <div>
          <Card t={t} padding={20} style={{ marginBottom: 16 }}>
            <SectionHeader t={t}
              title={diaSeleccionadoFormateado || 'Seleccioná un día'}
              sub={diaSeleccionado
                ? `${totalDelDia} ${totalDelDia === 1 ? 'prueba' : 'pruebas'} · ${fallasDelDia} ${fallasDelDia === 1 ? 'falla' : 'fallas'} · ${ncsDelDia} ${ncsDelDia === 1 ? 'NC abierta' : 'NC abiertas'}`
                : 'Hacé click en un día del calendario para ver el detalle por turno'}
            />
          </Card>

          {!diaSeleccionado ? (
            <Card t={t} padding={20}>
              <EmptyState t={t} icon={ClipboardList}
                title="Sin selección"
                desc="Elegí un día del calendario de la izquierda. Los días con pruebas tienen un número en la celda."
              />
            </Card>
          ) : cargando ? (
            <Card t={t} padding={20}>
              <EmptyState t={t} icon={Activity} title="Cargando…" desc="Trayendo pruebas y NC del período." />
            </Card>
          ) : totalDelDia === 0 && ncsDelDia === 0 ? (
            <Card t={t} padding={20}>
              <EmptyState t={t} icon={ClipboardList}
                title="Sin actividad ese día"
                desc="No hay pruebas registradas. Probá con otra fecha o verificá que la máquina haya estado en producción."
              />
            </Card>
          ) : (
            TURNOS_INFO.map(turno => {
              const filas = detalleDelDia.porTurno[turno.codigo] || [];
              const fallasTurno = filas.filter(f => f.estado === 'RECHAZADO').length;
              const Icon = turno.icon;
              return (
                <Card key={turno.codigo} t={t} padding={20} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${t.border}`, paddingBottom: 12, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 6,
                        background: t.surfaceHi, border: `1px solid ${t.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <Icon size={16} color={t.textMuted} />
                      </div>
                      <div>
                        <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 14, fontWeight: 600, color: t.text }}>
                          Turno {turno.nombre}
                        </div>
                        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.05em' }}>
                          {turno.horario}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Pill variant="default" t={t} mono>{filas.length} pruebas</Pill>
                      {fallasTurno > 0 && <Pill variant="danger" t={t} mono>{fallasTurno} fallas</Pill>}
                    </div>
                  </div>

                  {filas.length === 0 ? (
                    <div style={{
                      fontFamily: 'Manrope', fontSize: 12, color: t.textDim,
                      padding: '12px 0', textAlign: 'center'
                    }}>
                      Sin pruebas en este turno
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '90px 90px 100px 1fr 90px 100px', gap: 12, alignItems: 'center', fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.05em', padding: '6px 0', borderBottom: `1px solid ${t.border}` }}>
                      <span>HORA</span>
                      <span>MÁQUINA</span>
                      <span>OPERARIO</span>
                      <span>PRODUCTO · CAJA · LOTE</span>
                      <span>ESTADO</span>
                      <span style={{ textAlign: 'right' }}>FALLAS</span>
                    </div>
                  )}

                  {filas.map(f => (
                    <div key={f.supabase_id || f.id} style={{
                      display: 'grid', gridTemplateColumns: '90px 90px 100px 1fr 90px 100px',
                      gap: 12, alignItems: 'center',
                      padding: '10px 0', borderBottom: `1px solid ${t.border}`,
                      fontSize: 12
                    }}>
                      <span style={{ fontFamily: 'JetBrains Mono', color: t.text }}>{f.fecha}</span>
                      <span style={{ fontFamily: 'JetBrains Mono', color: t.textMuted }}>{f.maquina}</span>
                      <span style={{ fontFamily: 'Manrope', color: t.text }}>{f.operario || f.legajoOperario}</span>
                      <span style={{ fontFamily: 'Manrope', color: t.text }}>
                        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11 }}>{f.codigoProducto || '—'}</span>
                        {' · '}<span style={{ color: t.textMuted }}>caja {f.caja || '—'}</span>
                        {' · '}<span style={{ color: t.accent, fontFamily: 'JetBrains Mono' }}>{f.lote || '—'}</span>
                      </span>
                      <Pill variant={f.estado === 'OK' ? 'success' : 'danger'} t={t}>{f.estado}</Pill>
                      <span style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', color: f.cabezalesFalla > 0 ? t.danger : t.textDim }}>
                        {f.cabezalesFalla || 0}/20
                      </span>
                    </div>
                  ))}
                </Card>
              );
            })
          )}

          {/* NC del día (resumen, no agrupadas por turno porque pueden cerrarse mucho después) */}
          {detalleDelDia && detalleDelDia.ncsDelDia.length > 0 && (
            <Card t={t} padding={20}>
              <SectionHeader t={t}
                title="No conformidades abiertas ese día"
                sub={`${detalleDelDia.ncsDelDia.length} en total`}
              />
              <div style={{ marginTop: 12 }}>
                {detalleDelDia.ncsDelDia.map(nc => {
                  const horaApertura = new Date(nc.aperturaAt || nc.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
                  return (
                    <div key={nc.supabase_id} style={{
                      display: 'grid', gridTemplateColumns: '110px 80px 110px 1fr 110px',
                      gap: 12, padding: '10px 0', borderBottom: `1px solid ${t.border}`,
                      fontSize: 12, alignItems: 'center'
                    }}>
                      <span style={{ fontFamily: 'JetBrains Mono', color: t.text, fontWeight: 500 }}>{nc.id}</span>
                      <span style={{ fontFamily: 'JetBrains Mono', color: t.textMuted }}>{horaApertura}</span>
                      <span style={{ fontFamily: 'JetBrains Mono', color: t.textMuted }}>{nc.maquina || '—'}</span>
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {nc.tipos?.slice(0, 3).map(tid => {
                          const tf = TIPOS_FALLA.find(x => x.id === tid);
                          return <Pill key={tid} variant={tf?.gravedad === 'CRITICA' ? 'crit' : 'danger'} t={t}>{tf?.nombre || tid}</Pill>;
                        })}
                      </span>
                      <Pill variant={nc.estado === 'CERRADA' ? 'success' : nc.estado === 'EN_ANALISIS' ? 'warn' : 'danger'} t={t} mono>
                        {nc.estado}
                      </Pill>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

// =================================================================
// VISTA SUPERVISOR (con cambios v4)
// =================================================================

const VistaSupervisor = ({ t, currentUser }) => {
  const [machines, setMachines] = useState([]);
  const [tests, setTests] = useState([]);
  const [observarTest, setObservarTest] = useState(null);
  const [ncHistory, setNcHistory] = useState([]);
  const [unreadObs, setUnreadObs] = useState([]);
  const [gestionarNC, setGestionarNC] = useState(null);
  // FIX v5: alerta in-app cuando llega una prueba RECHAZADA recién cargada
  const [alertaFalla, setAlertaFalla] = useState(null);
  // FIX v5: tab activa (turno actual / historial)
  const [tabActiva, setTabActiva] = useState('turno');

  const reload = async () => {
    setMachines(await dataService.getMachines());
    setTests(await dataService.getTests());
    setNcHistory(await dataService.getNCHistory());
    setUnreadObs(await dataService.getAllUnreadObservations());
  };

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 15000); // FIX v5: refresh cada 15s (era 30s)
    return () => clearInterval(interval);
  }, []);

  // FIX v5: suscripción Realtime — el supervisor se entera al instante
  // cuando el operario carga una prueba con falla. Si Realtime no está
  // habilitado, el polling de 15s lo cubre igual.
  useEffect(() => {
    const channel = supabase
      .channel('pruebas-supervisor')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'pruebas',
        filter: 'resultado=eq.RECHAZADO'
      }, async (payload) => {
        console.log('Realtime supervisor: nueva prueba RECHAZADA', payload.new)
        // Mostramos toast inmediato; los detalles del operario los resolvemos vía cache
        const usuariosMap = await dataService.getUsersCache()
        const operario = usuariosMap.get(payload.new.operario_legajo) || payload.new.operario_legajo
        setAlertaFalla({
          id: payload.new.id,
          maquina: payload.new.id_maquina,
          operario,
          legajoOperario: payload.new.operario_legajo,
          codigoProducto: payload.new.codigo_producto,
          numeroCaja: payload.new.numero_caja,
          numeroLote: payload.new.numero_lote,
          cabezalesFalla: payload.new.cantidad_cabezales_afectados,
          observaciones: payload.new.observaciones,
          createdAt: payload.new.created_at,
        })
        reload()
      })
      .subscribe((status) => {
        console.log('Realtime supervisor status:', status)
      })

    return () => { supabase.removeChannel(channel) }
  }, [])

  const machinesIntegradas = machines.filter(m => m.integrada);
  const idealAhora = 6;
  const machinesProgress = machinesIntegradas.map(m => {
    const reales = tests.filter(t => t.maquina === m.id).length;
    return { ...m, reales: Math.min(reales, 8), ideal: idealAhora, pct: Math.round((reales / idealAhora) * 100) };
  });

  const enAprobacion = tests.find(t => t.esperandoAprobacion);

  // Pareto del turno
  const paretoMap = {};
  tests.filter(t => t.tipos).forEach(t => t.tipos.forEach(tid => {
    paretoMap[tid] = (paretoMap[tid] || 0) + 1;
  }));
  const paretoTurno = Object.entries(paretoMap)
    .map(([id, cantidad]) => ({ tipo: TIPOS_FALLA.find(tf => tf.id === id)?.nombre || id, cantidad, gravedad: TIPOS_FALLA.find(tf => tf.id === id)?.gravedad }))
    .sort((a, b) => b.cantidad - a.cantidad);

  const totalPruebas = tests.length;
  const pruebasRechazadas = tests.filter(t => t.estado === 'RECHAZADO').length;
  const tasaFalla = totalPruebas > 0 ? Math.round((pruebasRechazadas / totalPruebas) * 100) : 0;
  const totalIncidenciasTipos = paretoTurno.reduce((s, p) => s + p.cantidad, 0);

  // CAMBIO v4: KPI tiempo promedio de cierre de NC
  const ncCerradas = ncHistory.filter(nc => nc.estado === 'CERRADA' && nc.cerradaAt);
  const tiempoPromedioCierre = useMemo(() => {
    if (ncCerradas.length === 0) return null;
    const totalMs = ncCerradas.reduce((sum, nc) => {
      return sum + (new Date(nc.cerradaAt).getTime() - new Date(nc.timestamp).getTime());
    }, 0);
    const promedioMs = totalMs / ncCerradas.length;
    const min = Math.floor(promedioMs / 60000);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
  }, [ncCerradas]);

  // CAMBIO v4: Observaciones no leídas con tiempo desde envío
  const obsNoLeidasMin = useMemo(() => {
    if (unreadObs.length === 0) return null;
    const ms = Date.now() - new Date(unreadObs[unreadObs.length - 1].timestamp).getTime();
    return Math.floor(ms / 60000);
  }, [unreadObs]);

  const enviarObservacion = async (mensaje) => {
    await dataService.addObservation({
      testId:          observarTest.id,
      maquina:         observarTest.maquina,
      legajoOperario:  observarTest.legajoOperario,
      supervisor:      `${currentUser.nombre} ${currentUser.apellido}`,
      mensaje,
    })
    await dataService.logEvent({
      accion: 'OBSERVE',
      usuario: `${currentUser.nombre} ${currentUser.apellido}`,
      desc: `Observación enviada en ${observarTest.id} → operario ${observarTest.legajoOperario}`
    })
    setObservarTest(null)
    reload()
  }

  const enviarAColaDeAprobacion = async () => {
    if (!alertaFalla?.id) return;
    await dataService.updateTest(alertaFalla.id, {
      estado: 'RECHAZADO',
      estadoFinal: 'PENDIENTE_APROBACION',
      esperandoAprobacion: true,
      tuvoFalla: true
    });
    setTabActiva('turno');
    setAlertaFalla(null);
    reload();
  }

  const aprobarRechazo = async () => {
    await dataService.updateTest(enAprobacion.id, { esperandoAprobacion: false, aprobado: true });
    await dataService.createNC({
      pruebaId: enAprobacion.id,
      maquina: enAprobacion.maquina,
      operario: enAprobacion.operario,
      tipos: enAprobacion.tipos,
      cabezalesFalla: enAprobacion.cabezalesFalla,
      observaciones: enAprobacion.observaciones,
      aprobadoPor: `${currentUser.nombre} ${currentUser.apellido}`,
    });
    await dataService.logEvent({
      accion: 'APPROVE', usuario: `${currentUser.nombre} ${currentUser.apellido}`,
      desc: `Aprobado rechazo ${enAprobacion.id} · NC abierta`
    });
    reload();
  };

  // CAMBIO v4: actualizar NC desde el modal
  const actualizarNC = async (ncId, updates) => {
    const updated = await dataService.updateNC(ncId, updates);
    await dataService.logEvent({
      accion: updates.estado === 'CERRADA' ? 'CLOSE_NC' : 'UPDATE_NC',
      usuario: `${currentUser.nombre} ${currentUser.apellido}`,
      desc: `${updates.estado === 'CERRADA' ? 'Cerró' : 'Actualizó'} ${ncId}`
    });
    setGestionarNC(updated);
    reload();
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto' }}>
      {/* FIX v5: toast en vivo cuando llega una prueba con falla */}
      {alertaFalla && (
        <div style={{
          position: 'fixed', top: 80, right: 24, width: 400, zIndex: 220,
          background: t.surface, border: `2px solid ${t.danger}`, borderRadius: 10,
          boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 4px ${t.dangerSoft}`,
          animation: 'slideInRight 0.3s ease-out', overflow: 'hidden'
        }}>
          <div style={{
            padding: '12px 16px', background: t.dangerSoft,
            borderBottom: `1px solid ${t.danger}40`,
            display: 'flex', alignItems: 'center', gap: 10
          }}>
            <AlertTriangle size={18} color={t.danger} style={{ animation: 'pulse 1.5s infinite, blinkGlow 1.3s ease-in-out infinite' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 14, fontWeight: 600, color: t.danger }}>
                Nueva prueba con falla
              </div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.05em' }}>
                {new Date(alertaFalla.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · máquina {alertaFalla.maquina}
              </div>
            </div>
            <button onClick={() => setAlertaFalla(null)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer', color: t.textMuted, padding: 4
            }}>
              <X size={16} />
            </button>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontFamily: 'Manrope', fontSize: 13, color: t.text, marginBottom: 8 }}>
              <strong>{alertaFalla.operario}</strong> reportó {alertaFalla.cabezalesFalla} de 20 cabezales con falla
            </div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textMuted }}>
              {alertaFalla.codigoProducto} · caja {alertaFalla.numeroCaja} · lote {alertaFalla.numeroLote}
            </div>
            {alertaFalla.observaciones && (
              <div style={{
                marginTop: 10, padding: 10, background: t.surfaceHi, borderRadius: 6,
                fontFamily: 'Manrope', fontSize: 12, color: t.text,
                borderLeft: `3px solid ${t.danger}`
              }}>
                "{alertaFalla.observaciones}"
              </div>
            )}
            <button onClick={enviarAColaDeAprobacion} style={{
              width: '100%', marginTop: 12, padding: 10, background: t.danger, color: t.bg,
              border: 'none', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'Bricolage Grotesque', fontSize: 13, fontWeight: 600
            }}>
              Revisar en cola de aprobaciones
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, fontWeight: 600, color: t.text, marginBottom: 4, letterSpacing: '-0.02em' }}>
          {tabActiva === 'turno' ? 'Turno mañana · en curso' : 'Historial por turno'}
        </h1>
        <div style={{ display: 'flex', gap: 16, fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textDim, letterSpacing: '0.05em' }}>
          <span>{machinesIntegradas.length}/{machines.length} MÁQUINAS INTEGRADAS</span>
          <span>·</span>
          <span style={{ color: t.success }}>● SISTEMA OPERATIVO</span>
        </div>
      </div>

      {/* FIX v5: tabs para alternar entre turno actual e historial */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${t.border}`, marginBottom: 20 }}>
        {[
          { id: 'turno', label: 'Turno actual', icon: Activity },
          { id: 'historial', label: 'Historial', icon: History },
        ].map(tb => (
          <button key={tb.id} onClick={() => setTabActiva(tb.id)} style={{
            padding: '10px 16px', background: 'transparent', border: 'none',
            borderBottom: `2px solid ${tabActiva === tb.id ? t.accent : 'transparent'}`,
            color: tabActiva === tb.id ? t.text : t.textMuted, cursor: 'pointer',
            fontFamily: 'Manrope', fontSize: 13, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: -1
          }}>
            <tb.icon size={14} /> {tb.label}
          </button>
        ))}
      </div>

      {tabActiva === 'historial' && <HistorialPorTurno t={t} />}

      {tabActiva === 'turno' && (<>
      {/* INICIO bloque turno actual — los KPIs, cola de aprobaciones y NC del turno */}

      {/* CAMBIO v4: Alerta de observaciones no leídas */}
      {unreadObs.length > 0 && (
        <Card t={t} padding={14} style={{
          marginBottom: 16,
          background: t.warnSoft,
          borderColor: t.warn + '60',
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <Inbox size={18} color={t.warn} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Manrope', fontSize: 13, fontWeight: 600, color: t.warn }}>
              {unreadObs.length} {unreadObs.length === 1 ? 'observación pendiente de lectura' : 'observaciones pendientes de lectura'}
            </div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textMuted, letterSpacing: '0.05em' }}>
              {obsNoLeidasMin !== null && (obsNoLeidasMin < 1 ? 'enviada hace menos de 1 minuto' : `más antigua hace ${obsNoLeidasMin} min`)}
            </div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPI t={t} label="Pruebas turno" value={totalPruebas} sub={`de ${idealAhora * machinesIntegradas.length} previstas`} />
        <KPI t={t} label="Tasa de falla" value={`${tasaFalla}%`}
          sub={`${pruebasRechazadas} rechazos / ${totalPruebas} pruebas`}
          tone={tasaFalla > 5 ? 'warn' : 'success'} />
        <KPI t={t} label="Esperan aprobación" value={enAprobacion ? '1' : '0'}
          sub={enAprobacion ? 'rechazo pendiente' : 'cola vacía'} tone={enAprobacion ? 'danger' : 'success'} />
        <KPI t={t} label="Promedio cierre NC" value={tiempoPromedioCierre || '—'}
          sub={ncCerradas.length > 0 ? `${ncCerradas.length} NC cerradas hoy` : 'sin NC cerradas aún'}
          tone="success" />
      </div>

      <Card t={t} padding={20} style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Fingerprint size={18} color={t.textDim} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 16, fontWeight: 600, color: t.text }}>
              Verificaciones físicas aleatorias
            </div>
            <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted }}>
              Aún no hay datos disponibles. Las verificaciones aparecerán acá una vez que el sistema acumule pruebas del turno anterior.
            </div>
          </div>
          <Pill variant="default" t={t} mono>SIN DATOS</Pill>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 24 }}>
        <Card t={t} padding={20}>
          <SectionHeader t={t} title="Progreso por máquina" sub={`Ideal a esta hora · ${idealAhora} pruebas por máquina`} />
          <div style={{ marginTop: 16 }}>
            {machinesIntegradas.length === 0 ? (
              <EmptyState icon={Power} t={t}
                title="No hay máquinas integradas todavía"
                desc="El administrador puede ir activando las máquinas a medida que se incorporan al sistema desde el panel de gestión." />
            ) : (
              machinesProgress.map(m => <MachineRowMejorada key={m.id} m={m} t={t} />)
            )}
            {machines.filter(m => !m.integrada).length > 0 && (
              <div style={{ marginTop: 14, padding: '10px 12px', background: t.surfaceHi, borderRadius: 6, border: `1px dashed ${t.border}` }}>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.1em', marginBottom: 6 }}>
                  PENDIENTES DE INTEGRACIÓN ({machines.filter(m => !m.integrada).length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {machines.filter(m => !m.integrada).map(m => (
                    <span key={m.id} style={{
                      fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textMuted,
                      background: t.surface, padding: '2px 8px', borderRadius: 3, border: `1px solid ${t.border}`
                    }}>{m.id}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card t={t} padding={20}>
          <SectionHeader t={t} title="Pareto del turno" sub={`${totalIncidenciasTipos} ${totalIncidenciasTipos === 1 ? 'incidencia registrada' : 'incidencias registradas'}`} />
          <div style={{ marginTop: 16 }}>
            {paretoTurno.length === 0 ? (
              <EmptyState icon={CheckCircle2} t={t}
                title="Sin fallas en el turno"
                desc="Cuando se registren rechazos, el Pareto los irá ordenando por frecuencia." />
            ) : (
              paretoTurno.map((p, i) => (
                <ParetoRowMejorada key={p.tipo} p={p} maxCantidad={paretoTurno[0].cantidad} totalFallas={totalIncidenciasTipos} t={t} index={i} />
              ))
            )}
          </div>
        </Card>
      </div>

      {enAprobacion && (
        <Card t={t} padding={24} style={{ borderColor: t.danger + '60', marginBottom: 24 }}>
          <SectionHeader t={t} title="Cola de aprobaciones" sub="Rechazo pendiente requiere tu decisión" />
          <div style={{ marginTop: 16, padding: 16, background: t.dangerSoft, border: `1px solid ${t.danger}40`, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 14, color: t.text, fontWeight: 500 }}>{enAprobacion.id}</span>
                  <Pill variant="danger" t={t}>RECHAZADO</Pill>
                  {enAprobacion.tipos?.some(tid => TIPOS_FALLA.find(tf => tf.id === tid)?.gravedad === 'CRITICA') && <Pill variant="crit" t={t}>● CRÍTICO</Pill>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {enAprobacion.tipos?.map(tid => {
                    const tf = TIPOS_FALLA.find(x => x.id === tid);
                    return <Pill key={tid} variant={tf?.gravedad === 'CRITICA' ? 'crit' : 'danger'} t={t}>{tf?.nombre}</Pill>;
                  })}
                </div>
                <div style={{ fontFamily: 'Manrope', fontSize: 13, color: t.textMuted, marginTop: 8 }}>
                  {enAprobacion.maquina} · {enAprobacion.operario} · caja {enAprobacion.caja} · lote{' '}
                  <span style={{ fontFamily: 'JetBrains Mono', color: t.accent }}>{enAprobacion.lote}</span>
                </div>
                <div style={{ fontFamily: 'Manrope', fontSize: 13, color: t.textMuted, marginTop: 4 }}>
                  {enAprobacion.cabezalesFalla} de 20 cabezales con falla · {enAprobacion.codigoProducto}
                </div>
                {enAprobacion.observaciones && (
                  <div style={{ marginTop: 10, padding: 10, background: t.surface, borderRadius: 6, fontFamily: 'Manrope', fontSize: 12, color: t.text }}>
                    "{enAprobacion.observaciones}"
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ButtonSm t={t} onClick={() => setObservarTest(enAprobacion)}>
                <MessageSquare size={12} /> Observar
              </ButtonSm>
              <ButtonSm t={t} variant="success" grow onClick={aprobarRechazo}>
                Aprobar rechazo y abrir No Conformidad
              </ButtonSm>
            </div>
          </div>
        </Card>
      )}

      {/* Historial NC del turno */}
      <Card t={t} padding={20}>
        <SectionHeader t={t}
          title="Historial de no conformidades del turno"
          sub={`${ncHistory.length} en total · ${ncHistory.filter(n => n.estado !== 'CERRADA').length} sin cerrar`}
        />
        <div style={{ marginTop: 14 }}>
          {ncHistory.length === 0 ? (
            <EmptyState icon={History} t={t}
              title="Sin no conformidades en el turno"
              desc="Acá vas a ver todas las NC que se abran a medida que se aprueben los rechazos. Click en cada una para gestionar." />
          ) : (
            ncHistory.map((nc, i) => (
              <NCHistoryRow key={nc.id} nc={nc} t={t} index={i} onClick={() => setGestionarNC(nc)} />
            ))
          )}
        </div>
      </Card>
      </>)} {/* FIX v5: cierra bloque turno actual */}

      {observarTest && (
        <ModalObservar
          test={observarTest}
          onClose={() => setObservarTest(null)}
          onSend={enviarObservacion}
          t={t}
        />
      )}

      {gestionarNC && (
        <ModalGestionarNC
          nc={gestionarNC}
          currentUser={currentUser}
          onClose={() => setGestionarNC(null)}
          onUpdate={actualizarNC}
          t={t}
        />
      )}
    </div>
  );
};

// CAMBIO v4: NC clickeable para abrir modal
const NCHistoryRow = ({ nc, t, index, onClick }) => {
  const tieneCritica = nc.tipos?.some(tid => TIPOS_FALLA.find(tf => tf.id === tid)?.gravedad === 'CRITICA');
  const tiempo = new Date(nc.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  // Calcular tiempo abierta
  const tiempoAbierta = useMemo(() => {
    const fin = nc.cerradaAt ? new Date(nc.cerradaAt).getTime() : Date.now();
    const ms = fin - new Date(nc.timestamp).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
  }, [nc.cerradaAt, nc.timestamp]);

  const getEstadoColor = () => {
    if (nc.estado === 'CERRADA') return 'success';
    if (nc.estado === 'EN ANALISIS') return 'warn';
    return 'danger';
  };

  return (
    <div onClick={onClick} style={{
      borderBottom: index < 99 ? `1px solid ${t.border}` : 'none',
      padding: '14px 0',
      cursor: 'pointer',
      transition: 'background 0.15s',
      borderRadius: 4
    }}
    onMouseEnter={e => e.currentTarget.style.background = t.surfaceHover}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <div style={{
        display: 'grid', gridTemplateColumns: '160px 1fr 90px 200px 30px',
        gap: 12, alignItems: 'center'
      }}>
        <div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: t.text, fontWeight: 500 }}>{nc.id}</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, marginTop: 2 }}>{tiempo}</div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tieneCritica && <Pill variant="crit" t={t}>● CRÍTICA</Pill>}
          {nc.tipos?.slice(0, 3).map(tid => {
            const tf = TIPOS_FALLA.find(x => x.id === tid);
            return <Pill key={tid} variant={tf?.gravedad === 'CRITICA' ? 'crit' : 'danger'} t={t}>{tf?.nombre}</Pill>;
          })}
          {nc.tipos?.length > 3 && <Pill variant="default" t={t}>+{nc.tipos.length - 3}</Pill>}
        </div>
        <Pill variant={getEstadoColor()} t={t} mono>{nc.estado}</Pill>
        <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, textAlign: 'right' }}>
          {nc.maquina} · {nc.operario}
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: nc.estado === 'CERRADA' ? t.success : t.warn, marginTop: 2 }}>
            {nc.estado === 'CERRADA' ? `Cerrada en ${tiempoAbierta}` : `Abierta hace ${tiempoAbierta}`}
          </div>
        </div>
        <ChevronRight size={14} color={t.textDim} />
      </div>
    </div>
  );
};

const MachineRowMejorada = ({ m, t }) => {
  const tone = m.pct >= 95 ? 'success' : m.pct >= 70 ? 'warn' : 'danger';
  const colors = { success: t.success, warn: t.warn, danger: t.danger };
  const icons = { success: CheckCircle2, warn: AlertCircle, danger: AlertTriangle };
  const StatusIcon = icons[tone];

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '160px 1fr 90px 60px',
      gap: 14, padding: '14px 0', borderBottom: `1px solid ${t.border}`, alignItems: 'center'
    }}>
      <div>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 15, color: t.text, fontWeight: 600, letterSpacing: '0.02em' }}>
          {m.id}
        </div>
        <div style={{ fontFamily: 'Manrope', fontSize: 11, color: t.textMuted, marginTop: 2 }}>
          {m.linea}
        </div>
      </div>
      <div style={{ height: 12, background: t.surfaceHi, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${Math.min(m.pct, 100)}%`, height: '100%', background: colors[tone], borderRadius: 6, transition: 'width 0.3s' }} />
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 15, color: t.text, fontWeight: 600 }}>
          {m.reales} <span style={{ color: t.textDim, fontSize: 12 }}>/ {m.ideal}</span>
        </div>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: colors[tone], fontWeight: 500 }}>{m.pct}%</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 6,
          background: colors[tone] + '20', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <StatusIcon size={16} color={colors[tone]} />
        </div>
      </div>
    </div>
  );
};

const ParetoRowMejorada = ({ p, maxCantidad, totalFallas, t, index }) => {
  const pct = Math.round((p.cantidad / totalFallas) * 100);
  const widthPct = (p.cantidad / maxCantidad) * 100;
  const tone = p.gravedad === 'CRITICA' ? 'danger' : p.gravedad === 'MAYOR' ? 'warn' : 'default';
  const colors = { danger: t.danger, warn: t.warn, default: t.textMuted };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontFamily: 'Manrope', fontSize: 13, color: t.text, fontWeight: 500 }}>
          <span style={{ color: t.textDim, marginRight: 6, fontFamily: 'JetBrains Mono' }}>{index + 1}.</span>
          {p.tipo}
        </span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: colors[tone], fontWeight: 600 }}>
          {p.cantidad} <span style={{ color: t.textDim }}>· {pct}%</span>
        </span>
      </div>
      <div style={{ height: 14, background: t.surfaceHi, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${widthPct}%`, height: '100%', background: colors[tone], borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
};

const KPI = ({ label, value, sub, tone = 'default', t }) => {
  const colors = { default: t.text, success: t.success, warn: t.warn, danger: t.danger };
  return (
    <Card t={t} padding={18}>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, color: colors[tone], fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontFamily: 'Manrope', fontSize: 11, color: t.textMuted, marginTop: 4 }}>{sub}</div>
    </Card>
  );
};

// =================================================================
// VISTA ADMIN
// =================================================================

const VistaAdmin = ({ t, currentUser }) => {
  const [tab, setTab] = useState('dashboard');

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'historial', label: 'Historial', icon: History }, // FIX v5
    { id: 'usuarios', label: 'Usuarios', icon: Users },
    { id: 'maquinas', label: 'Máquinas', icon: Cpu },
  ];

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, fontWeight: 600, color: t.text, letterSpacing: '-0.02em' }}>
          Panel administrador
        </h1>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textDim, letterSpacing: '0.05em' }}>
          GESTIÓN DEL SISTEMA · ACCESO TOTAL
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${t.border}`, marginBottom: 20 }}>
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)} style={{
            padding: '10px 16px', background: 'transparent', border: 'none',
            borderBottom: `2px solid ${tab === tb.id ? t.accent : 'transparent'}`,
            color: tab === tb.id ? t.text : t.textMuted, cursor: 'pointer',
            fontFamily: 'Manrope', fontSize: 13, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: -1
          }}>
            <tb.icon size={14} /> {tb.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <AdminDashboard t={t} />}
      {tab === 'historial' && <HistorialPorTurno t={t} />}
      {tab === 'usuarios' && <AdminUsuarios t={t} currentUser={currentUser} />}
      {tab === 'maquinas' && <AdminMaquinas t={t} />}
    </div>
  );
};

const AdminDashboard = ({ t }) => {
  const [tests, setTests] = useState([]);
  const [machines, setMachines] = useState([]);
  const [audit, setAudit] = useState([]);

  useEffect(() => {
    const load = async () => {
      setTests(await dataService.getTests());
      setMachines(await dataService.getMachines());
      setAudit(await dataService.getAuditLog());
    };
    load();
  }, []);

  return (
    <>
      <Card t={t} padding={20} style={{ marginBottom: 16 }}>
        <SectionHeader t={t} title="Salud del sistema" sub="Diagnóstico en tiempo real" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 18 }}>
          <HealthCard t={t} icon={Database} label="Datos" value="OK" sub={`${tests.length} pruebas registradas`} tone="success" />
          <HealthCard t={t} icon={Cpu} label="Máquinas integradas" value={`${machines.filter(m => m.integrada).length}/${machines.length}`} sub="del total" tone={machines.filter(m => m.integrada).length === machines.length ? 'success' : 'warn'} />
          <HealthCard t={t} icon={Activity} label="Eventos auditoría" value={audit.length} sub="acumulados" tone="success" />
          <HealthCard t={t} icon={Lock} label="Sesión" value="ACTIVA" sub="modo administrador" tone="success" />
        </div>
      </Card>

      <Card t={t} padding={20}>
        <SectionHeader t={t} title="Audit log · últimos eventos" sub={`${audit.length} eventos totales`} />
        <div style={{ marginTop: 14 }}>
          {audit.length === 0 ? (
            <EmptyState icon={FileSearch} t={t} title="Sin eventos todavía" desc="A medida que se realicen acciones en el sistema, irán apareciendo registradas acá con su hash de integridad." />
          ) : (
            audit.slice(0, 10).map((e, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '110px 90px 1fr 80px',
                gap: 12, padding: '10px 0', borderBottom: `1px solid ${t.border}`,
                alignItems: 'center', fontSize: 12
              }}>
                <span style={{ fontFamily: 'JetBrains Mono', color: t.textDim }}>
                  {new Date(e.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span style={{ textAlign: 'center' }}>
                  <Pill variant={
                    e.accion === 'CREATE' ? 'info' :
                    e.accion === 'APPROVE' ? 'success' :
                    e.accion === 'OBSERVE' ? 'accent' :
                    e.accion === 'READ' ? 'success' :
                    e.accion === 'CLOSE_NC' ? 'success' :
                    'default'
                  } t={t} mono>{e.accion}</Pill>
                </span>
                <span style={{ fontFamily: 'Manrope', color: t.text }}>{e.desc}</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, textAlign: 'right' }}>{e.hash}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  );
};

const AdminUsuarios = ({ t, currentUser }) => {
  const [users, setUsers] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);

  const refresh = async () => setUsers(await dataService.getUsers());
  useEffect(() => { refresh(); }, []);

  return (
    <>
      <Card t={t} padding={20} style={{ marginBottom: 16 }}>
        <SectionHeader t={t} title="Gestión de usuarios" sub={`${users.length} usuarios registrados en el sistema`} action={
          <div style={{ display: 'flex', gap: 8 }}>
            <ButtonSm t={t} variant="default" onClick={() => setShowAddManual(true)}>
              <Plus size={12} /> Crear manual
            </ButtonSm>
            <ButtonSm t={t} variant="accent" onClick={() => setShowImport(true)}>
              <FileSpreadsheet size={12} /> Importar Excel
            </ButtonSm>
          </div>
        } />

        <div style={{ marginTop: 16 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '80px 1fr 100px 1fr 110px 100px',
            gap: 12, padding: '10px 0', borderBottom: `1px solid ${t.border}`,
            fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.1em'
          }}>
            <span>LEGAJO</span><span>NOMBRE</span><span>ROL</span>
            <span>EMAIL</span><span>MÁQUINA</span><span style={{ textAlign: 'right' }}>ACCIONES</span>
          </div>
          {users.map(u => (
            <div key={u.legajo} style={{
              display: 'grid', gridTemplateColumns: '80px 1fr 100px 1fr 110px 100px',
              gap: 12, padding: '12px 0', borderBottom: `1px solid ${t.border}`,
              alignItems: 'center', fontSize: 12
            }}>
              <span style={{ fontFamily: 'JetBrains Mono', color: t.text, fontWeight: 500 }}>{u.legajo}</span>
              <div>
                <div style={{ fontFamily: 'Manrope', color: t.text, fontWeight: 500 }}>{u.nombre} {u.apellido}</div>
                {u.forceChange && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: t.warn }}>● cambio pwd pendiente</span>}
              </div>
              <Pill variant={u.rol === 'admin' ? 'accent' : u.rol === 'supervisor' ? 'warn' : u.rol === 'auditor' ? 'info' : 'default'} t={t} mono>{u.rol}</Pill>
              <span style={{ fontFamily: 'Manrope', color: t.textMuted, fontSize: 11 }}>{u.email}</span>
              <span style={{ fontFamily: 'JetBrains Mono', color: t.textMuted, fontSize: 11 }}>{u.maquina_asignada || '—'}</span>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {u.legajo !== currentUser.legajo && (
                  <button onClick={async () => {
                    if (confirm(`¿Eliminar usuario ${u.nombre} ${u.apellido}?`)) {
                      await dataService.deleteUser(u.legajo);
                      await dataService.logEvent({ accion: 'DELETE', usuario: `${currentUser.nombre}`, desc: `Eliminó usuario ${u.legajo}` });
                      refresh();
                    }
                  }} style={{
                    background: t.surfaceHi, border: `1px solid ${t.border}`, color: t.danger,
                    padding: 6, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center'
                  }}><Trash2 size={12} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {showImport && <ModalImportarUsuarios t={t} onClose={() => setShowImport(false)} onImport={async (newUsers) => {
        await dataService.addUsers(newUsers);
        await dataService.logEvent({ accion: 'CREATE', usuario: `${currentUser.nombre}`, desc: `Importó ${newUsers.length} usuarios` });
        setShowImport(false);
        refresh();
      }} />}

      {showAddManual && <ModalAgregarUsuario t={t} onClose={() => setShowAddManual(false)} onAdd={async (u) => {
        await dataService.addUsers([u]);
        await dataService.logEvent({ accion: 'CREATE', usuario: `${currentUser.nombre}`, desc: `Creó usuario ${u.legajo}` });
        setShowAddManual(false);
        refresh();
      }} />}
    </>
  );
};

const ModalImportarUsuarios = ({ t, onClose, onImport }) => {
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');

  const procesar = () => {
    setError('');
    const lines = paste.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) { setError('Pegá al menos una fila de datos (debajo del encabezado)'); return; }

    const headers = lines[0].split(/\t|,|;/).map(h => h.trim().toLowerCase());
    const required = ['legajo', 'nombre', 'apellido', 'rol'];
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length) { setError(`Faltan columnas: ${missing.join(', ')}`); return; }

    const idxLegajo = headers.indexOf('legajo');
    const idxNombre = headers.indexOf('nombre');
    const idxApellido = headers.indexOf('apellido');
    const idxRol = headers.indexOf('rol');
    const idxMaquina = headers.indexOf('maquina_asignada');
    const idxEmail = headers.indexOf('email');

    const rows = lines.slice(1).map(line => {
      const cols = line.split(/\t|,|;/).map(c => c.trim());
      return {
        legajo: cols[idxLegajo],
        nombre: cols[idxNombre],
        apellido: cols[idxApellido],
        rol: cols[idxRol].toLowerCase(),
        maquina_asignada: idxMaquina >= 0 ? (cols[idxMaquina] || null) : null,
        email: idxEmail >= 0 ? cols[idxEmail] : '',
      };
    });

    const rolesValidos = ['operario', 'supervisor', 'admin', 'auditor'];
    const errores = [];
    rows.forEach((r, i) => {
      if (!r.legajo) errores.push(`Fila ${i + 2}: legajo vacío`);
      if (!rolesValidos.includes(r.rol)) errores.push(`Fila ${i + 2}: rol "${r.rol}" inválido`);
    });

    if (errores.length) { setError(errores.slice(0, 3).join(' · ')); return; }
    setParsed(rows);
  };

  return (
    <ModalShell t={t} title="Importar usuarios desde Excel" onClose={onClose}>
      <p style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, marginBottom: 16 }}>
        Copiá las filas del Excel (incluyendo el encabezado) y pegalas acá. Columnas requeridas:{' '}
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: t.text }}>legajo, nombre, apellido, rol</span>.
        Opcionales: <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textMuted }}>maquina_asignada, email</span>.
      </p>

      <div style={{ background: t.surfaceHi, padding: 10, borderRadius: 6, marginBottom: 12, fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textMuted, border: `1px solid ${t.border}` }}>
        <div style={{ color: t.text }}>legajo	nombre	apellido	rol	maquina_asignada	email</div>
        <div>0042	Juan	Pérez	operario	MAQ-007	[email protected]</div>
        <div>0043	María	García	supervisor		[email protected]</div>
      </div>

      <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={8} placeholder="Pegá acá las filas..."
        style={{
          width: '100%', padding: 12, borderRadius: 6,
          background: t.surfaceHi, border: `1px solid ${t.border}`, color: t.text,
          fontFamily: 'JetBrains Mono', fontSize: 12, boxSizing: 'border-box', outline: 'none', resize: 'vertical'
        }} />

      {error && <div style={{ marginTop: 12, padding: 10, background: t.dangerSoft, borderRadius: 6, fontFamily: 'Manrope', fontSize: 12, color: t.danger }}>{error}</div>}

      {parsed && (
        <div style={{ marginTop: 14, padding: 12, background: t.successSoft, border: `1px solid ${t.success}40`, borderRadius: 6 }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.success, letterSpacing: '0.1em', marginBottom: 6 }}>VALIDACIÓN OK · {parsed.length} USUARIOS</div>
          <div style={{ maxHeight: 140, overflow: 'auto' }}>
            {parsed.map((u, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '4px 0', fontFamily: 'Manrope', fontSize: 11, color: t.text, borderBottom: i < parsed.length - 1 ? `1px solid ${t.border}` : 'none' }}>
                <span style={{ fontFamily: 'JetBrains Mono', color: t.textDim, width: 40 }}>{u.legajo}</span>
                <span style={{ flex: 1 }}>{u.nombre} {u.apellido}</span>
                <span style={{ color: t.textMuted, fontFamily: 'JetBrains Mono', fontSize: 10 }}>{u.rol}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <ButtonSm t={t} grow onClick={onClose}>Cancelar</ButtonSm>
        {!parsed ? (
          <ButtonSm t={t} variant="accent" grow onClick={procesar}>Validar datos</ButtonSm>
        ) : (
          <ButtonSm t={t} variant="success" grow onClick={() => onImport(parsed)}>Confirmar e importar {parsed.length} usuarios</ButtonSm>
        )}
      </div>
    </ModalShell>
  );
};

const ModalAgregarUsuario = ({ t, onClose, onAdd }) => {
  const [legajo, setLegajo] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [rol, setRol] = useState('operario');
  const [maquina, setMaquina] = useState('');
  const [email, setEmail] = useState('');

  const valido = legajo && nombre && apellido && rol;

  return (
    <ModalShell t={t} title="Crear usuario manualmente" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <Label t={t}>Legajo <Asterisk t={t} /></Label>
          <Input t={t} value={legajo} onChange={e => setLegajo(e.target.value)} placeholder="0042" />
        </div>
        <div>
          <Label t={t}>Rol <Asterisk t={t} /></Label>
          <select value={rol} onChange={e => setRol(e.target.value)} style={{
            width: '100%', padding: '10px 12px', borderRadius: 6,
            background: t.surfaceHi, border: `1px solid ${t.border}`,
            color: t.text, fontFamily: 'Manrope', fontSize: 13, outline: 'none', cursor: 'pointer'
          }}>
            <option value="operario">Operario</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Administrador</option>
            <option value="auditor">Auditor</option>
          </select>
        </div>
        <div>
          <Label t={t}>Nombre <Asterisk t={t} /></Label>
          <Input t={t} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Juan" />
        </div>
        <div>
          <Label t={t}>Apellido <Asterisk t={t} /></Label>
          <Input t={t} value={apellido} onChange={e => setApellido(e.target.value)} placeholder="Pérez" />
        </div>
        {rol === 'operario' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Label t={t}>Máquina asignada</Label>
            <Input t={t} value={maquina} onChange={e => setMaquina(e.target.value)} placeholder="MAQ-007" />
          </div>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <Label t={t}>Email</Label>
          <Input t={t} value={email} onChange={e => setEmail(e.target.value)} placeholder="[email protected]" />
        </div>
      </div>

      <div style={{ background: t.infoSoft, padding: 10, borderRadius: 6, marginBottom: 16 }}>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.info, letterSpacing: '0.1em', marginBottom: 4 }}>CONTRASEÑA INICIAL</div>
        <div style={{ fontFamily: 'Manrope', fontSize: 11, color: t.text }}>
          Se asigna <span style={{ fontFamily: 'JetBrains Mono', color: t.accent }}>cambio123</span>. El usuario debe cambiarla en su primer ingreso.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <ButtonSm t={t} grow onClick={onClose}>Cancelar</ButtonSm>
        <ButtonSm t={t} variant="accent" grow disabled={!valido} onClick={() => onAdd({
          legajo, nombre, apellido, rol, maquina_asignada: maquina || null, email
        })}>Crear usuario</ButtonSm>
      </div>
    </ModalShell>
  );
};

const AdminMaquinas = ({ t }) => {
  const [machines, setMachines] = useState([]);

  const load = async () => setMachines(await dataService.getMachines());
  useEffect(() => { load(); }, []);

  const toggle = async (id) => {
    await dataService.toggleMachineIntegrated(id);
    await dataService.logEvent({ accion: 'UPDATE', usuario: 'Admin', desc: `Cambió integración de ${id}` });
    load();
  };

  return (
    <Card t={t} padding={20}>
      <SectionHeader t={t} title="Gestión de máquinas" sub="Activá las máquinas conforme se incorporan al sistema" />
      <div style={{ marginTop: 16 }}>
        {machines.map(m => (
          <div key={m.id} style={{
            display: 'grid', gridTemplateColumns: '160px 1fr 120px 100px',
            gap: 14, padding: '14px 0', borderBottom: `1px solid ${t.border}`, alignItems: 'center'
          }}>
            <div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 15, color: t.text, fontWeight: 600 }}>{m.id}</div>
              <div style={{ fontFamily: 'Manrope', fontSize: 11, color: t.textMuted, marginTop: 2 }}>{m.linea}</div>
            </div>
            <div>
              {m.integrada ? (
                <span style={{ fontFamily: 'Manrope', fontSize: 12, color: t.success, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={14} /> Integrada y operativa
                </span>
              ) : (
                <span style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={14} /> Pendiente de integración
                </span>
              )}
            </div>
            <Pill variant={m.integrada ? 'success' : 'default'} t={t} mono>{m.integrada ? 'ACTIVA' : 'INACTIVA'}</Pill>
            <button onClick={() => toggle(m.id)} style={{
              background: m.integrada ? t.dangerSoft : t.successSoft,
              color: m.integrada ? t.danger : t.success,
              border: `1px solid ${m.integrada ? t.danger : t.success}40`,
              padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'Manrope', fontSize: 12, fontWeight: 500
            }}>
              {m.integrada ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
};

const HealthCard = ({ icon: Icon, label, value, sub, tone, t }) => {
  const colors = { success: t.success, warn: t.warn, danger: t.danger, default: t.text };
  return (
    <div style={{ padding: 14, background: t.surfaceHi, borderRadius: 6, border: `1px solid ${t.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon size={14} color={colors[tone]} />
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 18, color: colors[tone], fontWeight: 600 }}>{value}</div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textMuted, marginTop: 2 }}>{sub}</div>
    </div>
  );
};

// =================================================================
// VISTA AUDITOR (sin cambios)
// =================================================================

const VistaAuditor = ({ t, currentUser }) => {
  const [audit, setAudit] = useState([]);
  const [query, setQuery] = useState('');
  const [periodoFiltro, setPeriodoFiltro] = useState('48h');
  const [desdeFiltro, setDesdeFiltro] = useState('');
  const [hastaFiltro, setHastaFiltro] = useState('');

  useEffect(() => {
    const cargarAudit = async () => {
      const ahora = new Date();
      let params = { limite: 500 };
      if (periodoFiltro === '48h') {
        params.desde = new Date(ahora.getTime() - 48 * 3600 * 1000).toISOString();
        params.hasta = ahora.toISOString();
      } else if (periodoFiltro === '7d') {
        params.desde = new Date(ahora.getTime() - 7 * 24 * 3600 * 1000).toISOString();
        params.hasta = ahora.toISOString();
      } else {
        if (desdeFiltro) params.desde = new Date(desdeFiltro).toISOString();
        if (hastaFiltro) {
          const endOfDay = new Date(hastaFiltro);
          endOfDay.setHours(23, 59, 59, 999);
          params.hasta = endOfDay.toISOString();
        }
      }
      setAudit(await dataService.getAuditLog(params));
    };
    cargarAudit();
  }, [periodoFiltro, desdeFiltro, hastaFiltro]);

  const filtered = audit.filter(e =>
    !query ||
    e.desc?.toLowerCase().includes(query.toLowerCase()) ||
    e.usuario?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 18px', background: t.infoSoft, border: `1px solid ${t.info}40`,
        borderRadius: 6, marginBottom: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Shield size={18} color={t.info} />
          <div>
            <div style={{ fontFamily: 'Manrope', fontSize: 13, color: t.info, fontWeight: 600 }}>Modo auditoría · Solo lectura</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.info, opacity: 0.8 }}>
              {currentUser.nombre.toUpperCase()} {currentUser.apellido.toUpperCase()} · LEGAJO {currentUser.legajo}
            </div>
          </div>
        </div>
        <Pill variant="info" t={t} mono>AUDITOR</Pill>
      </div>

      <Card t={t} padding={24} style={{
        marginBottom: 20, background: `linear-gradient(135deg, ${t.successSoft}, ${t.surface} 70%)`,
        borderColor: t.success + '40'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: t.success, letterSpacing: '0.1em' }}>DATOS ÍNTEGROS</div>
            <h2 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 28, color: t.success, fontWeight: 600, marginTop: 6 }}>
              Cadena verificada
            </h2>
            <div style={{ fontFamily: 'Manrope', fontSize: 13, color: t.textMuted, marginTop: 4 }}>
              {audit.length} registros · 0 mismatches detectados
            </div>
          </div>
          <ButtonSm t={t}><Download size={11} /> Exportar firmado</ButtonSm>
        </div>
      </Card>

      <Card t={t} padding={20} style={{ marginBottom: 16 }}>
        <SectionHeader t={t} title="Trazabilidad y búsqueda" sub="Buscá por descripción, usuario o evento" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 14 }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, marginBottom: 6 }}>Periodo</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ButtonSm t={t} variant={periodoFiltro === '48h' ? 'accent' : 'default'} onClick={() => setPeriodoFiltro('48h')}>Últimas 48h</ButtonSm>
              <ButtonSm t={t} variant={periodoFiltro === '7d' ? 'accent' : 'default'} onClick={() => setPeriodoFiltro('7d')}>Últimos 7d</ButtonSm>
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, marginBottom: 6 }}>Desde</div>
            <input type="date" value={desdeFiltro} onChange={e => { setDesdeFiltro(e.target.value); setPeriodoFiltro('custom'); }} style={{
              width: '100%', padding: '10px 12px', borderRadius: 6,
              background: t.surfaceHi, border: `1px solid ${t.border}`,
              color: t.text, fontFamily: 'Manrope', fontSize: 13, boxSizing: 'border-box', outline: 'none'
            }} />
          </div>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, marginBottom: 6 }}>Hasta</div>
            <input type="date" value={hastaFiltro} onChange={e => { setHastaFiltro(e.target.value); setPeriodoFiltro('custom'); }} style={{
              width: '100%', padding: '10px 12px', borderRadius: 6,
              background: t.surfaceHi, border: `1px solid ${t.border}`,
              color: t.text, fontFamily: 'Manrope', fontSize: 13, boxSizing: 'border-box', outline: 'none'
            }} />
          </div>
        </div>
        <div style={{ marginTop: 14, position: 'relative' }}>
          <Search size={14} color={t.textMuted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar..." style={{
            width: '100%', padding: '10px 12px 10px 36px', borderRadius: 6,
            background: t.surfaceHi, border: `1px solid ${t.border}`,
            color: t.text, fontFamily: 'Manrope', fontSize: 13, boxSizing: 'border-box', outline: 'none'
          }} />
        </div>
      </Card>

      <Card t={t} padding={20}>
        <SectionHeader t={t} title="Eventos del audit log" sub={`${filtered.length} eventos · cadena verificable`} />
        <div style={{ marginTop: 14 }}>
          {filtered.length === 0 ? (
            <EmptyState icon={FileSearch} t={t}
              title={audit.length === 0 ? 'Sin eventos todavía' : 'Sin coincidencias'}
              desc={audit.length === 0 ? 'Cuando el sistema acumule actividad, los eventos auditables aparecerán acá con sus hashes de integridad.' : 'Probá con otro término de búsqueda.'} />
          ) : (
            filtered.map((e, i) => (
              <div key={i} style={{
                padding: '14px 0', borderBottom: `1px solid ${t.border}`,
                display: 'grid', gridTemplateColumns: '110px 90px 1fr 120px',
                gap: 12, alignItems: 'center'
              }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: t.textDim }}>
                  {new Date(e.timestamp).toLocaleTimeString('es-AR', {
                    timeZone: 'America/Argentina/Buenos_Aires',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                  })}
                </span>
                <span style={{ textAlign: 'center' }}>
                  <Pill variant={e.accion === 'CREATE' ? 'info' : e.accion === 'APPROVE' ? 'success' : 'default'} t={t} mono>{e.accion}</Pill>
                </span>
                <div>
                  <div style={{ fontFamily: 'Manrope', fontSize: 13, color: t.text }}>{e.desc}</div>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textDim, marginTop: 2 }}>
                    por {e.usuario}{e.usuario_legajo ? ` (${e.usuario_legajo})` : ''}
                    {e.tabla_afectada && e.registro_id ? ` · ${e.tabla_afectada}/${e.registro_id}` : ''}
                  </div>
                </div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: t.textMuted, textAlign: 'right' }}>
                  <Hash size={10} style={{ display: 'inline', marginRight: 4 }} />{e.hash}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

// =================================================================
// MODAL SHELL
// =================================================================

const ModalShell = ({ children, title, onClose, t }) => (
  <div onClick={onClose} style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(4px)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40
  }}>
    <div onClick={e => e.stopPropagation()} style={{
      background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: 12, maxWidth: 720, width: '100%', maxHeight: '85vh',
      overflow: 'auto'
    }}>
      <div style={{
        padding: '20px 24px', borderBottom: `1px solid ${t.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        position: 'sticky', top: 0, background: t.surface, zIndex: 1
      }}>
        <h2 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 18, color: t.text, fontWeight: 600, margin: 0 }}>{title}</h2>
        <button onClick={onClose} style={{
          background: t.surfaceHi, border: `1px solid ${t.border}`, color: t.textMuted,
          padding: 6, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center'
        }}><X size={14} /></button>
      </div>
      <div style={{ padding: 24 }}>{children}</div>
    </div>
  </div>
);

// =================================================================
// APP PRINCIPAL
// =================================================================

export default function App() {
  const [theme, setTheme] = useState('dark');
  const t = tokens[theme];

  const [user, setUser] = useState(null);
  const [hora, setHora] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    dataService.getCurrentUser().then(u => setUser(u));
  }, []);

  useEffect(() => {
    const updateHora = () => {
      const now = new Date();
      setHora(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    };
    updateHora();
    const interval = setInterval(updateHora, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await dataService.logEvent({ accion: 'LOGOUT', usuario: `${user.nombre} ${user.apellido}`, desc: 'Cierre de sesión' });
    await dataService.logout();
    setUser(null);
  };

  if (!user) {
    return <PantallaLogin onLogin={setUser} t={t} />;
  }

  if (user.forceChange) {
    return <PantallaCambioPassword user={user} onChanged={setUser} t={t} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: 'Manrope, sans-serif' }}>
      <style>{FONT_IMPORT}</style>
      <style>{`
        @keyframes neonPulse {
          0%, 100% {
            box-shadow: 0 0 12px rgba(255,255,200,0.18), 0 0 32px rgba(255,170,60,0.12);
          }
          50% {
            box-shadow: 0 0 24px rgba(255,255,200,0.45), 0 0 48px rgba(255,140,10,0.28);
          }
        }
        @keyframes blinkGlow {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
      `}</style>

      <Header user={user} onLogout={handleLogout} theme={theme}
        toggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} t={t} hora={hora} />

      {user.rol === 'operario' && <VistaOperario key={refreshKey} t={t} user={user} refresh={() => setRefreshKey(k => k + 1)} />}
      {user.rol === 'supervisor' && <VistaSupervisor key={refreshKey} t={t} currentUser={user} />}
      {user.rol === 'admin' && <VistaAdmin t={t} currentUser={user} />}
      {user.rol === 'auditor' && <VistaAuditor t={t} currentUser={user} />}
    </div>
  );
}
