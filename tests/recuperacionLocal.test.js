import test from 'node:test';
import assert from 'node:assert/strict';
import { crearAlmacenSenales } from '../src/domain/senalesManuales.js';
import { crearAlmacenBorradores } from '../src/domain/borradorEstanqueidad.js';
import { crearAlmacenIntentos } from '../src/domain/intentosRegistro.js';
import { inspeccionarRegistrosLocales, limpiarTrasConfirmacion, recuperarEstadoLocal } from '../src/domain/recuperacionLocal.js';

function memoria() {
  const map = new Map();
  return { getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k), map };
}
const maquinaId='MAQ-010', requestId='84e625d1-2c1b-4f8a-a643-7e98b437c99f';
const senal={maquina:maquinaId,requestId,fechaSenal:'2026-11-05T10:00:00.000Z'};
const payload={id_maquina:maquinaId,request_id:requestId,resultado:'OK'};
const fixture=()=>{
 const storage=memoria();
 const senales=crearAlmacenSenales(storage,'OP');
 const borradores=crearAlmacenBorradores(storage,'OP');
 const intentos=crearAlmacenIntentos(storage,'OP');
 return {storage,maquinaId,senales,borradores,intentos};
};
test('sin registros no declara huérfanos',()=>{
 assert.equal(inspeccionarRegistrosLocales(fixture()).estado,'LIBRE');
});
test('una señal con borrador válido queda abierta',()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 f.borradores.guardar(maquinaId,requestId,{caja:'33'});
 assert.equal(inspeccionarRegistrosLocales(f).estado,'ABIERTA');
});
test('intento previo requiere consultar el servidor',async()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 f.intentos.preparar(maquinaId,requestId,payload);
 const r=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'INCIERTO'})});
 assert.equal(r.estado,'INCIERTO');
 assert.equal(f.senales.leer(maquinaId).senal.requestId,requestId);
});
test('ACK confirmado limpia todas las piezas del mismo UUID',async()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 f.borradores.guardar(maquinaId,requestId,{caja:'33'});
 f.intentos.preparar(maquinaId,requestId,payload);
 const r=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'CONFIRMADA',pruebaId:'db-100'})});
 assert.equal(r.estado,'CONFIRMADA_LIMPIA');
 assert.equal(inspeccionarRegistrosLocales(f).estado,'LIBRE');
});
test('si falla la limpieza se informa confirmado con residuos y no se pierde evidencia',async()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 f.borradores.guardar(maquinaId,requestId,{caja:'33'});
 f.intentos.preparar(maquinaId,requestId,payload);
 // Simula una falla de removeItem para borrador después de eliminar señal.
 const rm=f.storage.removeItem;
 f.storage.removeItem=k=>{if(k.startsWith('spc_borrador_'))throw Error('disco bloqueado');rm(k)};
 const r=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'CONFIRMADA',pruebaId:'db-100'})});
 assert.equal(r.estado,'CONFIRMADA_CON_RESIDUOS');
 assert.equal(f.intentos.leer(maquinaId).requestId,requestId);
 f.storage.removeItem=rm;
 const retry=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'CONFIRMADA',pruebaId:'db-100'})});
 assert.equal(retry.estado,'CONFIRMADA_LIMPIA');
});
test('un borrador sin señal no se descarta sin consultar al servidor',async()=>{
 const f=fixture();f.borradores.guardar(maquinaId,requestId,{caja:'33'});
 assert.equal(inspeccionarRegistrosLocales(f).estado,'HUERFANO');
 const revision=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'NO_ENCONTRADA'})});
 assert.equal(revision.estado,'INTERVENCION');
 assert.equal(f.borradores.inspeccionar(maquinaId).requestId,requestId);
});
test('borrador huérfano con prueba confirmada puede limpiarse sin perder otros UUID',async()=>{
 const f=fixture();f.borradores.guardar(maquinaId,requestId,{caja:'33'});
 const revision=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'CONFIRMADA',pruebaId:'db-confirmado'})});
 assert.equal(revision.estado,'CONFIRMADA_LIMPIA');
 assert.equal(f.borradores.inspeccionar(maquinaId).borrador,null);
});
test('identificadores cruzados bloquean toda eliminación',()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 f.borradores.guardar(maquinaId,'uuid-otro',{caja:'33'});
 const r=limpiarTrasConfirmacion({...f,requestId,pruebaId:'db-100'});
 assert.equal(r.estado,'INTERVENCION');
 assert.equal(f.senales.leer(maquinaId).senal.requestId,requestId);
});
test('un intento huérfano confirmado se limpia; si no hay confirmación se conserva',async()=>{
 const f=fixture();f.intentos.preparar(maquinaId,requestId,payload);
 let r=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'NO_ENCONTRADA'})});
 assert.equal(r.estado,'INTERVENCION');
 assert.equal(f.intentos.leer(maquinaId).requestId,requestId);
 r=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'CONFIRMADA',pruebaId:'db-5'})});
 assert.equal(r.estado,'CONFIRMADA_LIMPIA');
 assert.equal(f.intentos.leer(maquinaId),null);
});
test('una prueba no se limpia sin confirmación',()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 assert.equal(limpiarTrasConfirmacion({...f,requestId,pruebaId:null}).estado,'INTERVENCION');
 assert.ok(f.senales.leer(maquinaId).senal);
});
test('malformación de borrador no autoriza limpieza',()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 f.storage.setItem('spc_borrador_v1_OP_MAQ-010','{corrupto');
 assert.equal(inspeccionarRegistrosLocales(f).estado,'INTERVENCION');
});

