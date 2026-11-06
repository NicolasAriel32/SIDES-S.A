import test from 'node:test';
import assert from 'node:assert/strict';
import { guardarPruebaSegura, reintentarIntentoGuardado } from '../src/api/registroSeguro.js';
import { construirPayloadPruebaEstanqueidad } from '../src/api/estanqueidad.js';
import { crearAlmacenIntentos } from '../src/domain/intentosRegistro.js';
const testPayload={
 requestId:'84e625d1-2c1b-4f8a-a643-7e98b437c99f',
 maquina:'MAQ-010',legajoOperario:'OP1',fechaSenal:'2026-11-05T10:00:00.000Z',
 codigoProducto:'RCL-300C-RO',caja:'C1',lote:'L1',
 estado:'RECHAZADO',autoPendiente:false,cabezalesFalla:2,
 tipos:['EST'],cantidadesTipos:{EST:2},observaciones:'Test',
};
function memory() {
 const m=new Map();
 return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),map:m};
}
function locks() {
 const busy=new Set();
 return {request:async (name,_,fn)=>{
  if(busy.has(name)) return fn(null);
  busy.add(name);try{return await fn({name})}finally{busy.delete(name)}
 }};
}
function client({rpc,record=null,selectError=null}={}) {
 const calls=[];
 return {calls, rpc:async(_name,{p})=>{calls.push(p);return rpc ? rpc(p) : {data:{prueba_id:'id-1',numero_secuencial:1,duplicado:false},error:null}},
 from:()=>({select:()=>({eq(_campo,_valor){return this},maybeSingle:async()=>({data:record,error:selectError})})})};
}
const opts=(supabase,storage=memory(),lockManager=locks())=>({supabase,storage,lockManager,test:testPayload});
test('éxito: se guardó snapshot y la RPC recibió mismo payload',async()=>{
 const db=client(),s=memory(),r=await guardarPruebaSegura(opts(db,s));
 assert.equal(r.data.prueba_id,'id-1');assert.equal(db.calls.length,1);
 assert.deepEqual(db.calls[0],JSON.parse(s.map.get('spc_intento_v1_OP1_MAQ-010')).payload);
});
test('ACK perdido: reconcilia el registro ya existente sin otro INSERT',async()=>{
 const s=memory(),db1=client({rpc:async()=>({data:null,error:{message:'timeout'}})});
 const a=await guardarPruebaSegura(opts(db1,s));assert.equal(a.data,null);
 const db2=client({record:{id:'id-guardado',numero_secuencial:7}});
 const b=await guardarPruebaSegura(opts(db2,s));
 assert.equal(b.data.prueba_id,'id-guardado');assert.equal(b.data.duplicado,true);
 assert.equal(db2.calls.length,0);
});
test('red que lanza excepción también se reconcilia',async()=>{
 const db=client({rpc:async()=>{throw Error('socket cerrado')},record:{id:'id-confirmado',numero_secuencial:9}});
 const r=await guardarPruebaSegura(opts(db));
 assert.equal(r.data.prueba_id,'id-confirmado');assert.equal(r.error,null);
});
test('un intento modificado queda bloqueado antes de tocar RPC',async()=>{
 const s=memory(),db=client();
 await guardarPruebaSegura(opts(db,s));
 await assert.rejects(guardarPruebaSegura({...opts(db,s),test:{...testPayload,cabezalesFalla:3,cantidadesTipos:{EST:3}}}),/otros valores/);
 assert.equal(db.calls.length,1);
});
test('fallo local de persistencia bloquea por completo la red',async()=>{
 const db=client(),s={getItem(){return null},setItem(){throw Error('quota')}};
 await assert.rejects(guardarPruebaSegura(opts(db,s)),/No se pudo conservar/);
 assert.equal(db.calls.length,0);
});
test('error de lectura durante reconciliación conserva error, sin confirmar',async()=>{
 const db=client({rpc:async()=>({data:null,error:{message:'RPC offline'}}),selectError:{message:'RLS no permite lectura'}});
 const r=await guardarPruebaSegura(opts(db));
 assert.equal(r.data,null);assert.equal(r.error.message,'RPC offline');
});
test('sin Web Locks el RPC nunca se ejecuta',async()=>{
 const db=client();
 await assert.rejects(guardarPruebaSegura({...opts(db),lockManager:null}),/no admite bloqueo/);
 assert.equal(db.calls.length,0);
});

