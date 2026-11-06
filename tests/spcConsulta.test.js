import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consultarSpcPiloto, normalizarPruebaSpc, ESTADOS_CONSULTA_SPC,
} from '../src/api/spcDescriptivo.js';
import { resumirSpcPiloto } from '../src/domain/spcDescriptivo.js';

const DESDE = '2026-11-01T00:00:00Z';
const HASTA = '2026-11-06T00:00:00Z';
const registro = (id, extra = {}) => ({
  id, id_maquina: 'MAQ-010', created_at: '2026-11-05T12:00:00',
  codigo_producto: 'RCE-310C-CE',
  resultado: 'OK', estado_final: 'APROBADA',
  cantidad_cabezales_afectados: 0,
  spc_cabezales_inspeccionados: 20,
  spc_uso_estadistico: 'NO_VALIDADO',
  spc_origen_evento: 'MANUAL_NO_OT',
  fallas: [], ...extra,
});

// Simula la secuencia .select().eq().gte().lte().order().range() sin tocar Supabase.
function cliente(paginas) {
  const solicitudes = [];
  return {
    solicitudes,
    from(tabla) {
      assert.equal(tabla, 'pruebas');
      const q = {
        select(campos, opts) {
          assert.match(campos, /spc_cabezales_inspeccionados/);
          assert.match(campos, /pruebas_fallas/);
          assert.equal(opts.count, 'exact');
          return q;
        },
        eq(campo, valor) {
          assert.deepEqual([campo, valor], ['id_maquina', 'MAQ-010']);
          return q;
        },
        gte(campo) { assert.equal(campo, 'created_at'); return q; },
        lte(campo) { assert.equal(campo, 'created_at'); return q; },
        order() { return q; },
        range(inicio, fin) {
          solicitudes.push([inicio, fin]);
          return paginas.shift() ?? { data: [], error: null, count: 0 };
        },
      };
      return q;
    },
  };
}

const consultar = (supabase, opciones = {}) =>
  consultarSpcPiloto(supabase, { desde: DESDE, hasta: HASTA, ...opciones });

test('consulta de cero registros es completa y no significa 0% defectuoso', async () => {
  const c = cliente([{ data: [], count: 0, error: null }]);
  const r = await consultar(c);
  assert.equal(r.estado, ESTADOS_CONSULTA_SPC.COMPLETO);
  assert.equal(r.recuperados, 0);
  assert.equal(resumirSpcPiloto(r.rows).porProducto.length, 0);
  assert.deepEqual(c.solicitudes, [[0, 99]]);
});

test('paginación con cuenta exacta trae 3 registros en 2 páginas', async () => {
  const c = cliente([
    { data: [registro('a'), registro('b')], count: 3, error: null },
    { data: [registro('c')], count: 3, error: null },
  ]);
  const r = await consultar(c, { tamanoPagina: 2 });
  assert.equal(r.estado, ESTADOS_CONSULTA_SPC.COMPLETO);
  assert.equal(r.recuperados, 3);
  assert.deepEqual(c.solicitudes, [[0, 1], [2, 3]]);
  assert.equal(r.rows[0].aptitudSpc, 'NO_VALIDADO');
});

test('error de base en segunda página no presenta primera como lista completa', async () => {
  const c = cliente([
    { data: [registro('a')], count: 2, error: null },
    { data: null, count: null, error: { code: '42501' } },
  ]);
  const r = await consultar(c, { tamanoPagina: 1 });
  assert.equal(r.estado, 'ERROR');
  assert.equal(r.recuperados, 0);
  assert.equal(r.codigo, 'CONSULTA_FALLIDA');
});

test('si cambia el count entre páginas marca PARCIAL', async () => {
  const c = cliente([
    { data: [registro('a')], count: 3, error: null },
    { data: [registro('b')], count: 4, error: null },
  ]);
  const r = await consultar(c, { tamanoPagina: 1 });
  assert.equal(r.estado, 'PARCIAL');
  assert.equal(r.recuperados, 1);
});

test('sin count exacto no se afirma que los datos están completos', async () => {
  const c = cliente([{ data: [registro('a')], count: null, error: null }]);
  const r = await consultar(c);
  assert.equal(r.estado, 'ERROR');
  assert.equal(r.codigo, 'RESPUESTA_INVALIDA');
});