test('sin confirmación, la señal y el intento siguen disponibles para reintentar',async()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 f.intentos.preparar(maquinaId,requestId,payload);
 const r=await recuperarEstadoLocal({...f,consultar:async()=>({estado:'NO_ENCONTRADA'})});
 assert.equal(r.estado,'ENVIO_PREVIO');
 assert.equal(f.senales.leer(maquinaId).senal.requestId,requestId);
 assert.equal(f.intentos.leer(maquinaId).requestId,requestId);
});
test('no limpia si falla la eliminación de la señal',()=>{
 const f=fixture();f.senales.guardar(maquinaId,senal);
 f.intentos.preparar(maquinaId,requestId,payload);
 f.storage.removeItem=()=>{throw Error('bloqueado')};
 const r=limpiarTrasConfirmacion({...f,requestId,pruebaId:'db-123'});
 assert.equal(r.estado,'CONFIRMADA_CON_RESIDUOS');
 assert.equal(f.intentos.leer(maquinaId).requestId,requestId);
});

test('la respuesta remota tardía NO borra evidencia si se perdió Web Lock',async()=>{
 const f=fixture();
 f.senales.guardar(maquinaId,senal);
 f.borradores.guardar(maquinaId,requestId,{caja:'33'});
 f.intentos.preparar(maquinaId,requestId,payload);
 let completar;
 let permiso=true;
 const resultado=recuperarEstadoLocal({
   ...f,
   puedeModificar:()=>permiso,
   consultar:()=>new Promise(resolve=>{completar=resolve}),
 });
 // Dejar comenzar la consulta sin necesidad de navegar ni crear servidor real.
 await Promise.resolve();
 assert.equal(typeof completar,'function');
 permiso=false;
 completar({estado:'CONFIRMADA',pruebaId:'db-100'});
 const r=await resultado;
 assert.equal(r.estado,'INCIERTO');
 assert.equal(f.senales.leer(maquinaId).senal.requestId,requestId);
 assert.equal(f.borradores.inspeccionar(maquinaId).requestId,requestId);
 assert.equal(f.intentos.leer(maquinaId).requestId,requestId);
});
test('sin lock desde el inicio no hace consulta remota ni modifica evidencias',async()=>{
 const f=fixture();
 f.senales.guardar(maquinaId,senal);
 f.intentos.preparar(maquinaId,requestId,payload);
 let llamadas=0;
 const r=await recuperarEstadoLocal({
   ...f,puedeModificar:()=>false,
   consultar:async()=>{llamadas++;return {estado:'CONFIRMADA',pruebaId:'db-100'}},
 });
 assert.equal(r.estado,'INCIERTO');
 assert.equal(llamadas,0);
 assert.equal(f.intentos.leer(maquinaId).requestId,requestId);
});
