import React from 'react';
import { MAQUINA_PILOTO_SPC, resumirSpcPiloto } from '../domain/spcDescriptivo.js';

// Vista de solo lectura. No modifica pruebas, NC, PLC ni HMI.
export default function PanelSpcPiloto({ t, pruebas = [] }) {
  const resumen = resumirSpcPiloto(pruebas, MAQUINA_PILOTO_SPC);
  const porcentaje = v => v === null ? 'No calculable' : (v * 100).toFixed(2) + '%';
  return (
    <section aria-label="SPC piloto en observación" style={{
      border: '1px solid ' + t.border, background: t.surface,
      borderRadius: 10, padding: 20, marginBottom: 24,
    }}>
      <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 17, fontWeight: 600, color: t.text }}>
        SPC descriptivo · {MAQUINA_PILOTO_SPC}
      </div>
      <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, marginTop: 5 }}>
        Piloto en observación · registros recuperados de los últimos 30 días.
        No representa cumplimiento de avisos HMI/PLC ni línea base estadística.
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
        gap: 12, marginTop: 16,
      }}>
        {[
          ['Registros recuperados', resumen.registrosRecuperados],
          ['Ensayos registrados', resumen.ensayosRegistrados],
          ['Muestras aptas', resumen.muestrasAptas],
          ['Sin validación de Calidad', resumen.muestrasNoValidadas],
          ['Datos incompletos / duplicados', resumen.muestrasIncompletas + resumen.muestrasDuplicadas],
        ].map(([label, value]) => (
          <div key={label} style={{ padding: 12, background: t.surfaceHi, borderRadius: 6 }}>
            <div style={{ fontFamily: 'Manrope', color: t.textMuted, fontSize: 11 }}>{label}</div>
            <div style={{ fontFamily: 'JetBrains Mono', color: t.text, fontSize: 22, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, fontFamily: 'Manrope', fontSize: 13, color: t.text }}>
        <strong>Proporción de cabezales defectuosos por producto</strong>
      </div>
      {resumen.porProducto.length === 0 ? (
        <div style={{ color: t.textMuted, fontFamily: 'Manrope', fontSize: 12, marginTop: 8 }}>
          Sin ensayos recuperados. No se infiere una tasa de defectos igual a cero.
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {resumen.porProducto.map(serie => (
            <div key={serie.producto} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              gap: 12, flexWrap: 'wrap', borderBottom: '1px solid ' + t.border,
              padding: '9px 0', fontFamily: 'Manrope', fontSize: 12, color: t.textMuted,
            }}>
              <span>{serie.producto} · {serie.muestrasAptas}/{serie.ensayosRegistrados} muestras aptas</span>
              <strong style={{ color: t.text }}>{porcentaje(serie.proporcionDefectuosa)}</strong>
            </div>
          ))}
        </div>
      )}
      <div role="note" style={{
        marginTop: 14, padding: '10px 12px', background: t.surfaceHi,
        border: '1px solid ' + t.border, borderRadius: 6,
        fontFamily: 'Manrope', fontSize: 12, color: t.textMuted,
      }}>
        Sin límites de control, DPU, alertas SPC ni decisiones automáticas de NC.
        Históricos y ensayos NO_VALIDADO no entran en las tasas.
        La cobertura de la consulta y el origen OT todavía deben verificarse.
      </div>
    </section>
  );
}
