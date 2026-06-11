import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Save, Check, AlertTriangle,
  PackageCheck, CheckCircle2, RotateCcw, Loader2
} from 'lucide-react';
import {
  fetchCatalogos, fetchRechazosPendientes, fetchRecontrolesDelDia,
  fetchRecontrolesHistorial, guardarRecontrol as apiGuardarRecontrol,
} from './api/calidad.js';

/* =================================================================
   MÓDULO RECONTROL DE RECHAZOS
   "Abrir una NC" = en planta es "rechazar / abrir un rechazo".
   Conectado a Supabase: la cola sale de no_conformidades
   (estado ABIERTA / EN ANALISIS, origen control de calidad) y el
   guardado usa la RPC guardar_recontrol (recontrol + defectos +
   cierre/avance de la NC). Recuperados = total − descartados.
   ================================================================= */

const CABEZALES_POR_CAJA = 336;
const KG_POR_CABEZAL = 0.0184;

const ACCIONES_PREVIAS = ['RETRABAJO','SELECCION','LIMPIEZA','OTRO'];

const RESULTADO_LBL = {
  RECUPERADO_TOTAL:  { txt:'Recuperado total',  tone:'success' },
  RECUPERADO_PARCIAL:{ txt:'Recuperado parcial',tone:'warn' },
  RECHAZADO_TOTAL:   { txt:'Rechazado total',   tone:'danger' },
};
const calcResultado = (total, desc) => {
  if (isNaN(total) || isNaN(desc) || total <= 0) return null;
  if (desc === 0) return 'RECUPERADO_TOTAL';
  if (desc >= total) return 'RECHAZADO_TOTAL';
  return 'RECUPERADO_PARCIAL';
};

const emptyPlanilla = () => ({
  inspector:'', accion_previa:'', descartados:'',
  defectos:[], es_final:true, observaciones:'',
});

