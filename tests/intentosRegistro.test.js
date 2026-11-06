import test from 'node:test';
import assert from 'node:assert/strict';
import { crearAlmacenIntentos } from '../src/domain/intentosRegistro.js';
const payload = { request_id:'uuid-a',id_maquina:'MAQ-010',resultado:'RECHAZADO',cabezales_afectados:2,tipos:['EST'],cantidades_por_tipo:{EST:2} };
function almacen() { const x=new Map(); return {getItem:k=>x.get(k)??null,setItem:(k,v)=>x.set(k,v),removeItem:k=>x.delete(k),raw:x}; }
test('primer envío queda guardado antes de llamar a la red',()=>{
 const store=almacen(), a=crearAlmacenIntentos(store,'OP-1');
 const r=a.preparar('MAQ-010','uuid-a',payload);
 assert.equal(r.yaExistia,false);
 assert.deepEqual(a.leer('MAQ-010').payload,payload);
});
test('reintentos idénticos reutilizan UUID y carga',()=>{
 const a=crearAlmacenIntentos(almacen(),'OP-1');
 a.preparar('MAQ-010','uuid-a',payload);
 const v=a.preparar('MAQ-010','uuid-a',payload);
 assert.equal(v.yaExistia,true);assert.deepEqual(v.payload,payload);
});
test('bloquea variaciones y solicitudes competidoras antes de la red',()=>{
 const a=crearAlmacenIntentos(almacen(),'OP-1');
 a.preparar('MAQ-010','uuid-a',payload);
 assert.throws(()=>a.preparar('MAQ-010','uuid-a',{...payload,cabezales_afectados:3}),/otros valores/);
 assert.throws(()=>a.preparar('MAQ-010','uuid-b',{...payload,request_id:'uuid-b'}),/envío previo diferente/);
});
test('ACK viejo no elimina un intento distinto',()=>{
 const a=crearAlmacenIntentos(almacen(),'OP-1');a.preparar('MAQ-010','uuid-a',payload);
 assert.equal(a.borrarConfirmado('MAQ-010','uuid-b'),false);
 assert.equal(a.leer('MAQ-010').requestId,'uuid-a');
 assert.equal(a.borrarConfirmado('MAQ-010','uuid-a'),true);
 assert.equal(a.leer('MAQ-010'),null);
});
test('si localStorage falla no se puede transmitir',()=>{
 const a=crearAlmacenIntentos({getItem(){return null},setItem(){throw Error('quota')}},'OP');
 assert.throws(()=>a.preparar('MAQ-010','uuid-a',payload),/No se pudo conservar/);
});
test('la separación de máquinas y usuarios también aplica a intentos',()=>{
 const store=almacen(),a=crearAlmacenIntentos(store,'OP1'),b=crearAlmacenIntentos(store,'OP2');
 a.preparar('MAQ-010','uuid-a',payload);
 assert.equal(a.leer('MAQ-011'),null);
 assert.equal(b.leer('MAQ-010'),null);
});
test('un registro local corrupto jamás se reemplaza automáticamente',()=>{
 const s=almacen();s.setItem('spc_intento_v1_OP1_MAQ-010','{bad');
 const a=crearAlmacenIntentos(s,'OP1');
 assert.throws(()=>a.preparar('MAQ-010','uuid-a',payload),/no se puede leer el intento anterior/i);
 assert.equal(s.getItem('spc_intento_v1_OP1_MAQ-010'),'{bad');
});
