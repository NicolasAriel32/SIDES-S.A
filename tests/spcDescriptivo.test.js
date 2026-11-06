import test from 'node:test';
import assert from 'node:assert/strict';
import { MAQUINA_PILOTO_SPC, resumirSpcPiloto } from '../src/domain/spcDescriptivo.js';

const base = (x = {}) => ({
  supabase_id: 'uuid-1', maquina: MAQUINA_PILOTO_SPC,
  codigoProducto: 'RCE-310C-CE', estado: 'RECHAZADO',
  estadoFinal: 'PENDIENTE_APROBACION', aptitudSpc: 'VALIDADO',
  cabezalesInspeccionados: 20, cabezalesFalla: 3,
  tipos: ['EST', 'CLV'], cantidadesTipos: { EST: 2, CLV: 2 },
  timestamp: '2026-11-05T14:00:00Z', ...x,
});

test('sin registros no informa 0% ni genera límites de control', () => {
  const r = resumirSpcPiloto([]);
  assert.equal(r.registrosRecuperados, 0);
  assert.deepEqual(r.porProducto, []);
  assert.equal(r.limitesControl, null);
  assert.equal(r.cumplimientoOT, null);
  assert.equal(r.alertasAutomaticas, false);
});
test('históricos y registros NO_VALIDADO quedan fuera de las tasas', () => {
  const r = resumirSpcPiloto([base({ aptitudSpc: 'NO_VALIDADO' }), base({ supabase_id: 'uuid-2', aptitudSpc: undefined })]);
  assert.equal(r.ensayosRegistrados, 2);
  assert.equal(r.muestrasAptas, 0);
  assert.equal(r.muestrasNoValidadas, 2);
  assert.equal(r.porProducto[0].proporcionDefectuosa, null);
});
test('sólo máquina piloto; no mezcla MAQ-011', () => {
  const r = resumirSpcPiloto([base(), base({ supabase_id: 'uuid-2', maquina: 'MAQ-011' })]);
  assert.equal(r.registrosRecuperados, 1);
  assert.equal(r.muestrasAptas, 1);
});
test('no mezcla productos ni agrega porcentajes individuales', () => {
  const r = resumirSpcPiloto([
    base(),
    base({ supabase_id: 'uuid-2', codigoProducto: 'RCL-294C-AZ', cabezalesFalla: 1, tipos: ['EST'], cantidadesTipos: { EST: 1 } }),
    base({ supabase_id: 'uuid-3', estado: 'OK', estadoFinal: 'APROBADA', cabezalesFalla: 0, tipos: [], cantidadesTipos: {} }),
  ]);
  assert.equal(r.muestrasAptas, 3);
  const a = r.porProducto.find(x => x.producto === 'RCE-310C-CE');
  const b = r.porProducto.find(x => x.producto === 'RCL-294C-AZ');
  assert.equal(a.cabezalesInspeccionados, 40);
  assert.equal(a.cabezalesDefectuosos, 3);
  assert.equal(a.proporcionDefectuosa, 3 / 40);
  assert.equal(b.proporcionDefectuosa, 1 / 20);
  assert.equal(r.proporcionDefectuosa, undefined);
});
test('pendientes y otros estados no son muestras', () => {
  const r = resumirSpcPiloto([
    base({ estado: 'PENDIENTE', estadoFinal: 'PENDIENTE' }),
    base({ supabase_id: 'uuid-2', estado: 'ANULADA' }),
    base({ supabase_id: 'uuid-3' }),
  ]);
  assert.equal(r.pendientesONoEnsayos, 2);
  assert.equal(r.ensayosRegistrados, 1);
});
test('20 inspeccionados explícitos; 0, null, otros tamaños o ausentes son incompletos', () => {
  for (const n of [0, 19, 21, null, undefined, '20']) {
    const r = resumirSpcPiloto([base({ cabezalesInspeccionados: n })]);
    assert.equal(r.muestrasAptas, 0);
    assert.equal(r.muestrasIncompletas, 1);
  }
});
test('RECHAZADO exige categorías y cantidades coherentes', () => {
  const r = resumirSpcPiloto([
    base({ tipos: [], cantidadesTipos: {} }),
    base({ supabase_id: 'uuid-2', cantidadesTipos: { EST: 1, CLV: 1 } }),
    base({ supabase_id: 'uuid-3', cabezalesFalla: 21 }),
  ]);
  assert.equal(r.muestrasAptas, 0);
  assert.equal(r.muestrasIncompletas, 3);
});
test('un cabezal con dos defectos representa una unidad defectuosa', () => {
  const r = resumirSpcPiloto([base({ cabezalesFalla: 1, cantidadesTipos: { EST: 1, CLV: 1 } })]);
  assert.equal(r.porProducto[0].cabezalesDefectuosos, 1);
  assert.equal(r.porProducto[0].proporcionDefectuosa, 1 / 20);
});
test('OK con conteos positivos es incompleto', () => {
  const r = resumirSpcPiloto([base({ estado: 'OK', cabezalesFalla: 3 })]);
  assert.equal(r.muestrasIncompletas, 1);
});
test('falta producto o timestamp: no se calcula tasa', () => {
  for (const x of [{ codigoProducto: null }, { timestamp: null }, { timestamp: 'fecha desconocida' }]) {
    const r = resumirSpcPiloto([base(x)]);
    assert.equal(r.muestrasAptas, 0);
    assert.equal(r.muestrasIncompletas, 1);
  }
});
test('IDs duplicados se excluyen aunque sean ensayos distintos', () => {
  const r = resumirSpcPiloto([base(), base({ codigoProducto: 'RCL-294C-AZ' })]);
  assert.equal(r.muestrasDuplicadas, 2);
  assert.equal(r.muestrasAptas, 0);
  assert.ok(r.porProducto.every(p => p.proporcionDefectuosa === null));
});
test('sin estado VALIDADO nunca presume aptitud por simulación o marca OT', () => {
  const r = resumirSpcPiloto([base({ aptitudSpc: 'NO_VALIDADO', origenEvento: 'OT_VERIFICADO' })]);
  assert.equal(r.muestrasNoValidadas, 1);
  assert.equal(r.muestrasAptas, 0);
});
test('entrada inválida es tolerada y no se atribuyen resultados', () => {
  assert.equal(resumirSpcPiloto(null).registrosRecuperados, 0);
  assert.equal(resumirSpcPiloto('no array').muestrasAptas, 0);
  assert.equal(resumirSpcPiloto([null, undefined, 5, {}]).registrosRecuperados, 0);
});