// ─── ESTILOS (tokens del sistema) ─────────────────────────────────────────────
const mk = (t) => ({
  root:{background:t.bg,color:t.text,fontFamily:"'Manrope',system-ui,sans-serif",fontSize:14},
  toolbar:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 20px',background:t.surface,borderBottom:`1px solid ${t.border}`,gap:12,flexWrap:'wrap'},
  toolbarTitle:{fontWeight:600,fontSize:15,color:t.text,fontFamily:"'Bricolage Grotesque',Manrope,sans-serif",display:'flex',alignItems:'center',gap:8},
  btnVolver:{background:t.surface,color:t.accent,border:`1px solid ${t.accent}`,borderRadius:6,padding:'6px 12px',fontSize:12,cursor:'pointer',fontWeight:500,display:'inline-flex',alignItems:'center',gap:6,fontFamily:'Manrope'},
  body:{padding:'20px 24px',maxWidth:980,margin:'0 auto'},

  // lista
  listaTit:{margin:'0 0 4px',fontSize:18,fontWeight:600,color:t.text,fontFamily:"'Bricolage Grotesque',Manrope,sans-serif"},
  listaPie:{margin:'0 0 18px',fontSize:12,color:t.textMuted},
  rechCard:{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,padding:'14px 16px',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'},
  rechNum:{background:t.dangerSoft,color:t.danger,border:`1px solid ${t.danger}40`,borderRadius:6,padding:'4px 10px',fontSize:12,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"},
  rechMeta:{fontSize:12,color:t.textMuted},
  rechMetaStrong:{color:t.text,fontWeight:500},
  btnRecontrolar:{background:t.accent,color:t.bg,border:'none',borderRadius:6,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6,fontFamily:'Manrope'},
  hechoBadge:{background:t.successSoft,color:t.success,border:`1px solid ${t.success}40`,borderRadius:6,padding:'4px 10px',fontSize:11,fontWeight:600,display:'inline-flex',alignItems:'center',gap:5},

  // planilla
  card:{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,padding:18,marginBottom:14},
  cardTit:{fontSize:12,fontWeight:600,color:t.textMuted,textTransform:'uppercase',letterSpacing:'0.08em',margin:'0 0 14px',fontFamily:"'JetBrains Mono',monospace",display:'flex',alignItems:'center',gap:8},
  autoGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'12px 18px'},
  autoItem:{display:'flex',flexDirection:'column',gap:2},
  autoLbl:{fontSize:10,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.04em'},
  autoVal:{fontSize:13,color:t.text,fontWeight:500},

  campo:{marginBottom:16},
  label:{display:'block',fontSize:12,color:t.textMuted,marginBottom:6,fontWeight:500},
  req:{color:t.danger},
  input:{width:'100%',background:t.surfaceHi,border:`1px solid ${t.border}`,borderRadius:6,color:t.text,padding:'10px 12px',fontSize:14,boxSizing:'border-box',outline:'none',fontFamily:'Manrope'},
  select:{width:'100%',background:t.surfaceHi,border:`1px solid ${t.border}`,borderRadius:6,color:t.text,padding:'10px 12px',fontSize:14,boxSizing:'border-box',outline:'none',fontFamily:'Manrope'},
  textarea:{width:'100%',background:t.surfaceHi,border:`1px solid ${t.border}`,borderRadius:6,color:t.text,padding:'10px 12px',fontSize:14,boxSizing:'border-box',resize:'vertical',outline:'none',fontFamily:'Manrope'},
  chipGrid:{display:'flex',flexWrap:'wrap',gap:6},
  chip:{background:t.surfaceHi,border:`1px solid ${t.border}`,color:t.textMuted,borderRadius:6,padding:'6px 12px',fontSize:12,cursor:'pointer',fontWeight:500,fontFamily:'Manrope'},
  chipOn:{background:t.accentSoft,border:`1px solid ${t.accent}`,color:t.accent},
  chipDef:{background:t.dangerSoft,border:`1px solid ${t.danger}`,color:t.danger},

  calcBox:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginTop:6},
  calcItem:{background:t.surfaceHi,borderRadius:8,padding:'12px 14px',textAlign:'center'},
  calcNum:{display:'block',fontSize:22,fontWeight:700,lineHeight:1.1},
  calcLbl:{display:'block',fontSize:10,color:t.textDim,textTransform:'uppercase',marginTop:4,letterSpacing:'0.04em'},
  pill:{display:'inline-flex',alignItems:'center',gap:6,borderRadius:6,padding:'4px 10px',fontSize:12,fontWeight:600},

  alerta:{marginTop:8,padding:'8px 12px',background:t.warnSoft,border:`1px solid ${t.warn}`,borderRadius:6,display:'flex',alignItems:'flex-start',gap:8,fontSize:12,color:t.warn},
  toggleRow:{display:'flex',alignItems:'center',gap:10},
  toggle:{width:42,height:24,borderRadius:999,padding:2,cursor:'pointer',transition:'background .15s'},
  toggleKnob:{width:20,height:20,borderRadius:'50%',background:'#fff',transition:'transform .15s'},
  btnGuardar:{width:'100%',background:t.accent,color:t.bg,border:'none',borderRadius:8,padding:'14px',fontSize:15,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,fontFamily:'Manrope'},
  btnDis:{background:t.surfaceHi,color:t.textDim,cursor:'not-allowed'},
});

// ═══════════════════════════════════════════════════════════════════════════════
export default function VistaRecontrol({ t, currentUser }) {
  const S = useMemo(()=>mk(t),[t]);
  const [pendientes, setPendientes] = useState([]);
  const [hechos, setHechos] = useState([]);
  const [defectosCat, setDefectosCat] = useState([]);
  // v7: el recontrol lo puede registrar cualquier usuario activo del sistema
  const [usuariosCat, setUsuariosCat] = useState([]);
  // v7: historial por mes y turno
  const hoy = new Date();
  const [histAnio, setHistAnio] = useState(hoy.getFullYear());
  const [histMes, setHistMes] = useState(hoy.getMonth());
  const [histTurno, setHistTurno] = useState(null);   // null = todos
  const [historial, setHistorial] = useState([]);
  const [histCargando, setHistCargando] = useState(false);
  const [activoId, setActivoId] = useState(null);
  const [form, setForm] = useState(emptyPlanilla());
  const [guardado, setGuardado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorOp, setErrorOp] = useState(null);

  const cargar = useCallback(async ()=>{
    setCargando(true); setErrorCarga(null);
    try {
      const [cat, pend, rec] = await Promise.all([
        fetchCatalogos(), fetchRechazosPendientes(), fetchRecontrolesDelDia(),
      ]);
      setDefectosCat(cat.defectos);
      setUsuariosCat(cat.usuarios || []);
      setPendientes(pend);
      setHechos(rec);
    } catch(e){ setErrorCarga(e.message); }
    finally { setCargando(false); }
  },[]);
  useEffect(()=>{ cargar(); },[cargar]);

  // v7: historial de recontroles finalizados (por mes y turno)
  useEffect(()=>{
    let cancelado = false;
    (async ()=>{
      setHistCargando(true);
      try {
        const rows = await fetchRecontrolesHistorial({ anio: histAnio, mes: histMes, turno: histTurno });
        if (!cancelado) setHistorial(rows);
      } catch(e){ console.error('historial recontroles:', e); }
      finally { if (!cancelado) setHistCargando(false); }
    })();
    return ()=>{ cancelado = true; };
  },[histAnio, histMes, histTurno, hechos.length]);

  const tone = (name) => ({success:t.success,warn:t.warn,danger:t.danger}[name] || t.textMuted);
  const toneSoft = (name) => ({success:t.successSoft,warn:t.warnSoft,danger:t.dangerSoft}[name] || t.surfaceHi);

  const activo = pendientes.find(r=>r.id===activoId) || null;

  const abrir = (r) => {
    setActivoId(r.id);
    setForm(emptyPlanilla());
    setGuardado(false);
    setErrorOp(null);
  };
  const hF = (k,v) => setForm(f=>({...f,[k]:v}));
  const toggleDef = d => setForm(f=>({...f,defectos:f.defectos.includes(d)?f.defectos.filter(x=>x!==d):[...f.defectos,d]}));

  // Total automático: cajas rechazadas × cabezales por caja (336 por defecto,
  // a futuro según la medida del producto). El inspector solo carga las malas.
  const total = activo ? activo.cantidad_rechazo * CABEZALES_POR_CAJA : 0;
  const desc  = parseInt(form.descartados);
  const recuperados = (total>0 && !isNaN(desc)) ? total-desc : null;
  const merma = !isNaN(desc) ? desc*KG_POR_CABEZAL : null;
  const resultado = calcResultado(total, desc);
  const excede = total>0 && !isNaN(desc) && desc>total;

  const formValido = form.inspector && form.accion_previa
    && total>0 && !isNaN(desc) && desc>=0 && !excede && !guardando;

  const guardar = async () => {
    if(!formValido||!activo) return;
    setErrorOp(null); setGuardando(true);
    try {
      const insp = usuariosCat.find(i=>i.legajo===form.inspector);
      await apiGuardarRecontrol({
        noConformidadId: activo.id,
        controlCalidadId: activo.control_calidad_id,
        inspector: insp,
        accionPrevia: form.accion_previa,
        reinspeccionados: total,
        descartados: desc,
        resultado,
        kgMerma: merma,
        esFinal: form.es_final,
        observaciones: form.observaciones,
        defectosIds: form.defectos,
      });
      setGuardado(true);
      setTimeout(async ()=>{
        setActivoId(null); setGuardado(false);
        await cargar();           // refresca cola y recontrolados desde la DB
      },1100);
    } catch(e){ setErrorOp(e.message); setGuardando(false); return; }
    setGuardando(false);
  };

  // ── CARGA / ERROR ───────────────────────────────────────────────────────────
  if (cargando) return (
    <div style={{...S.root,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'50vh'}}>
      <Loader2 size={28} color={t.accent}/>
      <p style={{color:t.textMuted,fontSize:13,marginTop:12}}>Cargando recontrol…</p>
    </div>
  );
  if (errorCarga) return (
    <div style={{...S.root,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'50vh',padding:24}}>
      <AlertTriangle size={28} color={t.danger}/>
      <p style={{color:t.danger,fontSize:13,margin:'12px 0',textAlign:'center'}}>{errorCarga}</p>
      <button style={S.btnVolver} onClick={cargar}><RotateCcw size={14}/> Reintentar</button>
    </div>
  );

  // ── LISTA ───────────────────────────────────────────────────────────────────
  if (!activo) {
    return (
      <div style={S.root}>
        <div style={S.toolbar}>
          <span style={S.toolbarTitle}><RotateCcw size={16} color={t.accent}/> Recontrol de rechazos</span>
          <span style={{fontSize:12,color:t.textMuted}}>{pendientes.length} pendiente{pendientes.length!==1?'s':''}</span>
        </div>
        <div style={S.body}>
          <h2 style={S.listaTit}>Rechazos pendientes de recontrol</h2>
          <p style={S.listaPie}>Cada rechazo abierto por calidad cae acá. Tocá “Recontrolar” para completar la planilla.</p>

          {pendientes.length===0 && (
            <div style={{textAlign:'center',padding:'50px 0',color:t.textDim}}>
              <CheckCircle2 size={32} color={t.success}/>
              <p style={{margin:'12px 0 0'}}>No hay rechazos pendientes.</p>
            </div>
          )}

          {pendientes.map(r=>(
            <div key={r.id} style={S.rechCard}>
              <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                <span style={S.rechNum}>RECHAZO #{r.numero}</span>
                <div>
                  <div style={{fontSize:13,color:t.text,fontWeight:500}}>{r.id_maquina} · {r.producto}</div>
                  <div style={S.rechMeta}>Lote <span style={S.rechMetaStrong}>{r.lote}</span> · cajas {r.caja_desde}–{r.caja_hasta} ({r.cantidad_rechazo}) · <span style={{color:t.danger}}>{r.defectos.join(', ')}</span></div>
                  <div style={{...S.rechMeta,marginTop:2}}>Abierto por {r.inspector_abrio} · {r.fecha_apertura}</div>
                </div>
              </div>
              <button style={S.btnRecontrolar} onClick={()=>abrir(r)}>Recontrolar <ArrowLeft size={14} style={{transform:'rotate(180deg)'}}/></button>
            </div>
          ))}

          {hechos.length>0 && (
            <div style={{marginTop:22}}>
              <p style={{...S.listaPie,marginBottom:10,fontWeight:500,color:t.textMuted}}>Recontrolados hoy</p>
              {hechos.map(r=>{
                const lbl=RESULTADO_LBL[r._resultado];
                return(
                  <div key={r.id} style={{...S.rechCard,opacity:0.85}}>
                    <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                      <span style={{...S.rechNum,background:t.surfaceHi,color:t.textMuted,borderColor:t.border}}>RECHAZO #{r.numero}</span>
                      <div style={{fontSize:13,color:t.textMuted}}>{r.id_maquina} · {r.producto} · lote {r.lote}</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                      <span style={{fontSize:11,color:t.textDim}}>desc. {r._descartados} · merma {r._merma.toFixed(3)} kg</span>
                      {lbl && <span style={{...S.pill,background:toneSoft(lbl.tone),color:tone(lbl.tone),border:`1px solid ${tone(lbl.tone)}40`}}>{lbl.txt}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* v7: historial de recontroles finalizados — filtrable por mes y turno */}
          <div style={{marginTop:30,borderTop:`1px solid ${t.border}`,paddingTop:18}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:12}}>
              <div>
                <h2 style={{...S.listaTit,fontSize:16,margin:0}}>Historial de recontroles</h2>
                <p style={{...S.listaPie,margin:'2px 0 0'}}>Pallets que ya salieron a depósito · {historial.length} en el período</p>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <input
                  type="month"
                  style={{...S.select,width:'auto',padding:'7px 10px',fontSize:12}}
                  value={`${histAnio}-${String(histMes+1).padStart(2,'0')}`}
                  onChange={e=>{
                    const [a,m]=e.target.value.split('-').map(Number);
                    if(a&&m){ setHistAnio(a); setHistMes(m-1); }
                  }}
                />
                {[{id:null,lbl:'Todos'},{id:'M',lbl:'Mañana'},{id:'T',lbl:'Tarde'},{id:'N',lbl:'Noche'}].map(x=>(
                  <button key={String(x.id)} onClick={()=>setHistTurno(x.id)}
                    style={{...S.chip,...(histTurno===x.id?S.chipOn:{}),padding:'7px 12px'}}>{x.lbl}</button>
                ))}
              </div>
            </div>

            {histCargando ? (
              <p style={{color:t.textDim,fontSize:13,textAlign:'center',padding:'20px 0'}}>Cargando historial…</p>
            ) : historial.length===0 ? (
              <p style={{color:t.textDim,fontSize:13,textAlign:'center',padding:'20px 0'}}>
                Sin recontroles en {String(histMes+1).padStart(2,'0')}/{histAnio}{histTurno?` · turno ${({M:'Mañana',T:'Tarde',N:'Noche'})[histTurno]}`:''}.
              </p>
            ) : (
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr>
                      {['Fecha','Hora','Turno','Rechazo','Máquina','Producto','Lote','Controló','Acción','Desc.','Recup.','Merma (kg)','Resultado'].map(h=>(
                        <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:600,color:t.textMuted,textTransform:'uppercase',letterSpacing:'0.05em',borderBottom:`2px solid ${t.border}`,whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map(r=>{
                      const lbl=RESULTADO_LBL[r._resultado];
                      return(
                        <tr key={r.id} style={{borderBottom:`1px solid ${t.border}`}}>
                          <td style={{padding:'7px 10px',color:t.textMuted,whiteSpace:'nowrap'}}>{r.fecha}</td>
                          <td style={{padding:'7px 10px',color:t.textDim,fontFamily:"'JetBrains Mono',monospace"}}>{r.hora}</td>
                          <td style={{padding:'7px 10px',color:t.textMuted}}>{({M:'Mañana',T:'Tarde',N:'Noche'})[r.turno]||'—'}</td>
                          <td style={{padding:'7px 10px',color:t.danger,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>#{r.numero}</td>
                          <td style={{padding:'7px 10px',color:t.text,fontWeight:500}}>{r.id_maquina}</td>
                          <td style={{padding:'7px 10px',color:t.textMuted}}>{r.producto}</td>
                          <td style={{padding:'7px 10px',color:t.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{r.lote}</td>
                          <td style={{padding:'7px 10px',color:t.textMuted}}>{r.inspector}</td>
                          <td style={{padding:'7px 10px',color:t.textDim}}>{r.accion||'—'}</td>
                          <td style={{padding:'7px 10px',color:t.danger,fontWeight:600}}>{r._descartados}</td>
                          <td style={{padding:'7px 10px',color:t.success,fontWeight:600}}>{r._recuperados}</td>
                          <td style={{padding:'7px 10px',color:t.warn,fontWeight:600}}>{r._merma.toFixed(3)}</td>
                          <td style={{padding:'7px 10px'}}>
                            {lbl && <span style={{...S.pill,fontSize:10,background:toneSoft(lbl.tone),color:tone(lbl.tone),border:`1px solid ${tone(lbl.tone)}40`}}>{lbl.txt}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── PLANILLA ────────────────────────────────────────────────────────────────
  const lbl = resultado ? RESULTADO_LBL[resultado] : null;
  return (
    <div style={S.root}>
      <div style={S.toolbar}>
        <button style={S.btnVolver} onClick={()=>setActivoId(null)}><ArrowLeft size={14}/> Volver a la cola</button>
        <span style={S.toolbarTitle}><RotateCcw size={16} color={t.accent}/> Recontrol · RECHAZO #{activo.numero}</span>
        <span/>
      </div>

      <div style={S.body}>
        {/* Datos automáticos del rechazo */}
        <div style={S.card}>
          <p style={S.cardTit}><AlertTriangle size={14}/> Datos del rechazo (automático)</p>
          <div style={S.autoGrid}>
            <div style={S.autoItem}><span style={S.autoLbl}>N° de rechazo</span><span style={S.autoVal}>#{activo.numero}</span></div>
            <div style={S.autoItem}><span style={S.autoLbl}>Máquina</span><span style={S.autoVal}>{activo.id_maquina}</span></div>
            <div style={S.autoItem}><span style={S.autoLbl}>Producto</span><span style={S.autoVal}>{activo.producto}</span></div>
            <div style={S.autoItem}><span style={S.autoLbl}>Lote</span><span style={S.autoVal}>{activo.lote}</span></div>
            <div style={S.autoItem}><span style={S.autoLbl}>Cliente</span><span style={S.autoVal}>{activo.cliente}</span></div>
            <div style={S.autoItem}><span style={S.autoLbl}>Cajas rechazadas</span><span style={S.autoVal}>{activo.caja_desde}–{activo.caja_hasta} ({activo.cantidad_rechazo} cajas)</span></div>
            <div style={S.autoItem}><span style={S.autoLbl}>Defecto detectado</span><span style={{...S.autoVal,color:t.danger}}>{activo.defectos.join(', ')}</span></div>
            <div style={S.autoItem}><span style={S.autoLbl}>Abierto por</span><span style={S.autoVal}>{activo.inspector_abrio}</span></div>
            <div style={S.autoItem}><span style={S.autoLbl}>Fecha apertura</span><span style={S.autoVal}>{activo.fecha_apertura}</span></div>
          </div>
          {activo.observacion && <div style={{marginTop:12,padding:'8px 12px',background:t.surfaceHi,borderRadius:6,fontSize:12,color:t.textMuted}}>“{activo.observacion}”</div>}
        </div>

        {/* Planilla de recontrol */}
        <div style={S.card}>
          <p style={S.cardTit}><PackageCheck size={14}/> Planilla de recontrol</p>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 16px'}}>
            <div style={S.campo}>
              <label style={S.label}>Quién controla (legajo) <span style={S.req}>*</span></label>
              <select style={S.select} value={form.inspector} onChange={e=>hF('inspector',e.target.value)}>
                <option value="">Seleccionar…</option>
                {usuariosCat.map(i=><option key={i.legajo} value={i.legajo}>{i.legajo} — {i.nombre}</option>)}
              </select>
            </div>
            <div style={S.campo}>
              <label style={S.label}>Acción <span style={S.req}>*</span></label>
              <select style={S.select} value={form.accion_previa} onChange={e=>hF('accion_previa',e.target.value)}>
                <option value="">Seleccionar…</option>
                {ACCIONES_PREVIAS.map(a=><option key={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div style={{...S.campo,padding:'10px 12px',background:t.surfaceHi,borderRadius:6,marginBottom:14}}>
            <span style={{fontSize:12,color:t.textMuted}}>Total a recontrolar (automático): </span>
            <span style={{fontSize:14,fontWeight:600,color:t.text}}>{total} cabezales</span>
            <span style={{fontSize:11,color:t.textDim}}> = {activo.cantidad_rechazo} caja(s) × {CABEZALES_POR_CAJA} cab.</span>
          </div>
          <div style={S.campo}>
            <label style={S.label}>Descartados — solo las malas (van a merma y se reponen) <span style={S.req}>*</span></label>
            <input style={{...S.input,...(excede?{borderColor:t.warn,background:t.warnSoft}:{})}} type="number" min="0" placeholder="0" value={form.descartados} onChange={e=>hF('descartados',e.target.value)}/>
          </div>

          {excede && (
            <div style={S.alerta}><AlertTriangle size={14}/><span>No podés descartar más de lo reinspeccionado ({total}).</span></div>
          )}

          {/* Cálculo en vivo */}
          <div style={S.calcBox}>
            <div style={S.calcItem}>
              <span style={{...S.calcNum,color:t.text}}>{total||'—'}</span>
              <span style={S.calcLbl}>Total</span>
            </div>
            <div style={S.calcItem}>
              <span style={{...S.calcNum,color:t.success}}>{recuperados!=null&&recuperados>=0?recuperados:'—'}</span>
              <span style={S.calcLbl}>Recuperados (buenos)</span>
            </div>
            <div style={S.calcItem}>
              <span style={{...S.calcNum,color:t.danger}}>{!isNaN(desc)?desc:'—'}</span>
              <span style={S.calcLbl}>Descartados = repuestos</span>
            </div>
            <div style={S.calcItem}>
              <span style={{...S.calcNum,color:t.warn}}>{merma!=null?merma.toFixed(3):'—'}</span>
              <span style={S.calcLbl}>Merma (kg)</span>
            </div>
            <div style={{...S.calcItem,display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center'}}>
              {lbl ? <span style={{...S.pill,background:toneSoft(lbl.tone),color:tone(lbl.tone),border:`1px solid ${tone(lbl.tone)}40`}}>{lbl.txt}</span> : <span style={{color:t.textDim,fontSize:13}}>—</span>}
              <span style={{...S.calcLbl,marginTop:6}}>Resultado (auto)</span>
            </div>
          </div>

          <div style={{...S.campo,marginTop:18}}>
            <label style={S.label}>Defectos que persisten (los que se descartaron)</label>
            <div style={S.chipGrid}>
              {defectosCat.map(d=>(
                <button key={d.id} style={{...S.chip,...(form.defectos.includes(d.id)?S.chipDef:{})}} onClick={()=>toggleDef(d.id)}>{d.nombre}</button>
              ))}
            </div>
          </div>

          <div style={S.campo}>
            <label style={S.label}>Observaciones</label>
            <textarea style={S.textarea} rows={2} placeholder="Ej: se seleccionaron a mano, 2 con pico descolorido a merma…" value={form.observaciones} onChange={e=>hF('observaciones',e.target.value)}/>
          </div>

          <div style={{...S.campo,...S.toggleRow}}>
            <div style={{...S.toggle,background:form.es_final?t.accent:t.border}} onClick={()=>hF('es_final',!form.es_final)}>
              <div style={{...S.toggleKnob,transform:form.es_final?'translateX(18px)':'translateX(0)'}}/>
            </div>
            <span style={{fontSize:13,color:t.text}}>Es el recontrol definitivo de este rechazo</span>
          </div>

          {errorOp && (
            <div style={{...S.alerta,background:t.dangerSoft,border:`1px solid ${t.danger}`,color:t.danger,marginBottom:10}}>
              <AlertTriangle size={14}/><span>{errorOp}</span>
            </div>
          )}
          <button style={{...S.btnGuardar,...(!formValido?S.btnDis:{}),...(guardado?{background:t.success}:{})}} onClick={guardar} disabled={!formValido}>
            {guardando ? <><Loader2 size={16}/> Guardando…</> : guardado ? <><Check size={16}/> Recontrol guardado</> : <><Save size={16}/> Guardar recontrol</>}
          </button>
        </div>
      </div>
    </div>
  );
}
