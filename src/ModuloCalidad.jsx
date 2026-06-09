import React, { useState } from 'react';
import { ClipboardCheck, RotateCcw } from 'lucide-react';
import VistaControlCalidad from './VistaControlCalidad.jsx';
import VistaRecontrol from './VistaRecontrol.jsx';

/* Contenedor del módulo de Calidad: pestañas Control / Recontrol.
   Se monta bajo el Header global cuando el rol es 'inspector'. */
export default function ModuloCalidad({ t, currentUser }) {
  const [tab, setTab] = useState('control');

  const tabBtn = (id, label, Icon) => {
    const activo = tab === id;
    return (
      <button onClick={() => setTab(id)} style={{
        display:'inline-flex', alignItems:'center', gap:8,
        background:'transparent', border:'none', cursor:'pointer',
        padding:'12px 18px', fontSize:13, fontFamily:'Manrope',
        fontWeight: activo ? 600 : 500,
        color: activo ? t.accent : t.textMuted,
        borderBottom: `2px solid ${activo ? t.accent : 'transparent'}`,
        marginBottom:'-1px',
      }}>
        <Icon size={16} /> {label}
      </button>
    );
  };

  return (
    <div style={{ background:t.bg, color:t.text, fontFamily:"'Manrope',system-ui,sans-serif" }}>
      <div style={{ display:'flex', gap:4, padding:'0 20px', background:t.surface, borderBottom:`1px solid ${t.border}` }}>
        {tabBtn('control', 'Control de calidad', ClipboardCheck)}
        {tabBtn('recontrol', 'Recontrol de rechazos', RotateCcw)}
      </div>
      {tab === 'control'
        ? <VistaControlCalidad t={t} currentUser={currentUser} />
        : <VistaRecontrol t={t} currentUser={currentUser} />}
    </div>
  );
}