test('reintento manual transmite el payload original aun si la UI ya no lo tiene', async()=>{
 const storage=memory(), payload=construirPayloadPruebaEstanqueidad(testPayload);
 crearAlmacenIntentos(storage,'OP1').preparar('MAQ-010',testPayload.requestId,payload);
 const db=client();
 const r=await reintentarIntentoGuardado({supabase:db,storage,lockManager:locks(),
  legajo:'OP1',maquina:'MAQ-010',requestId:testPayload.requestId});
 assert.equal(r.data.prueba_id,'id-1');assert.deepEqual(db.calls,[payload]);
 assert.equal(crearAlmacenIntentos(storage,'OP1').leer('MAQ-010').requestId,testPayload.requestId);
});
test('reintento manual de un PENDIENTE no convierte el registro en ensayo físico', async()=>{
 const storage=memory(), testPendiente={...testPayload,estado:'PENDIENTE',autoPendiente:true,
  cabezalesFalla:0,tipos:[],cantidadesTipos:{},codigoProducto:null,caja:null,lote:null};
 const payload=construirPayloadPruebaEstanqueidad(testPendiente);
 crearAlmacenIntentos(storage,'OP1').preparar('MAQ-010',testPendiente.requestId,payload);
 const db=client();
 const r=await reintentarIntentoGuardado({supabase:db,storage,lockManager:locks(),
  legajo:'OP1',maquina:'MAQ-010',requestId:testPendiente.requestId});
 assert.equal(r.data.prueba_id,'id-1');
 assert.equal(db.calls[0].resultado,'PENDIENTE');
 assert.equal(db.calls[0].cabezales_afectados,0);
 assert.equal(db.calls[0].codigo_producto,null);
});
test('reintento manual ya confirmado no vuelve a escribir', async()=>{
 const storage=memory(),payload=construirPayloadPruebaEstanqueidad(testPayload);
 crearAlmacenIntentos(storage,'OP1').preparar('MAQ-010',testPayload.requestId,payload);
 const db=client({record:{id:'confirmado',numero_secuencial:31}});
 const r=await reintentarIntentoGuardado({supabase:db,storage,lockManager:locks(),
  legajo:'OP1',maquina:'MAQ-010',requestId:testPayload.requestId});
 assert.equal(r.data.prueba_id,'confirmado');assert.equal(db.calls.length,0);
});
test('reintento manual sin registro o con identidad distinta falla cerrado', async()=>{
 const db=client(),storage=memory(),requestId=testPayload.requestId;
 await assert.rejects(reintentarIntentoGuardado({supabase:db,storage,lockManager:locks(),
  legajo:'OP1',maquina:'MAQ-010',requestId}),/No existe un intento íntegro/);
 const payload=construirPayloadPruebaEstanqueidad(testPayload);
 crearAlmacenIntentos(storage,'OP1').preparar('MAQ-010',requestId,payload);
 await assert.rejects(reintentarIntentoGuardado({supabase:db,storage,lockManager:locks(),
  legajo:'OP1',maquina:'MAQ-010',requestId:'UUID-diferente'}),/No existe un intento íntegro/);
 assert.equal(db.calls.length,0);
});
test('red desconectada mantiene el intento manual para otro intento explícito',async()=>{
 const storage=memory(),payload=construirPayloadPruebaEstanqueidad(testPayload);
 crearAlmacenIntentos(storage,'OP1').preparar('MAQ-010',testPayload.requestId,payload);
 const db=client({rpc:async()=>{throw Error('offline')}});
 const r=await reintentarIntentoGuardado({supabase:db,storage,lockManager:locks(),
  legajo:'OP1',maquina:'MAQ-010',requestId:testPayload.requestId});
 assert.equal(r.data,null);
 assert.equal(crearAlmacenIntentos(storage,'OP1').leer('MAQ-010').requestId,testPayload.requestId);
});
