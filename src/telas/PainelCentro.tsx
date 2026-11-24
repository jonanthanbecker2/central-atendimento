// Painel do centro de coleta (RF-90 a RF-93): só leitura, sem relato, motorista ou orçamento.
import { useState } from 'react';
import { useBanco } from '../dados/store';
import { queixaPorId } from '../conteudo';
import { FASE_CENTRO, fmtData } from '../ui';

export function PainelCentro() {
  const b = useBanco();
  const fixo = b.usuario?.perfil === 'centro' ? b.usuario.centro : undefined;
  const centros = [...new Set(b.veiculos.map((v) => v.centro).filter(Boolean))] as string[];
  const [centro, setCentro] = useState(fixo ?? '');
  const c = fixo ?? centro;
  const centroDe = (frota: string) => b.veiculos.find((v) => v.frota === frota)?.centro;
  const parados = b.protocolos
    .filter((p) => !p.liberadoEm && p.frota && (!c || centroDe(p.frota) === c))
    .sort((a, x) => (a.previsaoLiberacao ?? 'z').localeCompare(x.previsaoLiberacao ?? 'z'));
  const prest = (id?: string) => (id === 'spot' ? 'Spot' : b.prestadores.find((x) => x.id === id)?.nome ?? '—');

  return (
    <div className="fila">
      <h2>Caminhões parados {c && `— ${c}`}</h2>
      {!fixo && (
        <label>Centro de coleta
          <select value={centro} onChange={(e) => setCentro(e.target.value)}>
            <option value="">Todos</option>
            {centros.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
      )}
      <p className="suave">Atualiza sozinho. Quem avisa o centro sobre a parada é o próprio coletor; aqui o centro acompanha a fase e a previsão.</p>
      {parados.length === 0 ? <p className="suave">Nenhum caminhão parado.</p> : (
        <table>
          <thead><tr><th>Frota</th><th>Queixa</th><th>Fase do atendimento</th><th>Prestador</th><th>Previsão de liberação</th><th>Aberto em</th></tr></thead>
          <tbody>
            {parados.map((p) => {
              const venc = p.previsaoLiberacao && new Date(p.previsaoLiberacao).getTime() < Date.now();
              return (
                <tr key={p.id} className={venc ? 'atrasado' : ''}>
                  <td><b>{p.frota}</b></td>
                  <td>{queixaPorId(p.queixa)?.nome ?? '—'}</td>
                  <td>{FASE_CENTRO[p.estado]}</td>
                  <td>{prest(p.prestadorId)}</td>
                  <td>{p.previsaoLiberacao ? fmtData(p.previsaoLiberacao) : 'a definir'}{venc ? ' · vencida' : ''}</td>
                  <td>{fmtData(p.abertoEm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