test('cuando alcanza máximo de filas retorna PARCIAL', async () => {
  const c = cliente([{ data: [registro('a'), registro('b')], count: 5, error: null }]);
  const r = await consultar(c, { tamanoPagina: 2, maxFilas: 2 });
  assert.equal(r.estado, 'PARCIAL');
  assert.equal(r.codigo, 'LIMITE_DE_REGISTROS');
});

test('respuesta con fila de otra máquina se rechaza como ERROR', async () => {
  const c = cliente([{ data: [registro('a', { id_maquina: 'MAQ-011' })], count: 1, error: null }]);
  const r = await consultar(c);
  assert.equal(r.estado, 'ERROR');
  assert.equal(r.codigo, 'RESPUESTA_INVALIDA');
});

test('fallas no-array o payload malformado no se publican', async () => {
  const c = cliente([{ data: [registro('a', { fallas: 'texto' })], count: 1, error: null }]);
  const r = await consultar(c);
  assert.equal(r.estado, 'ERROR');
  assert.equal(r.codigo, 'DETALLE_INVALIDO');
});

test('prueba sin zona horaria inequívoca queda sin fecha apta SPC', () => {
  const n = normalizarPruebaSpc(registro('a'));
  assert.equal(n.timestamp, null);
  assert.equal(n.estado, 'OK');
  assert.equal(n.cabezalesInspeccionados, 20);
  const zonificada = normalizarPruebaSpc(registro('b', { created_at: '2026-11-05T12:00:00Z' }));
  assert.equal(zonificada.timestamp, '2026-11-05T12:00:00Z');
});

test('no convierte NULL de cabezales defectuosos en 0 válido', () => {
  const n = normalizarPruebaSpc(registro('a', {
    created_at: '2026-11-05T12:00:00Z',
    cantidad_cabezales_afectados: null,
    spc_uso_estadistico: 'VALIDADO',
  }));
  const r = resumirSpcPiloto([n]);
  assert.equal(r.muestrasIncompletas, 1);
  assert.equal(r.muestrasAptas, 0);
});

test('un registro ANULADA no participa aunque tenga datos completos', () => {
  const n = normalizarPruebaSpc(registro('a', {
    created_at: '2026-11-05T12:00:00Z',
    estado_final: 'ANULADA',
    spc_uso_estadistico: 'VALIDADO',
  }));
  const r = resumirSpcPiloto([n]);
  assert.equal(r.pendientesONoEnsayos, 1);
  assert.equal(r.muestrasAptas, 0);
});

test('parámetros inválidos no ejecutan consultas', async () => {
  const c = cliente([]);
  assert.equal((await consultar(c, { hasta: 'fecha' })).codigo, 'PARAMETROS_INVALIDOS');
  assert.equal((await consultar(c, { maquina: 'MAQ-011' })).codigo, 'PARAMETROS_INVALIDOS');
  assert.deepEqual(c.solicitudes, []);
});

test('excepción de red se transforma en código genérico, sin filtrar mensajes', async () => {
  const s = { from() { throw new Error('token privado no debe mostrarse'); } };
  const r = await consultar(s);
  assert.equal(r.estado, 'ERROR');
  assert.equal(r.codigo, 'EXCEPCION_DE_LECTURA');
  assert.equal(JSON.stringify(r).includes('token privado'), false);
});

test('ID duplicado entre páginas no permite afirmar cobertura completa', async () => {
  const c = cliente([
    { data: [registro('a'), registro('b')], count: 4, error: null },
    { data: [registro('b'), registro('d')], count: 4, error: null },
  ]);
  const r = await consultar(c, { tamanoPagina: 2 });
  assert.equal(r.estado, 'PARCIAL');
  assert.equal(r.codigo, 'COBERTURA_INCIERTA');
  assert.equal(r.recuperados, 2);
});

test('ID duplicado dentro de una sola página también es cobertura incierta', async () => {
  const c = cliente([
    { data: [registro('a'), registro('a')], count: 2, error: null },
  ]);
  const r = await consultar(c, { tamanoPagina: 2 });
  assert.equal(r.estado, 'PARCIAL');
  assert.equal(r.codigo, 'COBERTURA_INCIERTA');
});
