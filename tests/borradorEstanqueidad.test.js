import test from 'node:test';
import assert from 'node:assert/strict';
import { crearAlmacenBorradores, borradorTieneCarga } from '../src/domain/borradorEstanqueidad.js';
function st() { const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}; }
test('recupera el formulario completo de la misma solicitud',()=>{
 const a=crearAlmacenBorradores(st(),'L-01');
 const campos={tuvoFalla:true,tiposSeleccionados:['EST','CLV'],cantidadesTipos:{EST:2,CLV:1},cabezalesFalla:2,caja:'10',lote:'A',codigoProducto:'RCL-300C-RO',obs:'observación'};
 assert.equal(a.guardar('MAQ-010','req-1',campos),true);
 assert.deepEqual(a.leer('MAQ-010','req-1').borrador,campos);
 assert.equal(a.leer('MAQ-010','req-2').borrador,null);
});
test('no pisa un borrador ajeno ni lo borra con ACK viejo',()=>{
 const a=crearAlmacenBorradores(st(),'L-01');
 assert.equal(a.guardar('MAQ-010','req-1',{caja:'1'}),true);
 assert.equal(a.guardar('MAQ-010','req-2',{caja:'2'}),false);
 assert.equal(a.borrarConfirmado('MAQ-010','req-2'),false);
 assert.equal(a.leer('MAQ-010','req-1').borrador.caja,'1');
 assert.equal(a.borrarConfirmado('MAQ-010','req-1'),true);
});
test('separación por legajo y máquina',()=>{
 const storage=st(),a=crearAlmacenBorradores(storage,'L1'),b=crearAlmacenBorradores(storage,'L2');
 a.guardar('MAQ-010','r',{caja:'1'});
 assert.equal(b.leer('MAQ-010','r').borrador,null);
 assert.equal(a.leer('MAQ-011','r').borrador,null);
});
test('detecta carga parcial y no confunde borrador vacío con ensayo',()=>{
 assert.equal(borradorTieneCarga({tuvoFalla:null,tiposSeleccionados:[],caja:'',lote:'',codigoProducto:'',obs:'',cabezalesFalla:0}),false);
 assert.equal(borradorTieneCarga({tuvoFalla:false}),true);
 assert.equal(borradorTieneCarga({obs:'revisar'}),true);
});
test('fallo de almacenamiento no equivale a guardado',()=>{
 const a=crearAlmacenBorradores({getItem(){return null},setItem(){throw Error('quota')},removeItem(){}},'L1');
 assert.equal(a.guardar('M','r',{caja:'2'}),false);
});
