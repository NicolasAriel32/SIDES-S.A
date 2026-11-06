import test from 'node:test';
import assert from 'node:assert/strict';
import { reservarEditorExclusivo } from '../src/domain/editorExclusivo.js';

function locks() {
  const activos = new Set();
  return {request: async (name,_opts, callback) => {
    if (activos.has(name)) return callback(null);
    activos.add(name);
    try { return await callback({name}); } finally { activos.delete(name); }
  }};
}
test('la primera pestaña obtiene editor y la segunda queda en lectura',async()=>{
  const manager=locks();
  const uno=reservarEditorExclusivo(manager,'OP','MAQ-010','uuid-a');
  assert.equal(await uno.listo,true);
  const dos=reservarEditorExclusivo(manager,'OP','MAQ-010','uuid-a');
  assert.equal(await dos.listo,false);
  dos.soltar();
  uno.soltar();
});
test('al cerrar la pestaña se puede reservar nuevamente',async()=>{
 const manager=locks();
 const a=reservarEditorExclusivo(manager,'OP','M','r');
 assert.equal(await a.listo,true);a.soltar();
 // Esperar a que Web Locks libere en el microtask.
 await new Promise(resolve=>setImmediate(resolve));
 const b=reservarEditorExclusivo(manager,'OP','M','r');
 assert.equal(await b.listo,true);b.soltar();
});
test('la falta de Web Locks bloquea la edición',async()=>{
 const a=reservarEditorExclusivo(null,'OP','M','r');
 assert.equal(await a.listo,false);a.soltar();
});
test('una reserva desmontada anticipadamente nunca habilita edición',async()=>{
 let confirmar;
 const manager={request:()=>new Promise(resolve=>{confirmar=resolve;})};
 const a=reservarEditorExclusivo(manager,'OP','M','r');
 a.soltar();
 assert.equal(await a.listo,false);
 await Promise.resolve();
 if(confirmar) confirmar();
});
test('dos solicitudes diferentes usan locks independientes',async()=>{
 const manager=locks();
 const a=reservarEditorExclusivo(manager,'OP','M','r1');
 const b=reservarEditorExclusivo(manager,'OP','M','r2');
 assert.equal(await a.listo,true);
 assert.equal(await b.listo,true);
 a.soltar();b.soltar();
});
