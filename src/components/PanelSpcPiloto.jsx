import React, { useEffect, useMemo, useState } from 'react';
import { MAQUINA_PILOTO_SPC, resumirSpcPiloto } from '../domain/spcDescriptivo.js';
import { consultarSpcPiloto, ESTADOS_CONSULTA_SPC } from '../api/spcDescriptivo.js';

// Lectura de 30 días, sólo para supervisores por el enrutamiento existente.
// La autorización real debe confirmarse en RLS, no depende de este componente.
export default function PanelSpcPiloto({ t, supabase }) {
  const [recargar, setRecargar] = useState(0);
  const [consulta, setConsulta] = useState({
    estado: 'CARGANDO', rows: [], codigo: null, recuperados: 0, totalEsperado: null,
  });
  const [fechaActualizacion, setFechaActualizacion] = useState(null);

  useEffect(() => {
    let vigente = true;
    setConsulta({ estado: 'CARGANDO', rows: [], codigo: null, recuperados: 0, totalEsperado: null });
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - 30 * 24 * 60 * 60 * 1000);
    consultarSpcPiloto(supabase, {
      maquina: MAQUINA_PILOTO_SPC, desde: desde.toISOString(), hasta: hasta.toISOString(),
    }).then(resultado => {
      if (!vigente) return;
      setConsulta(resultado);
      setFechaActualizacion(hasta.toISOString());
    }).catch(() => {
      if (vigente) setConsulta({
        estado: ESTADOS_CONSULTA_SPC.ERROR, rows: [], recuperados: 0,
        totalEsperado: null, codigo: 'EXCEPCION_DE_LECTURA',
      });
    });
    return () => { vigente = false; };
  }, [supabase, recargar]);

  const resumen = useMemo(
    () => resumirSpcPiloto(consulta.rows, MAQUINA_PILOTO_SPC),
    [consulta.rows],
  );
  const completa = consulta.estado === ESTADOS_CONSULTA_SPC.COMPLETO;
  const porcentaje = v => !completa || v === null
    ? 'No calculable' : (v * 100).toFixed(2) + '%';

  return (
    <section aria-label="SPC piloto en observación" style={{
      border: '1px solid ' + t.border, background: t.surface,
      borderRadius: 10, padding: 20, marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'Bricolage Grotesque', fontSize: 17, fontWeight: 600, color: t.text }}>
          SPC descriptivo · {MAQUINA_PILOTO_SPC}
        </div>
        <button type="button" onClick={() => setRecargar(x => x + 1)}
          style={{ background: t.surfaceHi, color: t.text, border: '1px solid ' + t.border,
            borderRadius: 6, padding: '7px 12px', cursor: 'pointer' }}>
          Actualizar datos
        </button>
      </div>
      <div style={{ fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, marginTop: 5 }}>
        Piloto en observación · registros accesibles de los últimos 30 días.
        No representa cumplimiento de avisos HMI/PLC ni línea base estadística.
      </div>
      <div role="status" aria-live="polite" style={{
        fontFamily: 'Manrope', fontSize: 12, color: t.textMuted, marginTop: 10,
      }}>
        {consulta.estado === 'CARGANDO' ? 'Consultando registros autorizados…'
          : consulta.estado === ESTADOS_CONSULTA_SPC.ERROR
            ? 'Error de lectura: no hay resultados confiables para mostrar. Verificar permisos, conectividad y esquema de staging.'
            : consulta.estado === ESTADOS_CONSULTA_SPC.PARCIAL
              ? 'Cobertura parcial o inestable. Indicadores porcentuales deshabilitados hasta completar la consulta.'
              : 'Consulta paginada completa sobre registros visibles para la sesión (no acredita cobertura industrial).'}
        {completa && fechaActualizacion ? ' · Consulta: ' + new Date(fechaActualizacion).toLocaleString('es-AR') : ''}
      </div>
      {consulta.estado !== ESTADOS_CONSULTA_SPC.ERROR && consulta.estado !== 'CARGANDO' && (
        <>
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
        </>
      )}
      <div role="note" style={{
        marginTop: 14, padding: '10px 12px', background: t.surfaceHi,
        border: '1px solid ' + t.border, borderRadius: 6,
        fontFamily: 'Manrope', fontSize: 12, color: t.textMuted,
      }}>
        Sin límites de control, DPU, alertas SPC ni decisiones automáticas de NC.
        Históricos y ensayos NO_VALIDADO no entran en las tasas.
        La lectura respeta RLS pero no verifica por sí sola el origen OT ni la representatividad de la muestra.
      </div>
    </section>
  );
}
