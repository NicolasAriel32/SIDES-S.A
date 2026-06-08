import React, { useState, useMemo } from 'react';
import {
  Box, AlertTriangle, ClipboardList, Settings, ArrowLeft, Save,
  Check, CheckCircle2, RotateCcw, History, X, Ruler
} from 'lucide-react';

/* =================================================================
   MÓDULO CONTROL DE CALIDAD (dimensional / visual)
   Integrado al sistema de Trazabilidad — re-estilizado con tokens `t`.
   Por ahora usa datos en memoria (mock). El cableado a Supabase
   (especifc_producto, controles_calidad, mediciones, controles_defectos,
   inspectores_calidad) se hace en una etapa posterior.
   ================================================================= */

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const APERTURA_MIN = 800;
const APERTURA_MAX = 1800;

const MAQUINAS_LIST = [
  'MAQ-001','MAQ-002','MAQ-006','MAQ-007','MAQ-008',
  'MAQ-009','MAQ-010','MAQ-011','MAQ-012','MAQ-013'
];

const PRODUCTOS = {
  'Sifón 1L Classic':  { largo_min: 145.0, largo_max: 149.0, largo_nom: 147 },
  'Sifón 1L Premium':  { largo_min: 146.0, largo_max: 150.0, largo_nom: 148 },
  'Sifón 750ml':       { largo_min: 130.0, largo_max: 134.0, largo_nom: 132 },
  'Recarga CO2 std':   { largo_min: 120.0, largo_max: 124.0, largo_nom: 122 },
  'Recarga CO2 plus':  { largo_min: 122.0, largo_max: 126.0, largo_nom: 124 },
};

const CLIENTES = ['Supermercados Norte','Distribuidora Sur','Horeca BA','Exportación Chile','Stock propio','SIDES'];
const DEFECTOS_LISTA = [
  'Marcado de gatillo desprolijo','Leve palanca hundida','Polvillo',
  'Pico descolorido','Cabezal con golpe','Cierre de tapa deficiente',
  'Válvula clavada','Encastre roto','Soldado de tubos','Precinto roto',
  'Largo fuera de rango','Apertura fuera de rango','Inocuidad','Otro',
];
const TURNOS = [
  { id:'M', label:'Mañana' },
  { id:'T', label:'Tarde'  },
  { id:'N', label:'Noche'  },
];
const INSPECTORES = [
  { legajo:'CAL1', nombre:'García, Marcela' },
  { legajo:'CAL2', nombre:'Pereyra, Luis' },
  { legajo:'CAL3', nombre:'Romero, Ana' },
  { legajo:'CAL4', nombre:'Díaz, Fabián' },
];

