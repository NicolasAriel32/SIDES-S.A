import test from 'node:test';
import assert from 'node:assert/strict';
import { conBloqueoDePrueba, consultarConfirmacionPrueba } from '../src/domain/reconciliacionPruebas.js';

test('sin Web Locks falla cerrado',async()=>{
 await assert.rejects(conBloqueoDePrueba(null,'OP','M','id',async()=>true),/no admite bloqueo/i);
});
test('dos pestañas no ejecutan simultáneamente la operación',async()=>{
 let ocupado=false,liberar;
 const manager={request:async (_n,_o,fn)=>{if(ocupado)return fn(null);ocupado=true;try{return await fn({name:'lock'});}finally{ocupado=false;}}};
 const a=conBloqueoDePrueba(manager,'OP','M','id',async()=>new Promise(r=>{liberar=r;}));
 await assert.rejects(conBloqueoDePrueba(manager,'OP','M','id',async()=>false),/otra pestaña/i);
 liberar('guardado');assert.equal(await a,'guardado');
});
test('reconciliación reconoce confirmación',async()=>{
 const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'prueba',numero_secuencial:42},error:null})})})})};
 const r=await consultarConfirmacionPrueba(client,'uuid');assert.equal(r.estado,'CONFIRMADA');assert.equal(r.pruebaId,'prueba');
});
test('error de lectura nunca se confunde con no encontrada',async()=>{
 const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:{message:'RLS'}})})})})};
 assert.equal((await consultarConfirmacionPrueba(client,'uuid')).estado,'INCIERTO');
});
test('lectura válida sin fila permite revisión del reintento',async()=>{
 const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})};
 assert.equal((await consultarConfirmacionPrueba(client,'uuid')).estado,'NO_ENCONTRADA');
});
