import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarSenalManual, crearAlmacenSenales, LIMITE_PENDIENTE_MS } from '../src/domain/senalesManuales.js';

const fecha = '2026-11-05T10:00:00.000Z';
const senal = { maquina: 'MAQ-010', fechaSenal: fecha, requestId: 'id-1' };
const ahora = Date.parse(fecha);
function storage() {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k,v) => m.set(k,v), removeItem: k => m.delete(k), raw: m };
}

test('activa hasta el límite; vencida exactamente a 60 minutos', () => {
  assert.equal(evaluarSenalManual(senal, 'MAQ-010', ahora + LIMITE_PENDIENTE_MS - 1).estado, 'ACTIVA');
  assert.equal(evaluarSenalManual(senal, 'MAQ-010', ahora + LIMITE_PENDIENTE_MS).estado, 'VENCIDA');
});
test('no convierte señal malformada, ajena ni futura en prueba', () => {
  for (const [s,m,t] of [[{ ...senal, fechaSenal: 'invalid' },'MAQ-010',ahora], [senal,'MAQ-011',ahora], [senal,'MAQ-010',ahora-360000]]) {
    assert.equal(evaluarSenalManual(s,m,t).estado, 'INVALIDA');
  }
  assert.equal(evaluarSenalManual(null,'MAQ-010',ahora).estado, 'AUSENTE');
});
test('almacenamiento por legajo y máquina: no pisa una señal existente', () => {
  const st = storage(), a = crearAlmacenSenales(st,'OP1'), b = crearAlmacenSenales(st,'OP2');
  assert.equal(a.guardar('MAQ-010',senal).ok,true);
  assert.equal(a.guardar('MAQ-010',{...senal,requestId:'id-2'}).ok,false);
  assert.equal(b.leer('MAQ-010').senal,null);
  assert.equal(a.leer('MAQ-010').senal.requestId,'id-1');
});
test('un ACK viejo no borra una señal distinta', () => {
  const st=storage(), a=crearAlmacenSenales(st,'OP1');
  a.guardar('MAQ-010',senal);
  assert.equal(a.eliminarSiCoincide('MAQ-010','id-2'),false);
  assert.equal(a.leer('MAQ-010').senal.requestId,'id-1');
  assert.equal(a.eliminarSiCoincide('MAQ-010','id-1'),true);
  assert.equal(a.leer('MAQ-010').senal,null);
});
test('la migración de identificador exige comparar el valor anterior', () => {
  const st=storage(),a=crearAlmacenSenales(st,'OP1');
  a.guardar('MAQ-010',{maquina:'MAQ-010',fechaSenal:fecha});
  assert.equal(a.actualizarSiCoincide('MAQ-010',senal,'id-distinto').ok,false);
  assert.equal(a.actualizarSiCoincide('MAQ-010',senal,null).ok,true);
  assert.equal(a.leer('MAQ-010').senal.requestId,'id-1');
});
test('almacenamiento no disponible no confirma el guardado ni borra', () => {
  const st={getItem(){return null;},setItem(){throw new Error('quota');},removeItem(){throw new Error('no');}};
  const a=crearAlmacenSenales(st,'OP1');
  assert.equal(a.guardar('MAQ-010',senal).ok,false);
  assert.equal(a.eliminarSiCoincide('MAQ-010','id-1'),false);
});
test('JSON inválido se informa sin eliminarlo', () => {
  const st=storage();st.setItem('senal_plc_OP1_MAQ-010','{bad json');
  const a=crearAlmacenSenales(st,'OP1');
  assert.match(a.leer('MAQ-010').error,/no se pudo leer/i);
  assert.equal(st.getItem('senal_plc_OP1_MAQ-010'),'{bad json');
});