// 4 colores por inspector, derivados de los tokens del sistema (claro/oscuro)
const colInsp = (t) => [
  { bg:t.infoSoft,    border:t.info,    text:t.info },
  { bg:t.accentSoft,  border:t.accent,  text:t.accent },
  { bg:t.successSoft, border:t.success, text:t.success },
  { bg:t.warnSoft,    border:t.warn,    text:t.warn },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const nowTime  = () => new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
const fueraApertura = v => { const n=parseFloat(v); return !isNaN(n)&&(n<APERTURA_MIN||n>APERTURA_MAX); };
const fueraLargo = (v,prod) => {
  if (!prod||!PRODUCTOS[prod]) return false;
  const n=parseFloat(v); const {largo_min,largo_max}=PRODUCTOS[prod];
  return !isNaN(n)&&(n<largo_min||n>largo_max);
};
const ordenVacia = id => ({ id_maquina:id, producto:'', lote:'', cliente:'', orden_id:'', activa:false, registros:[], ordenes_historial:[] });
const emptyForm = () => ({
  nro_caja:'', apertura_tapa:['','','',''], largo_cabezal:['','','',''],
  no_conforme:'No', defectos:[], observacion_libre:'',
  cantidad_rechazo:'', caja_desde:'', caja_hasta:'', hora:nowTime(),
});

// ─── DATOS DE EJEMPLO (mock en memoria) ───────────────────────────────────────
const SESION_EJEMPLO = {
  id:'SES-20260607-2031', fecha:'07/06/2026', turno:'N',
  inspectores:[
    { legajo:'CAL2', nombre:'Pereyra, Luis', maquinas:['MAQ-001','MAQ-002','MAQ-006','MAQ-007','MAQ-008'] },
    { legajo:'CAL3', nombre:'Romero, Ana',   maquinas:['MAQ-009','MAQ-010','MAQ-011','MAQ-012','MAQ-013'] },
  ],
};
const MAQUINAS_EJEMPLO = MAQUINAS_LIST.map(id => {
  if (id === 'MAQ-001') return {
    id_maquina:id, producto:'Sifón 1L Classic', lote:'25503', cliente:'SIDES', orden_id:'OP-2026-0481', activa:true, ordenes_historial:[],
    registros:[
      { id_reg:'MAQ-001-R001', id_maquina:'MAQ-001', nro_caja:'68', hora:'20:15', fecha:'07/06/2026', turno:'N', sesion_id:'SES-20260607-2031', lote:'25503', producto:'Sifón 1L Classic', cliente:'SIDES', orden_id:'OP-2026-0481', inspector_legajo:'CAL2', inspector_nombre:'Pereyra, Luis', apertura_tapa:['1050','980','1120','1010'], largo_cabezal:['147.2','147.0','147.5','146.8'], no_conforme:'Sí', defectos:['Pico descolorido'], observacion_libre:'Se encuentran (2) cabezales con pico descolorido (lote: 290)', cantidad_rechazo:'4', caja_desde:'65', caja_hasta:'68', alertas_ap:[false,false,false,false], alertas_lg:[false,false,false,false], timestamp:'2026-06-07T23:15:00.000Z' },
      { id_reg:'MAQ-001-R002', id_maquina:'MAQ-001', nro_caja:'74', hora:'21:10', fecha:'07/06/2026', turno:'N', sesion_id:'SES-20260607-2031', lote:'25503', producto:'Sifón 1L Classic', cliente:'SIDES', orden_id:'OP-2026-0481', inspector_legajo:'CAL2', inspector_nombre:'Pereyra, Luis', apertura_tapa:['1100','1050','1080','1090'], largo_cabezal:['147.1','146.9','147.3','147.0'], no_conforme:'No', defectos:[], observacion_libre:'', cantidad_rechazo:'', caja_desde:'', caja_hasta:'', alertas_ap:[false,false,false,false], alertas_lg:[false,false,false,false], timestamp:'2026-06-07T00:10:00.000Z' },
    ],
  };
  if (id === 'MAQ-002') return {
    id_maquina:id, producto:'Sifón 1L Classic', lote:'25496', cliente:'Distribuidora Sur', orden_id:'OP-2026-0477', activa:true,
    ordenes_historial:[
      { id_maquina:'MAQ-002', producto:'Sifón 750ml', lote:'25201', cliente:'Stock propio', orden_id:'OP-2026-0460', activa:true, cerrada_en:'19:45',
        registros:[
          { id_reg:'MAQ-002-OLD-R001', id_maquina:'MAQ-002', nro_caja:'177', hora:'18:30', fecha:'07/06/2026', turno:'N', sesion_id:'SES-20260607-2031', lote:'25201', producto:'Sifón 750ml', cliente:'Stock propio', orden_id:'OP-2026-0460', inspector_legajo:'CAL2', inspector_nombre:'Pereyra, Luis', apertura_tapa:['1050','1000','1080','1020'], largo_cabezal:['131.5','131.8','132.0','131.6'], no_conforme:'Sí', defectos:['Marcado de gatillo desprolijo','Leve palanca hundida','Polvillo'], observacion_libre:'Marcado de gatillo desprolijo, leve palanca hundida y leve polvillo.', cantidad_rechazo:'3', caja_desde:'175', caja_hasta:'177', alertas_ap:[false,false,false,false], alertas_lg:[false,false,false,false], timestamp:'2026-06-07T21:30:00.000Z' },
        ]
      }
    ],
    registros:[
      { id_reg:'MAQ-002-R001', id_maquina:'MAQ-002', nro_caja:'102', hora:'20:30', fecha:'07/06/2026', turno:'N', sesion_id:'SES-20260607-2031', lote:'25496', producto:'Sifón 1L Classic', cliente:'Distribuidora Sur', orden_id:'OP-2026-0477', inspector_legajo:'CAL2', inspector_nombre:'Pereyra, Luis', apertura_tapa:['1100','1050','1080','1070'], largo_cabezal:['146.8','147.1','146.9','147.2'], no_conforme:'Sí', defectos:['Polvillo'], observacion_libre:'leve polvillo y leve telaraña. (1) Cabezal con golpe en pico.', cantidad_rechazo:'1', caja_desde:'102', caja_hasta:'102', alertas_ap:[false,false,false,false], alertas_lg:[false,false,false,false], timestamp:'2026-06-07T23:30:00.000Z' },
    ],
  };
  if (id === 'MAQ-006') return {
    id_maquina:id, producto:'Sifón 1L Premium', lote:'25443', cliente:'SIDES', orden_id:'OP-2026-0482', activa:true, ordenes_historial:[],
    registros:[
      { id_reg:'MAQ-006-R001', id_maquina:'MAQ-006', nro_caja:'311', hora:'20:00', fecha:'07/06/2026', turno:'N', sesion_id:'SES-20260607-2031', lote:'25443', producto:'Sifón 1L Premium', cliente:'SIDES', orden_id:'OP-2026-0482', inspector_legajo:'CAL2', inspector_nombre:'Pereyra, Luis', apertura_tapa:['1050','1100','1080','1060'], largo_cabezal:['150.8','150.5','150.9','151.0'], no_conforme:'Sí', defectos:['Largo fuera de rango'], observacion_libre:'LO PESO 4.19', cantidad_rechazo:'1', caja_desde:'311', caja_hasta:'311', alertas_ap:[false,false,false,false], alertas_lg:[true,true,true,true], timestamp:'2026-06-07T23:00:00.000Z' },
    ],
  };
  if (id === 'MAQ-009') return {
    id_maquina:id, producto:'Recarga CO2 std', lote:'25489', cliente:'Horeca BA', orden_id:'OP-2026-0479', activa:true, ordenes_historial:[],
    registros:[
      { id_reg:'MAQ-009-R001', id_maquina:'MAQ-009', nro_caja:'74', hora:'20:45', fecha:'07/06/2026', turno:'N', sesion_id:'SES-20260607-2031', lote:'25489', producto:'Recarga CO2 std', cliente:'Horeca BA', orden_id:'OP-2026-0479', inspector_legajo:'CAL3', inspector_nombre:'Romero, Ana', apertura_tapa:['1000','1050','1020','980'], largo_cabezal:['122.1','122.0','121.8','122.3'], no_conforme:'Sí', defectos:['Otro'], observacion_libre:'PN PASA JUSTO SE DA NOTIFICACION', cantidad_rechazo:'1', caja_desde:'74', caja_hasta:'74', alertas_ap:[false,false,false,false], alertas_lg:[false,false,false,false], timestamp:'2026-06-07T23:45:00.000Z' },
    ],
  };
  return ordenVacia(id);
});

// ─── FÁBRICA DE ESTILOS (mapeada a los tokens del sistema) ────────────────────
const mk = (t) => ({
  root:{display:'flex',flexDirection:'column',background:t.bg,color:t.text,fontFamily:"'Manrope',system-ui,sans-serif",fontSize:14},
  toolbar:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 20px',background:t.surface,borderBottom:`1px solid ${t.border}`,gap:12,flexWrap:'wrap'},
  toolbarTitle:{fontWeight:600,fontSize:15,color:t.text,fontFamily:"'Bricolage Grotesque',Manrope,sans-serif"},
  badge:{background:t.success,color:t.bg,fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:4,letterSpacing:'0.08em'},
  mono:{color:t.textDim,fontSize:11,fontFamily:"'JetBrains Mono',monospace"},
  turnoChip:{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:4,border:`1px solid ${t.accent}`,color:t.accent,background:'transparent'},
  btnSec:{background:t.surface,color:t.textMuted,border:`1px solid ${t.border}`,borderRadius:6,padding:'6px 12px',fontSize:12,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6,fontFamily:'Manrope'},
  btnVolver:{background:t.surface,color:t.accent,border:`1px solid ${t.accent}`,borderRadius:6,padding:'6px 12px',fontSize:12,cursor:'pointer',fontWeight:500,display:'inline-flex',alignItems:'center',gap:6,fontFamily:'Manrope'},

  bannerRangos:{display:'flex',alignItems:'center',gap:0,background:t.warnSoft,borderBottom:`2px solid ${t.warn}`},
  rangoFijo:{display:'flex',alignItems:'center',gap:10,padding:'8px 20px',flex:1},
  rangoTit:{display:'block',fontSize:10,color:t.textMuted,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:2},
  rangoVal:{display:'block',fontSize:13,fontWeight:600,color:t.warn},
  rangoDivisor:{width:1,height:40,background:t.warn,opacity:0.4},

  body:{padding:'20px 24px'},
  tableroTop:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20,flexWrap:'wrap',gap:12},
  tableroTit:{margin:'0 0 4px',fontSize:18,fontWeight:600,color:t.text,fontFamily:"'Bricolage Grotesque',Manrope,sans-serif"},
  tableroPie:{margin:0,fontSize:12,color:t.textMuted},
  statRow:{display:'flex',gap:12},
  statBox:{background:t.surface,border:`1px solid ${t.border}`,borderRadius:8,padding:'10px 18px',textAlign:'center'},
  statNum:{display:'block',fontSize:22,fontWeight:700,lineHeight:1},
  statLbl:{display:'block',fontSize:10,color:t.textDim,marginTop:2,textTransform:'uppercase',letterSpacing:'0.06em'},

  maqGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))',gap:14},
  maqCard:{background:t.surface,border:`2px solid ${t.border}`,borderRadius:12,overflow:'hidden',display:'flex',flexDirection:'column'},
  maqCardHead:{padding:'10px 14px',display:'flex',alignItems:'center',justifyContent:'space-between'},
  maqId:{fontSize:13,fontWeight:700,letterSpacing:'0.04em'},
  badgeActiva:{background:t.successSoft,color:t.success,fontSize:9,fontWeight:600,padding:'2px 7px',borderRadius:4},
  badgeSinOrden:{background:t.surfaceHi,color:t.textDim,fontSize:9,fontWeight:600,padding:'2px 7px',borderRadius:4},
  badgeSinAsig:{background:t.surfaceHi,color:t.textDim,fontSize:9,fontWeight:600,padding:'2px 7px',borderRadius:4},
  maqCardBody:{padding:'10px 14px',flex:1},
  maqCardBodyVacia:{padding:'20px 14px',flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'},
  maqProd:{margin:'0 0 8px',fontSize:13,fontWeight:600,color:t.text},
  maqMetaRow:{display:'flex',gap:8,alignItems:'baseline',marginBottom:3},
  maqMetaLbl:{fontSize:10,color:t.textDim,textTransform:'uppercase',width:44,flexShrink:0},
  maqMetaVal:{fontSize:12,color:t.text,fontWeight:500},
  maqLimites:{background:t.surfaceHi,borderRadius:6,padding:'5px 8px',marginTop:6},
  maqLimitesLbl:{display:'block',fontSize:10,color:t.textMuted},
  maqStats:{display:'flex',borderTop:`1px solid ${t.border}`,marginTop:10,paddingTop:10},
  maqStat:{flex:1,textAlign:'center'},
  maqStatNum:{display:'block',fontSize:18,fontWeight:700,lineHeight:1},
  maqStatLbl:{display:'block',fontSize:9,color:t.textDim,textTransform:'uppercase',marginTop:2},
  maqCardFoot:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 14px',borderTop:`1px solid ${t.border}`},
  btnCambiarOrden:{background:'none',border:`1px solid ${t.border}`,color:t.textMuted,fontSize:10,padding:'3px 8px',borderRadius:5,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4},

  bannerMaq:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 24px',background:t.surface,borderBottom:'2px solid',flexWrap:'wrap',gap:12},
  maqBadge:{fontSize:15,fontWeight:700,padding:'5px 12px',borderRadius:8,border:`2px solid ${t.border}`},
  bannerProd:{margin:'0 0 3px',fontSize:14,fontWeight:600,color:t.text},
  bannerMeta:{fontSize:12,color:t.textMuted},
  bannerMetaLbl:{color:t.textDim,marginRight:4},
  btnCambiarOrden2:{background:t.surface,border:`1px solid ${t.warn}`,color:t.warn,fontSize:12,padding:'7px 14px',borderRadius:8,cursor:'pointer',fontWeight:500,display:'inline-flex',alignItems:'center',gap:6},
  alertaBanner:{background:t.warnSoft,borderBottom:`2px solid ${t.warn}`,padding:'8px 24px',fontSize:13,color:t.warn,display:'flex',alignItems:'center',gap:8},

  main:{display:'flex',flexWrap:'wrap'},
  colL:{flex:'1.1 1 360px',padding:'20px 24px',borderRight:`1px solid ${t.border}`,minWidth:320},
  colR:{flex:'0.9 1 320px',padding:'20px 24px',background:t.surfaceHi,minWidth:300},
  secTit:{fontSize:12,fontWeight:600,color:t.textMuted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16,marginTop:0,fontFamily:"'JetBrains Mono',monospace",display:'flex',alignItems:'center',gap:8},

  campo:{marginBottom:16},
  label:{display:'block',fontSize:12,color:t.textMuted,marginBottom:6,fontWeight:500},
  req:{color:t.danger},
  limiteInline:{color:t.warn,fontSize:11,fontStyle:'italic'},
  input:{width:'100%',background:t.surfaceHi,border:`1px solid ${t.border}`,borderRadius:6,color:t.text,padding:'10px 12px',fontSize:14,boxSizing:'border-box',outline:'none',fontFamily:'Manrope'},
  inputRO:{background:t.bg,border:`1px solid ${t.border}`,borderRadius:6,color:t.textDim,padding:'10px 12px',fontSize:14},
  select:{width:'100%',background:t.surfaceHi,border:`1px solid ${t.border}`,borderRadius:6,color:t.text,padding:'10px 12px',fontSize:14,boxSizing:'border-box',outline:'none',fontFamily:'Manrope'},
  textarea:{width:'100%',background:t.surfaceHi,border:`1px solid ${t.border}`,borderRadius:6,color:t.text,padding:'10px 12px',fontSize:14,boxSizing:'border-box',resize:'vertical',outline:'none',fontFamily:'Manrope'},

  medGrid:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8},
  medItem:{display:'flex',flexDirection:'column',gap:4,alignItems:'center'},
  medLbl:{fontSize:11,color:t.textDim,fontWeight:600},
  medInput:{background:t.surfaceHi,border:`1px solid ${t.border}`,borderRadius:6,color:t.accent,padding:'8px 4px',fontSize:16,textAlign:'center',fontWeight:600,outline:'none',width:'100%',boxSizing:'border-box',fontFamily:"'JetBrains Mono',monospace"},
  medInputAlerta:{border:`2px solid ${t.danger}`,color:t.danger,background:t.dangerSoft},
  medInputOK:{border:`1px solid ${t.success}`,color:t.success},
  medAlertaLbl:{fontSize:9,color:t.danger,fontWeight:600},

  chipGrid:{display:'flex',flexWrap:'wrap',gap:6},
  chip:{background:t.surfaceHi,border:`1px solid ${t.border}`,color:t.textMuted,borderRadius:6,padding:'5px 10px',fontSize:11,cursor:'pointer',fontWeight:500,fontFamily:'Manrope'},
  chipOn:{background:t.dangerSoft,border:`1px solid ${t.danger}`,color:t.danger},

  toggleRow:{display:'flex',gap:8,marginBottom:20},
  toggleBtn:{flex:1,padding:'10px',borderRadius:8,border:`2px solid ${t.border}`,cursor:'pointer',fontSize:13,fontWeight:500,background:t.surfaceHi,color:t.textMuted,fontFamily:'Manrope'},
  tNC:{background:t.dangerSoft,border:`2px solid ${t.danger}`,color:t.danger},
  tOK:{background:t.successSoft,border:`2px solid ${t.success}`,color:t.success},
  panelNC:{background:t.dangerSoft,border:`1px solid ${t.danger}60`,borderRadius:8,padding:16,marginBottom:16},
  conformeBox:{textAlign:'center',padding:'28px 0'},
  btnGuardar:{width:'100%',background:t.accent,color:t.bg,border:'none',borderRadius:8,padding:'14px',fontSize:15,fontWeight:600,cursor:'pointer',marginTop:8,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,fontFamily:'Manrope'},
  btnOK:{background:t.success},
  btnDis:{background:t.surfaceHi,color:t.textDim,cursor:'not-allowed'},

  ultimos:{marginTop:16,borderTop:`1px solid ${t.border}`,paddingTop:14},
  ultimosTit:{fontSize:11,color:t.textMuted,textTransform:'uppercase',letterSpacing:'0.08em',margin:'0 0 8px'},
  regRow:{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:`1px solid ${t.border}`},

  historialBox:{background:t.surfaceHi,border:`1px solid ${t.border}`,borderRadius:8,padding:14,marginTop:8},
  historialTit:{margin:'0 0 10px',fontSize:11,color:t.textMuted,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em',display:'flex',alignItems:'center',gap:6},
  historialItem:{display:'flex',alignItems:'center',gap:12,padding:'6px 0',borderBottom:`1px solid ${t.border}`},
  historialProd:{fontSize:12,color:t.text,fontWeight:500,flex:1},
  historialMeta:{fontSize:11,color:t.textDim},
  historialCnt:{fontSize:11,color:t.textMuted,fontWeight:600},

  listadoWrap:{display:'flex',flexWrap:'wrap'},
  listadoSidebar:{width:240,flexShrink:0,borderRight:`1px solid ${t.border}`,padding:'16px 12px',background:t.surfaceHi},
  sidebarTit:{margin:'0 0 12px',fontSize:11,color:t.textMuted,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em'},
  sidebarBtn:{width:'100%',background:'none',border:`1px solid ${t.border}`,borderRadius:8,padding:'8px 10px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6,textAlign:'left'},
  sidebarBtnActivo:{background:t.surface,borderColor:t.accent},
  sidebarBadge:{background:t.surface,color:t.textMuted,fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:4},
  listadoMain:{flex:1,overflowX:'auto',minWidth:320},
  tabla:{width:'100%',borderCollapse:'collapse',fontSize:12},
  th:{padding:'10px 12px',textAlign:'left',fontSize:11,fontWeight:600,color:t.warn,textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:`2px solid ${t.warn}`,whiteSpace:'nowrap',background:t.warnSoft},
  tablaFila:{borderBottom:`1px solid ${t.border}`},
  tablaFilaNC:{background:t.dangerSoft},
  tablaFilaSeleccionada:{background:t.accentSoft,outline:`2px solid ${t.accent}`,outlineOffset:'-2px'},
  td:{padding:'8px 12px',color:t.textMuted,verticalAlign:'top'},
  estadoPill:{color:'#fff',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4},

  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:20},
  modalCard:{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:28,width:'100%',maxWidth:480,maxHeight:'90vh',overflowY:'auto'},
  alertaCambio:{background:t.warnSoft,border:`1px solid ${t.warn}`,borderRadius:8,padding:'10px 14px',color:t.warn,fontSize:12,marginBottom:16},
  rangosBox:{background:t.surfaceHi,border:`1px solid ${t.warn}`,borderRadius:8,padding:'10px 14px',marginBottom:16},
  rangosTit:{margin:'0 0 6px',fontSize:11,color:t.warn,fontWeight:600},

  setupRoot:{minHeight:'70vh',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'24px'},
  setupCard:{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,width:'100%',maxWidth:860,overflow:'hidden'},
  setupHeader:{background:t.surfaceHi,padding:'28px 32px 22px',textAlign:'center',borderBottom:`1px solid ${t.border}`},
  logo:{width:44,height:44,background:t.accent,borderRadius:10,fontSize:26,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px',color:t.bg,fontFamily:"'Bricolage Grotesque',Manrope,sans-serif"},
  setupTit:{fontSize:20,fontWeight:600,color:t.text,margin:'0 0 6px',fontFamily:"'Bricolage Grotesque',Manrope,sans-serif"},
  setupSub:{color:t.textMuted,fontSize:13,margin:0},
  setupBody:{padding:'24px 28px'},
  turnoBtn:{padding:'10px 20px',background:t.surfaceHi,border:`2px solid ${t.border}`,borderRadius:8,color:t.textMuted,cursor:'pointer',fontWeight:600,fontSize:13,fontFamily:'Manrope'},
  asigSection:{background:t.surfaceHi,borderRadius:12,padding:20,marginBottom:20},
  asigTit:{margin:'0 0 4px',fontSize:15,fontWeight:600,color:t.text,fontFamily:"'Bricolage Grotesque',Manrope,sans-serif"},
  asigSub:{margin:0,fontSize:12,color:t.textMuted},
  contadorBadge:{background:t.surface,border:`1px solid ${t.border}`,borderRadius:8,padding:'8px 14px',textAlign:'center',flexShrink:0},
  contadorNum:{display:'block',fontSize:24,fontWeight:700,color:t.accent,lineHeight:1},
  contadorLbl:{display:'block',fontSize:10,color:t.textDim,marginTop:2},
  agregarRow:{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:16,padding:'10px 12px',background:t.surface,borderRadius:8},
  agregarLbl:{fontSize:12,color:t.textMuted,fontWeight:500},
  btnAgregar:{background:t.surfaceHi,border:`1px solid ${t.border}`,color:t.textMuted,borderRadius:8,padding:'6px 14px',fontSize:13,cursor:'pointer',fontFamily:'Manrope'},
  maqPicker:{background:t.surfaceHi,border:`1px solid ${t.border}`,color:t.textMuted,borderRadius:8,padding:'7px 4px',fontSize:10,fontWeight:600,cursor:'pointer',textAlign:'center',fontFamily:'Manrope'},
  btnQuitarInsp:{background:'rgba(0,0,0,0.25)',border:'none',color:t.textMuted,padding:'5px 12px',borderRadius:6,cursor:'pointer',fontSize:12,display:'inline-flex',alignItems:'center',gap:4},
  hintBox:{background:t.infoSoft,border:`1px solid ${t.info}40`,borderRadius:8,padding:'12px 16px',color:t.info,fontSize:13,lineHeight:1.6,marginBottom:16},
  btnIniciar:{width:'100%',background:t.accent,color:t.bg,border:'none',borderRadius:10,padding:'14px',fontSize:16,fontWeight:600,cursor:'pointer',fontFamily:'Manrope'},
  btnIniciarDis:{background:t.surfaceHi,color:t.textDim,cursor:'not-allowed'},
});

// ─── BANNER RANGOS ────────────────────────────────────────────────────────────
function BannerRangos({ producto, t, S, modoListado=false }) {
  const limL = producto ? PRODUCTOS[producto] : null;
  return (
    <div style={S.bannerRangos}>
      <div style={S.rangoFijo}>
        <Ruler size={16} color={t.warn} />
        <div>
          <span style={S.rangoTit}>Apertura de tapa — rango fijo</span>
          <span style={S.rangoVal}>{APERTURA_MIN} g – {APERTURA_MAX} g</span>
        </div>
      </div>
      <div style={S.rangoDivisor}/>
      <div style={S.rangoFijo}>
        <Ruler size={16} color={t.warn} />
        <div>
          {limL ? (
            <>
              <span style={S.rangoTit}>Largo de cabezal — {producto}</span>
              <span style={S.rangoVal}>{limL.largo_min} mm – {limL.largo_max} mm (nominal {limL.largo_nom} mm ± 2 mm)</span>
            </>
          ) : (
            <>
              <span style={S.rangoTit}>Largo de cabezal</span>
              <span style={{...S.rangoVal,color:t.textDim,fontSize:11,fontStyle:'italic',fontWeight:400}}>
                {modoListado ? 'Hacé click en un registro para ver el rango del producto' : '— cargá la orden para ver el rango'}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TOOLBAR DEL MÓDULO ───────────────────────────────────────────────────────
function CCToolbar({ sesion, totalReg, totalNC, onSetup, onListado, extra, t, S }) {
  const turno = TURNOS.find(x=>x.id===sesion.turno);
  return (
    <div style={S.toolbar}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        {extra}
        <span style={S.badge}>SESIÓN</span>
        <span style={S.mono}>{sesion.id}</span>
        {turno && <span style={S.turnoChip}>{turno.label}</span>}
      </div>
      <span style={S.toolbarTitle}>Control de Calidad</span>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <span style={{fontSize:12,color:t.textMuted}}>{totalReg} reg · <span style={{color:totalNC>0?t.danger:t.success}}>{totalNC} NC</span></span>
        <button style={{...S.btnSec,color:t.accent,borderColor:t.accent}} onClick={onListado}><ClipboardList size={14}/> Ver listado</button>
        <button style={S.btnSec} onClick={onSetup}><Settings size={14}/> Setup</button>
      </div>
    </div>
  );
}

// ─── MODAL ORDEN ──────────────────────────────────────────────────────────────
function ModalOrden({ maqId, form, onChange, onConfirm, onCancel, esCambio, ordenAnterior, t, S }) {
  const valido = form.producto && form.lote && form.cliente;
  const limL = form.producto ? PRODUCTOS[form.producto] : null;
  return (
    <div style={S.overlay}>
      <div style={S.modalCard}>
        <h3 style={{margin:'0 0 4px',fontSize:17,fontWeight:600,color:t.text,fontFamily:"'Bricolage Grotesque',Manrope,sans-serif"}}>{esCambio?'Cambio de orden':'Nueva orden'}</h3>
        <p style={{margin:'0 0 16px',fontSize:12,color:t.textDim}}>{maqId}{esCambio&&ordenAnterior?` · Actual: ${ordenAnterior}`:''}</p>
        {esCambio && <div style={S.alertaCambio}>Los registros de la orden actual quedan archivados. La nueva orden comienza desde cero.</div>}
        <div style={S.campo}>
          <label style={S.label}>Producto <span style={S.req}>*</span></label>
          <select style={S.select} value={form.producto} onChange={e=>onChange('producto',e.target.value)}>
            <option value="">Seleccionar…</option>
            {Object.keys(PRODUCTOS).map(p=><option key={p}>{p}</option>)}
          </select>
        </div>
        {limL && (
          <div style={S.rangosBox}>
            <p style={S.rangosTit}>Rangos para este producto:</p>
            <p style={{margin:0,fontSize:12,color:t.textMuted}}>Apertura: <strong style={{color:t.text}}>{APERTURA_MIN}g – {APERTURA_MAX}g</strong> (fijo universal)</p>
            <p style={{margin:'4px 0 0',fontSize:12,color:t.textMuted}}>Largo cabezal: <strong style={{color:t.text}}>{limL.largo_min} – {limL.largo_max} mm</strong></p>
          </div>
        )}
        <div style={S.campo}>
          <label style={S.label}>N° de lote <span style={S.req}>*</span></label>
          <input style={S.input} type="text" placeholder="Ej: 25503" value={form.lote} onChange={e=>onChange('lote',e.target.value)}/>
        </div>
        <div style={S.campo}>
          <label style={S.label}>Orden de producción (opcional)</label>
          <input style={S.input} type="text" placeholder="Ej: OP-2026-0481" value={form.orden_id} onChange={e=>onChange('orden_id',e.target.value)}/>
        </div>
        <div style={S.campo}>
          <label style={S.label}>Cliente <span style={S.req}>*</span></label>
          <select style={S.select} value={form.cliente} onChange={e=>onChange('cliente',e.target.value)}>
            <option value="">Seleccionar…</option>
            {CLIENTES.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{display:'flex',gap:10,marginTop:8}}>
          <button style={{...S.btnSec,flex:1,justifyContent:'center'}} onClick={onCancel}>Cancelar</button>
          <button style={{...S.btnGuardar,flex:2,marginTop:0,...(!valido?S.btnDis:{})}} onClick={onConfirm} disabled={!valido}>{esCambio?'Confirmar cambio':'Iniciar orden'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
function Setup({ sesion, onTurno, onAgregar, onQuitar, onToggleMaq, maqAsignadas, valido, onStart, t, S, COL }) {
  const disponibles = INSPECTORES.filter(i=>!sesion.inspectores.find(x=>x.nombre===i.nombre));
  return (
    <div style={S.setupRoot}>
      <div style={S.setupCard}>
        <div style={S.setupHeader}>
          <div style={S.logo}>S</div>
          <h1 style={S.setupTit}>Configuración del turno</h1>
          <p style={S.setupSub}>Elegí el turno y asigná inspectores a sus máquinas.</p>
        </div>
        <div style={S.setupBody}>
          <div style={{marginBottom:24}}>
            <label style={S.label}>Turno <span style={S.req}>*</span></label>
            <div style={{display:'flex',gap:10}}>
              {TURNOS.map(x=>(
                <button key={x.id} style={{...S.turnoBtn,...(sesion.turno===x.id?{borderColor:t.accent,color:t.accent}:{})}} onClick={()=>onTurno(x.id)}>{x.label}</button>
              ))}
            </div>
          </div>
          <div style={S.asigSection}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}>
              <div><h3 style={S.asigTit}>Inspectores y máquinas</h3><p style={S.asigSub}>Una máquina, un inspector.</p></div>
              <div style={S.contadorBadge}><span style={S.contadorNum}>{maqAsignadas.length}</span><span style={S.contadorLbl}>/ 10</span></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:6,marginBottom:16}}>
              {MAQUINAS_LIST.map(m=>{
                const idx=sesion.inspectores.findIndex(i=>i.maquinas.includes(m));
                const col=idx>=0?COL[idx%4]:null;
                const dueno=idx>=0?sesion.inspectores[idx]:null;
                return(<div key={m} style={{border:'1px solid',borderRadius:8,padding:'8px 4px',textAlign:'center',background:col?col.bg:t.surfaceHi,borderColor:col?col.border:t.border,display:'flex',flexDirection:'column',gap:2}}>
                  <span style={{fontSize:10,fontWeight:700,color:col?col.text:t.textDim}}>{m}</span>
                  {dueno&&<span style={{fontSize:9,color:col.text,opacity:0.75}}>{dueno.nombre.split(',')[0].split(' ')[0]}</span>}
                </div>);
              })}
            </div>
            {disponibles.length>0 && sesion.inspectores.length<4 && (
              <div style={S.agregarRow}>
                <span style={S.agregarLbl}>+ Agregar:</span>
                {disponibles.map(i=>(<button key={i.legajo} style={S.btnAgregar} onClick={()=>onAgregar(i.nombre)}>{i.nombre} <span style={{opacity:0.55,fontSize:11}}>({i.legajo})</span></button>))}
              </div>
            )}
            {sesion.inspectores.length===0 && <p style={{color:t.textDim,textAlign:'center',padding:'20px 0',margin:0,fontSize:13}}>Agregá al menos un inspector</p>}
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {sesion.inspectores.map((insp,idx)=>{
                const col=COL[idx%4];
                return(
                  <div key={insp.nombre} style={{border:`2px solid ${col.border}`,borderRadius:12,overflow:'hidden'}}>
                    <div style={{background:col.bg,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{width:34,height:34,borderRadius:8,background:col.border,color:t.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700}}>{insp.nombre.split(',')[0][0]}</div>
                        <div><p style={{margin:0,fontWeight:600,color:col.text,fontSize:13}}>{insp.nombre}</p><p style={{margin:0,fontSize:11,color:col.text,opacity:0.75}}>{insp.legajo} · {insp.maquinas.length} máquina{insp.maquinas.length!==1?'s':''}</p></div>
                      </div>
                      <button style={S.btnQuitarInsp} onClick={()=>onQuitar(insp.nombre)}><X size={12}/> Quitar</button>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:6,padding:'12px 16px',background:'rgba(0,0,0,0.18)'}}>
                      {MAQUINAS_LIST.map(m=>{
                        const esMia=insp.maquinas.includes(m);
                        const esDeOtro=maqAsignadas.includes(m)&&!esMia;
                        return(<button key={m} style={{...S.maqPicker,...(esMia?{background:col.bg,borderColor:col.border,color:col.text}:{}),...(esDeOtro?{opacity:0.35,cursor:'not-allowed'}:{})}}
                          onClick={()=>onToggleMaq(insp.nombre,m)} disabled={esDeOtro}>{m}{esMia?' ✓':''}</button>);
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{borderTop:`1px solid ${t.border}`,paddingTop:20}}>
            {sesion.inspectores.length>0 && (
              <div style={{background:t.surfaceHi,borderRadius:8,padding:'12px 16px',marginBottom:14}}>
                <p style={{margin:'0 0 8px',fontSize:11,color:t.textDim,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Resumen</p>
                {sesion.inspectores.map(i=>(<p key={i.nombre} style={{margin:'4px 0',fontSize:13,color:t.textMuted}}><strong style={{color:t.text}}>{i.nombre.split(',')[0]}</strong>: {i.maquinas.length===0?'sin máquinas':i.maquinas.join(', ')}</p>))}
              </div>
            )}
            <div style={S.hintBox}>Productos y lotes se cargan al entrar a cada máquina. Los rangos de aceptación están siempre visibles durante el control.</div>
            <button style={{...S.btnIniciar,...(!valido?S.btnIniciarDis:{})}} onClick={onStart} disabled={!valido}>Ir al tablero</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({label,value,color,S}){return(<div style={S.statBox}><span style={{...S.statNum,color}}>{value}</span><span style={S.statLbl}>{label}</span></div>);}

// ─── VISTA LISTADO ────────────────────────────────────────────────────────────
function VistaListado({ registros, maquinas, sesion, onVolver, t, S }) {
  const [filtroMaq, setFiltroMaq] = useState('TODAS');
  const [filaSeleccionada, setFilaSeleccionada] = useState(null);
  const turno = TURNOS.find(x=>x.id===sesion.turno);

  const productoFila = useMemo(()=>{
    if (!filaSeleccionada) return null;
    return registros.find(r=>r.id_reg===filaSeleccionada)?.producto || null;
  },[filaSeleccionada, registros]);

  const resumenPorMaq = useMemo(()=>{
    const map={};
    maquinas.forEach(m=>{
      const todosReg=[...m.registros,...m.ordenes_historial.flatMap(o=>o.registros)];
      map[m.id_maquina]={
        total:todosReg.length,
        ok:todosReg.filter(r=>r.no_conforme==='No').length,
        nc:todosReg.filter(r=>r.no_conforme==='Sí').length,
        producto:m.producto||'—',
        inspector:sesion.inspectores.find(i=>i.maquinas.includes(m.id_maquina))?.nombre.split(',')[0]||'—',
      };
    });
    return map;
  },[maquinas,sesion]);

  const regFiltrados = filtroMaq==='TODAS'?registros:registros.filter(r=>r.id_maquina===filtroMaq);

  return (
    <div style={S.root}>
      <CCToolbar sesion={sesion} totalReg={registros.length} totalNC={registros.filter(r=>r.no_conforme==='Sí').length} onSetup={onVolver} onListado={()=>{}} t={t} S={S}
        extra={<button style={S.btnVolver} onClick={onVolver}><ArrowLeft size={14}/> Volver</button>}/>
      <BannerRangos producto={productoFila} modoListado={true} t={t} S={S}/>
      <div style={S.listadoWrap}>
        <div style={S.listadoSidebar}>
          <p style={S.sidebarTit}>Cajas por máquina · Turno {turno?.label||''}</p>
          <button style={{...S.sidebarBtn,...(filtroMaq==='TODAS'?S.sidebarBtnActivo:{})}} onClick={()=>setFiltroMaq('TODAS')}>
            <span style={{fontWeight:600,color:t.text}}>TODAS</span>
            <span style={S.sidebarBadge}>{registros.length}</span>
          </button>
          {maquinas.map(m=>{
            const r=resumenPorMaq[m.id_maquina];
            const activo=filtroMaq===m.id_maquina;
            return(
              <button key={m.id_maquina} style={{...S.sidebarBtn,...(activo?S.sidebarBtnActivo:{})}} onClick={()=>setFiltroMaq(m.id_maquina)}>
                <div style={{flex:1,textAlign:'left'}}>
                  <span style={{fontWeight:600,color:activo?t.accent:t.text,fontSize:12}}>{m.id_maquina}</span>
                  <span style={{display:'block',fontSize:10,color:t.textDim}}>{r.inspector} · {r.producto}</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:2}}>
                  <span style={S.sidebarBadge}>{r.total} cajas</span>
                  {r.nc>0&&<span style={{...S.sidebarBadge,background:t.dangerSoft,color:t.danger}}>{r.nc} NC</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div style={S.listadoMain}>
          {regFiltrados.length===0?(
            <div style={{textAlign:'center',padding:'60px 0',color:t.textDim}}>
              <ClipboardList size={32} color={t.textDim}/>
              <p style={{margin:'12px 0 0'}}>Sin registros{filtroMaq!=='TODAS'?` para ${filtroMaq}`:''}</p>
            </div>
          ):(
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Lote</th><th style={S.th}>Fecha</th><th style={S.th}>Hora</th><th style={S.th}>N° Caja</th>
                  <th style={S.th}>Inspector</th><th style={S.th}>Máquina</th><th style={S.th}>Defecto / Observación</th>
                  <th style={S.th}>Producto</th><th style={S.th}>Cliente</th><th style={{...S.th,textAlign:'center'}}>Estado</th>
                  <th style={S.th}>Cant.</th><th style={S.th}>Apertura (g)</th><th style={S.th}>Largo (mm)</th>
                </tr>
              </thead>
              <tbody>
                {regFiltrados.map((r,i)=>{
                  const apFuera=r.alertas_ap?.some(Boolean);
                  const lgFuera=r.alertas_lg?.some(Boolean);
                  const esNC=r.no_conforme==='Sí';
                  const sel=filaSeleccionada===r.id_reg;
                  return(
                    <tr key={r.id_reg||i} onClick={()=>setFilaSeleccionada(sel?null:r.id_reg)}
                      style={{...S.tablaFila,...(esNC?S.tablaFilaNC:{}),...(sel?S.tablaFilaSeleccionada:{}),cursor:'pointer'}}>
                      <td style={S.td}>{r.lote}</td>
                      <td style={{...S.td,color:t.textDim,whiteSpace:'nowrap'}}>{r.fecha}</td>
                      <td style={{...S.td,color:t.textDim,whiteSpace:'nowrap',fontFamily:"'JetBrains Mono',monospace"}}>{r.hora?`${r.hora}hs`:'—'}</td>
                      <td style={{...S.td,fontWeight:600,color:t.text}}>{r.nro_caja}</td>
                      <td style={S.td}>{r.inspector_nombre?.split(',')[0]||'—'}</td>
                      <td style={{...S.td,fontWeight:600,color:t.textMuted}}>{r.id_maquina}</td>
                      <td style={{...S.td,maxWidth:220}}>
                        <span style={{fontSize:12,color:esNC?t.danger:t.textMuted}}>{[...(r.defectos||[]),r.observacion_libre].filter(Boolean).join(' · ')||'—'}</span>
                      </td>
                      <td style={{...S.td,color:t.textMuted}}>{r.producto}</td>
                      <td style={{...S.td,color:t.textMuted}}>{r.cliente}</td>
                      <td style={{...S.td,textAlign:'center'}}><span style={{...S.estadoPill,background:esNC?t.danger:t.success}}>{esNC?'NC':'OK'}</span></td>
                      <td style={S.td}>
                        {esNC?(
                          <div style={{display:'flex',flexDirection:'column',gap:2}}>
                            <span style={{fontWeight:600,color:t.danger,fontSize:13}}>{r.cantidad_rechazo} uds.</span>
                            {r.caja_desde&&r.caja_hasta&&<span style={{fontSize:11,color:t.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>caja {r.caja_desde} → {r.caja_hasta}</span>}
                          </div>
                        ):<span style={{color:t.textDim}}>—</span>}
                      </td>
                      <td style={{...S.td,fontSize:11}}><span style={{color:apFuera?t.warn:t.textDim}}>{r.apertura_tapa?.map((v,i)=>`C${i+1}:${v}`).join(' ')||'—'}{apFuera&&' ⚠'}</span></td>
                      <td style={{...S.td,fontSize:11}}><span style={{color:lgFuera?t.warn:t.textDim}}>{r.largo_cabezal?.map((v,i)=>`C${i+1}:${v}`).join(' ')||'—'}{lgFuera&&' ⚠'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function VistaControlCalidad({ t, currentUser }) {
  const S = useMemo(()=>mk(t),[t]);
  const COL = useMemo(()=>colInsp(t),[t]);

  const [fase, setFase] = useState('tablero');
  const [maquinaActiva, setMaqAct] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [guardado, setGuardado] = useState(false);
  const [modalOrden, setModalOrden] = useState(false);
  const [formOrden, setFormOrden] = useState({producto:'',lote:'',cliente:'',orden_id:''});
  const [vistaListado, setVistaListado] = useState(false);
  const [sesion, setSesion] = useState(SESION_EJEMPLO);
  const [maquinas, setMaquinas] = useState(MAQUINAS_EJEMPLO);

  const maqAsignadas = sesion.inspectores.flatMap(i=>i.maquinas);
  const inspDe = id => sesion.inspectores.find(i=>i.maquinas.includes(id));
  const colDe  = id => { const idx=sesion.inspectores.findIndex(i=>i.maquinas.includes(id)); return idx>=0?COL[idx%4]:null; };

  const agregarInsp = nombre => {
    if (sesion.inspectores.find(i=>i.nombre===nombre)) return;
    const leg=INSPECTORES.find(i=>i.nombre===nombre)?.legajo||'?';
    setSesion(s=>({...s,inspectores:[...s.inspectores,{legajo:leg,nombre,maquinas:[]}]}));
  };
  const quitarInsp = nombre => setSesion(s=>({...s,inspectores:s.inspectores.filter(i=>i.nombre!==nombre)}));
  const toggleMaqInsp = (nombre,maq) => {
    if (sesion.inspectores.some(i=>i.nombre!==nombre&&i.maquinas.includes(maq))) return;
    setSesion(s=>({...s,inspectores:s.inspectores.map(i=>{
      if(i.nombre!==nombre)return i;
      const ya=i.maquinas.includes(maq);
      return{...i,maquinas:ya?i.maquinas.filter(m=>m!==maq):[...i.maquinas,maq]};
    })}));
  };
  const setupValido = sesion.turno && sesion.inspectores.length>0 && sesion.inspectores.every(i=>i.maquinas.length>0);

  const getMaq = id => maquinas.find(m=>m.id_maquina===id);
  const setMaq = (id,fn) => setMaquinas(p=>p.map(m=>m.id_maquina===id?fn(m):m));

  const abrirModalOrden = id => {
    const m=getMaq(id); setMaqAct(id);
    setFormOrden({producto:m.producto,lote:m.lote,cliente:m.cliente,orden_id:m.orden_id});
    setModalOrden(true);
  };
  const confirmarOrden = () => {
    setMaq(maquinaActiva, m=>{
      const hist = m.activa&&m.registros.length>0 ? [...m.ordenes_historial,{...m,cerrada_en:nowTime()}] : m.ordenes_historial;
      return{...m,...formOrden,activa:true,registros:[],ordenes_historial:hist};
    });
    setModalOrden(false);
    if(fase==='tablero'){setFase('maquina');setForm(emptyForm());}
  };

  const hForm = (k,v) => setForm(f=>({...f,[k]:v}));
  const hMed  = (tipo,idx,v) => setForm(f=>{const a=[...f[tipo]];a[idx]=v;return{...f,[tipo]:a};});
  const toggleDef = d => setForm(f=>({...f,defectos:f.defectos.includes(d)?f.defectos.filter(x=>x!==d):[...f.defectos,d]}));

  const maq       = maquinaActiva?getMaq(maquinaActiva):null;
  const limLargo  = maq?.producto?PRODUCTOS[maq.producto]:null;
  const alertasAp = form.apertura_tapa.map(fueraApertura);
  const alertasLg = form.largo_cabezal.map(v=>fueraLargo(v,maq?.producto));
  const hayAlertas= alertasAp.some(Boolean)||alertasLg.some(Boolean);
  const inspActivo= maquinaActiva?inspDe(maquinaActiva):null;

  const formValido = form.nro_caja
    && form.apertura_tapa.every(v=>v!=='')
    && form.largo_cabezal.every(v=>v!=='')
    && (form.no_conforme==='No'||(form.cantidad_rechazo&&form.caja_desde&&form.caja_hasta));

  const guardar = () => {
    if(!formValido||!maquinaActiva) return;
    const r={
      ...form, hora:nowTime(),
      id_maquina:maquinaActiva, producto:maq.producto, lote:maq.lote, cliente:maq.cliente, orden_id:maq.orden_id,
      inspector_legajo:inspActivo?.legajo||'', inspector_nombre:inspActivo?.nombre||'',
      turno:sesion.turno, fecha:sesion.fecha, sesion_id:sesion.id,
      id_reg:`${maquinaActiva}-${maq.orden_id||'SN'}-R${String(maq.registros.length+1).padStart(3,'0')}`,
      timestamp:new Date().toISOString(), alertas_ap:alertasAp, alertas_lg:alertasLg,
    };
    setMaq(maquinaActiva,m=>({...m,registros:[r,...m.registros]}));
    setForm(emptyForm()); setGuardado(true);
    setTimeout(()=>setGuardado(false),2000);
  };

  const totalReg = maquinas.reduce((a,m)=>a+m.registros.length,0);
  const totalNC  = maquinas.reduce((a,m)=>a+m.registros.filter(r=>r.no_conforme==='Sí').length,0);

  const todosLosRegistros = useMemo(()=>{
    const arr=[];
    maquinas.forEach(m=>{
      m.ordenes_historial.forEach(o=>o.registros.forEach(r=>arr.push(r)));
      m.registros.forEach(r=>arr.push(r));
    });
    return arr.sort((a,b)=>b.timestamp?.localeCompare(a.timestamp||'')||0);
  },[maquinas]);

  // ── RENDER ────────────────────────────────────────────────────────────────
  if (fase==='setup') return (
    <Setup sesion={sesion} onTurno={v=>setSesion(s=>({...s,turno:v}))} onAgregar={agregarInsp} onQuitar={quitarInsp}
      onToggleMaq={toggleMaqInsp} maqAsignadas={maqAsignadas} valido={setupValido} onStart={()=>setFase('tablero')} t={t} S={S} COL={COL}/>
  );

  if (vistaListado) return <VistaListado registros={todosLosRegistros} maquinas={maquinas} sesion={sesion} onVolver={()=>setVistaListado(false)} t={t} S={S}/>;

  if (fase==='tablero') return (
    <div style={S.root}>
      <CCToolbar sesion={sesion} totalReg={totalReg} totalNC={totalNC} onSetup={()=>setFase('setup')} onListado={()=>setVistaListado(true)} t={t} S={S}/>
      <BannerRangos producto={null} t={t} S={S}/>
      <div style={S.body}>
        <div style={S.tableroTop}>
          <div>
            <h2 style={S.tableroTit}>Tablero de máquinas</h2>
            <p style={S.tableroPie}>Tocá una máquina para registrar un control</p>
          </div>
          <div style={S.statRow}>
            <Stat label="Registros" value={totalReg} color={t.info} S={S}/>
            <Stat label="No conformes" value={totalNC} color={totalNC>0?t.danger:t.success} S={S}/>
            <Stat label="Activas" value={maquinas.filter(m=>m.activa).length} color={t.accent} S={S}/>
          </div>
        </div>
        <div style={S.maqGrid}>
          {maquinas.map(m=>{
            const insp=inspDe(m.id_maquina); const col=colDe(m.id_maquina);
            const ncCnt=m.registros.filter(r=>r.no_conforme==='Sí').length;
            const okCnt=m.registros.filter(r=>r.no_conforme==='No').length;
            const sinAsig=!insp; const limL=m.producto?PRODUCTOS[m.producto]:null;
            return(
              <div key={m.id_maquina} style={{...S.maqCard,...(col?{borderColor:col.border}:{}),cursor:sinAsig?'default':'pointer',opacity:sinAsig?0.4:1}}
                onClick={()=>{if(sinAsig)return;setMaqAct(m.id_maquina);if(!m.activa){setFormOrden({producto:'',lote:'',cliente:'',orden_id:''});setModalOrden(true);}else{setFase('maquina');setForm(emptyForm());}}}>
                <div style={{...S.maqCardHead,...(col?{background:col.bg}:{})}}>
                  <span style={{...S.maqId,...(col?{color:col.text}:{color:t.textDim})}}>{m.id_maquina}</span>
                  {m.activa?<span style={S.badgeActiva}>EN PRODUCCIÓN</span>:sinAsig?<span style={S.badgeSinAsig}>SIN INSPECTOR</span>:<span style={S.badgeSinOrden}>SIN ORDEN</span>}
                </div>
                {m.activa?(
                  <div style={S.maqCardBody}>
                    <p style={S.maqProd}>{m.producto}</p>
                    <div style={S.maqMetaRow}><span style={S.maqMetaLbl}>Lote</span><span style={S.maqMetaVal}>{m.lote}</span></div>
                    <div style={S.maqMetaRow}><span style={S.maqMetaLbl}>Cliente</span><span style={S.maqMetaVal}>{m.cliente}</span></div>
                    {m.orden_id&&<div style={S.maqMetaRow}><span style={S.maqMetaLbl}>Orden</span><span style={{...S.maqMetaVal,fontFamily:"'JetBrains Mono',monospace",color:t.textMuted}}>{m.orden_id}</span></div>}
                    {limL&&<div style={S.maqLimites}><span style={S.maqLimitesLbl}>Largo cabezal: {limL.largo_min}–{limL.largo_max} mm</span></div>}
                    <div style={S.maqStats}>
                      <div style={S.maqStat}><span style={{...S.maqStatNum,color:t.success}}>{okCnt}</span><span style={S.maqStatLbl}>OK</span></div>
                      <div style={S.maqStat}><span style={{...S.maqStatNum,color:ncCnt>0?t.danger:t.textDim}}>{ncCnt}</span><span style={S.maqStatLbl}>NC</span></div>
                      <div style={S.maqStat}><span style={{...S.maqStatNum,color:t.textMuted}}>{m.registros.length}</span><span style={S.maqStatLbl}>Cajas</span></div>
                    </div>
                  </div>
                ):(
                  <div style={S.maqCardBodyVacia}>
                    {sinAsig?<p style={{color:t.textDim,fontSize:12,textAlign:'center',margin:0}}>Sin inspector asignado</p>
                    :<><Box size={26} color={t.textDim}/><p style={{color:t.textDim,fontSize:12,margin:'8px 0 0',textAlign:'center'}}>Tocá para cargar<br/>orden de producción</p></>}
                  </div>
                )}
                {insp&&(
                  <div style={{...S.maqCardFoot,...(col?{background:col.bg,borderTopColor:col.border}:{})}}>
                    <span style={{fontSize:11,color:col?.text||t.textDim,fontWeight:600}}>{insp.nombre.split(',')[0]}</span>
                    {m.activa&&<button style={S.btnCambiarOrden} onClick={e=>{e.stopPropagation();abrirModalOrden(m.id_maquina);}}><RotateCcw size={11}/> Cambiar orden</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {modalOrden&&<ModalOrden maqId={maquinaActiva} form={formOrden} onChange={(k,v)=>setFormOrden(f=>({...f,[k]:v}))} onConfirm={confirmarOrden} onCancel={()=>setModalOrden(false)} esCambio={getMaq(maquinaActiva)?.activa} ordenAnterior={getMaq(maquinaActiva)?.producto} t={t} S={S}/>}
    </div>
  );

  if (fase==='maquina'&&maq) {
    const col=colDe(maquinaActiva);
    return(
      <div style={S.root}>
        <CCToolbar sesion={sesion} totalReg={totalReg} totalNC={totalNC} onSetup={()=>setFase('setup')} onListado={()=>setVistaListado(true)} t={t} S={S}
          extra={<button style={S.btnVolver} onClick={()=>setFase('tablero')}><ArrowLeft size={14}/> Tablero</button>}/>
        <BannerRangos producto={maq.producto} t={t} S={S}/>
        {hayAlertas&&<div style={S.alertaBanner}><AlertTriangle size={16}/> Hay mediciones <strong>fuera de rango</strong> — revisá antes de guardar.</div>}

        <div style={{...S.bannerMaq,...(col?{borderBottomColor:col.border}:{borderBottomColor:t.border})}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{...S.maqBadge,...(col?{background:col.bg,color:col.text,borderColor:col.border}:{})}}>{maquinaActiva}</div>
            <div>
              <p style={S.bannerProd}>{maq.producto}</p>
              <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                <span style={S.bannerMeta}><span style={S.bannerMetaLbl}>Lote</span> {maq.lote}</span>
                {maq.orden_id&&<span style={S.bannerMeta}><span style={S.bannerMetaLbl}>Orden</span> {maq.orden_id}</span>}
                <span style={S.bannerMeta}><span style={S.bannerMetaLbl}>Cliente</span> {maq.cliente}</span>
                {inspActivo&&<span style={S.bannerMeta}><span style={S.bannerMetaLbl}>Inspector</span> {inspActivo.nombre.split(',')[0]}</span>}
                <span style={{...S.bannerMeta,color:t.accent,fontWeight:600}}><span style={S.bannerMetaLbl}>Cajas controladas</span> {maq.registros.length}</span>
              </div>
            </div>
          </div>
          <button style={S.btnCambiarOrden2} onClick={()=>{setFormOrden({producto:maq.producto,lote:maq.lote,cliente:maq.cliente,orden_id:maq.orden_id});setModalOrden(true);}}><RotateCcw size={14}/> Cambiar orden</button>
        </div>

        <div style={S.main}>
          <section style={S.colL}>
            <h2 style={S.secTit}><Box size={14}/> Datos del control</h2>
            <div style={S.campo}>
              <label style={S.label}>N° de caja <span style={S.req}>*</span></label>
              <input style={S.input} type="text" placeholder="Ej: 0142" value={form.nro_caja} onChange={e=>hForm('nro_caja',e.target.value)} autoFocus/>
            </div>
            <div style={S.campo}>
              <label style={S.label}>Hora del control</label>
              <div style={S.inputRO}>{form.hora} hs</div>
            </div>

            <div style={S.campo}>
              <label style={S.label}>Apertura de tapa – 4 cabezales <span style={S.req}>*</span>
                <span style={S.limiteInline}> (rango fijo: {APERTURA_MIN}g–{APERTURA_MAX}g)</span>
              </label>
              <div style={S.medGrid}>
                {[0,1,2,3].map(i=>(
                  <div key={i} style={S.medItem}>
                    <span style={S.medLbl}>C{i+1}</span>
                    <input style={{...S.medInput,...(alertasAp[i]?S.medInputAlerta:form.apertura_tapa[i]?S.medInputOK:{})}}
                      type="number" step="1" placeholder="0" value={form.apertura_tapa[i]} onChange={e=>hMed('apertura_tapa',i,e.target.value)}/>
                    {alertasAp[i]&&<span style={S.medAlertaLbl}>fuera</span>}
                  </div>
                ))}
              </div>
            </div>

            <div style={S.campo}>
              <label style={S.label}>Largo de cabezal – 4 cabezales <span style={S.req}>*</span>
                {limLargo&&<span style={S.limiteInline}> (rango: {limLargo.largo_min}–{limLargo.largo_max} mm)</span>}
              </label>
              <div style={S.medGrid}>
                {[0,1,2,3].map(i=>(
                  <div key={i} style={S.medItem}>
                    <span style={S.medLbl}>C{i+1}</span>
                    <input style={{...S.medInput,...(alertasLg[i]?S.medInputAlerta:form.largo_cabezal[i]?S.medInputOK:{})}}
                      type="number" step="0.1" placeholder="0.0" value={form.largo_cabezal[i]} onChange={e=>hMed('largo_cabezal',i,e.target.value)}/>
                    {alertasLg[i]&&<span style={S.medAlertaLbl}>fuera</span>}
                  </div>
                ))}
              </div>
            </div>

            <div style={S.campo}>
              <label style={S.label}>Defecto (seleccioná uno o más)</label>
              <div style={S.chipGrid}>
                {DEFECTOS_LISTA.map(d=>(
                  <button key={d} style={{...S.chip,...(form.defectos.includes(d)?S.chipOn:{})}} onClick={()=>toggleDef(d)}>{d}</button>
                ))}
              </div>
            </div>
            <div style={S.campo}>
              <label style={S.label}>Observación libre</label>
              <textarea style={S.textarea} rows={2} placeholder="Ej: Se encuentran (2) cabezales con pico descolorido (lote 290)…"
                value={form.observacion_libre} onChange={e=>hForm('observacion_libre',e.target.value)}/>
            </div>

            {maq.ordenes_historial.length>0&&(
              <div style={S.historialBox}>
                <p style={S.historialTit}><History size={13}/> Órdenes anteriores — {maquinaActiva}</p>
                {maq.ordenes_historial.map((o,i)=>(
                  <div key={i} style={S.historialItem}>
                    <span style={S.historialProd}>{o.producto}</span>
                    <span style={S.historialMeta}>Lote {o.lote} · cerrada {o.cerrada_en}hs</span>
                    <span style={S.historialCnt}>{o.registros.length} cajas</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={S.colR}>
            <h2 style={S.secTit}><AlertTriangle size={14}/> No conforme</h2>
            <div style={S.toggleRow}>
              {['No','Sí'].map(op=>(
                <button key={op} style={{...S.toggleBtn,...(form.no_conforme===op?(op==='Sí'?S.tNC:S.tOK):{})}}
                  onClick={()=>hForm('no_conforme',op)}>{op==='No'?'Conforme':'No conforme'}</button>
              ))}
            </div>
            {form.no_conforme==='Sí'&&(()=>{
              const desde=parseInt(form.caja_desde);
              const hasta=parseInt(form.caja_hasta);
              const cantIngresada=parseInt(form.cantidad_rechazo);
              const cantCalculada=(!isNaN(desde)&&!isNaN(hasta)&&hasta>=desde)?(hasta-desde+1):null;
              const hayDesajuste=cantCalculada!==null&&!isNaN(cantIngresada)&&cantIngresada!==cantCalculada;
              return(
                <div style={S.panelNC}>
                  <div style={S.campo}>
                    <label style={S.label}>Rango de cajas rechazadas <span style={S.req}>*</span></label>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <div style={{flex:1}}>
                        <span style={{fontSize:10,color:t.textDim,display:'block',marginBottom:4}}>Desde</span>
                        <input style={S.input} type="number" min="1" placeholder="N° caja" value={form.caja_desde} onChange={e=>hForm('caja_desde',e.target.value)}/>
                      </div>
                      <span style={{color:t.textDim,marginTop:18}}>→</span>
                      <div style={{flex:1}}>
                        <span style={{fontSize:10,color:t.textDim,display:'block',marginBottom:4}}>Hasta</span>
                        <input style={S.input} type="number" min="1" placeholder="N° caja" value={form.caja_hasta} onChange={e=>hForm('caja_hasta',e.target.value)}/>
                      </div>
                    </div>
                    {cantCalculada!==null&&(
                      <div style={{marginTop:8,padding:'7px 10px',background:t.bg,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                        <span style={{fontSize:12,color:t.textMuted}}>Cajas en ese rango:</span>
                        <span style={{fontSize:14,fontWeight:700,color:t.accent}}>{cantCalculada} uds.</span>
                      </div>
                    )}
                  </div>
                  <div style={S.campo}>
                    <label style={S.label}>Cantidad de rechazo <span style={S.req}>*</span>
                      <span style={{color:t.textDim,fontWeight:400}}> — confirmá o ajustá si no coincide</span>
                    </label>
                    <input style={{...S.input,...(hayDesajuste?{borderColor:t.warn,background:t.warnSoft}:{})}}
                      type="number" min="1" placeholder="Ej: 4" value={form.cantidad_rechazo} onChange={e=>hForm('cantidad_rechazo',e.target.value)}/>
                    {hayDesajuste&&(
                      <div style={{marginTop:6,padding:'8px 10px',background:t.warnSoft,border:`1px solid ${t.warn}`,borderRadius:6,display:'flex',alignItems:'flex-start',gap:8}}>
                        <AlertTriangle size={14} color={t.warn}/>
                        <div>
                          <p style={{margin:0,fontSize:12,color:t.warn,fontWeight:600}}>Desajuste detectado</p>
                          <p style={{margin:'2px 0 0',fontSize:11,color:t.warn}}>El rango caja {form.caja_desde}→{form.caja_hasta} contiene <strong>{cantCalculada} unidades</strong>, pero ingresaste <strong>{cantIngresada}</strong>.</p>
                        </div>
                      </div>
                    )}
                    {cantCalculada!==null&&(isNaN(cantIngresada)||form.cantidad_rechazo==='')&&(
                      <button style={{marginTop:6,background:'none',border:`1px solid ${t.accent}`,color:t.accent,borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',width:'100%'}}
                        onClick={()=>hForm('cantidad_rechazo',String(cantCalculada))}>Usar {cantCalculada} (calculado del rango)</button>
                    )}
                  </div>
                </div>
              );
            })()}
            {form.no_conforme==='No'&&(
              <div style={S.conformeBox}><CheckCircle2 size={40} color={t.success}/><p style={{color:t.success,margin:'8px 0 0',fontSize:13}}>Sin no conformidades.</p></div>
            )}
            <button style={{...S.btnGuardar,...(!formValido?S.btnDis:{}),...(guardado?S.btnOK:{})}} onClick={guardar} disabled={!formValido}>
              {guardado?<><Check size={16}/> Guardado</>:<><Save size={16}/> Guardar registro</>}
            </button>

            {maq.registros.length>0&&(
              <div style={S.ultimos}>
                <p style={S.ultimosTit}>Últimos — {maquinaActiva} ({maq.registros.length} cajas)</p>
                {maq.registros.slice(0,6).map(r=>(
                  <div key={r.id_reg} style={S.regRow}>
                    <span style={S.mono}>{r.nro_caja}</span>
                    <span style={{fontSize:11,color:t.textMuted,flex:1,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{r.defectos?.join(', ')||r.observacion_libre||'—'}</span>
                    <span style={{fontSize:11,fontWeight:600,color:r.no_conforme==='Sí'?t.danger:t.success}}>{r.no_conforme==='Sí'?'NC':'OK'}</span>
                    {(r.alertas_ap?.some(Boolean)||r.alertas_lg?.some(Boolean))&&<AlertTriangle size={12} color={t.warn}/>}
                    <span style={{fontSize:11,color:t.textDim}}>{r.hora}hs</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {modalOrden&&<ModalOrden maqId={maquinaActiva} form={formOrden} onChange={(k,v)=>setFormOrden(f=>({...f,[k]:v}))} onConfirm={confirmarOrden} onCancel={()=>setModalOrden(false)} esCambio={true} ordenAnterior={maq.producto} t={t} S={S}/>}
      </div>
    );
  }
  return null;
}
