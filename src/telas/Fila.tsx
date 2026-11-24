import { useState } from 'react';
import { atualizar, novoProtocolo, useBanco } from '../dados/store';
import { queixaPorId } from '../conteudo';
import { ESTADOS, Prio, fmtData, ir, ordemFila, retornoPendente } from '../ui';
import type { Protocolo } from '../types';

export function Fila() {
  const b = useBanco();
  const [origem, setOrigem] = useState<Protocolo['origem']>('telefone');
  const [frota, setFrota] = useState('');
  const [km, setKm] = useState('');
  const [msg, setMsg] = useState('');
  const abertos = b.protocolos.filter((p) => p.estado !== 'encerrado').sort(ordemFila);
  const retornos = b.protocolos
    .map((p) => ({ p, r: retornoPendente(p) }))
    .filter((x) => x.r)
    .sort((a, c) => a.r!.combinadoPara.localeCompare(c.r!.combinadoPara));

  const abrir = () => {
    const checklist = origem === 'checklist' ? b.checklist.filter((c) => c.frota === frota) : [];
    const p = novoProtocolo({
      origem, frota, km,
      relato: origem === 'whatsapp' ? `Mensagem do WhatsApp: ${msg}` : checklist.length ? `Checklist: ${checklist.map((c) => `${c.item} = ${c.resposta}`).join('; ')}` : '',
      operador: b.usuario?.nome ?? '',
    });
    setFrota(''); setKm(''); setMsg('');
    ir(`/atendimento/${p.id}`);
  };

  return (
    <div className="fila">
      <section className="cartao">
        <h2>Novo protocolo</h2>
        <div className="linha">
          <label>Entrada
            <select value={origem} onChange={(e) => setOrigem(e.target.value as Protocolo['origem'])}>
              <option value="telefone">Telefone (motorista ligou)</option>
              <option value="whatsapp">WhatsApp (chatbot)</option>
              <option value="checklist">Checklist com item grave</option>
            </select>
          </label>
          <label>Frota<input value={frota} onChange={(e) => setFrota(e.target.value)} placeholder="pode ficar para depois" /></label>
          <label>Km<input value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" /></label>
          {origem === 'whatsapp' && <label className="cresce">Mensagem<input value={msg} onChange={(e) => setMsg(e.target.value)} /></label>}
          <button className="primario" onClick={abrir} disabled={origem !== 'telefone' && !frota}>Abrir e atender</button>
        </div>
        <p className="suave">Telefone: abra já e ouça primeiro; frota e km podem vir depois do relato. WhatsApp e checklist: a central liga de volta para o motorista.</p>
      </section>

      {retornos.length > 0 && (
        <section className="cartao">
          <h2>Retornos combinados</h2>
          <table>
            <thead><tr><th>Hora</th><th>Protocolo</th><th>Frota</th><th>Motorista</th><th></th></tr></thead>
            <tbody>
              {retornos.map(({ p, r }) => {
                const min = (new Date(r!.combinadoPara).getTime() - Date.now()) / 60000;
                return (
                  <tr key={p.id} className={min < 0 ? 'atrasado' : min < 10 ? 'proximo' : ''}>
                    <td>{fmtData(r!.combinadoPara)} {min < 0 ? '· atrasado' : min < 10 ? '· agora' : ''}</td>
                    <td><a href={`#/atendimento/${p.id}`}>{p.numero}</a></td>
                    <td>{p.frota || '—'}</td>
                    <td>{p.motoristaNome || '—'} {p.motoristaTelefone}</td>
                    <td><button onClick={() => {
                      const res = prompt('Como foi o retorno? (resumo curto)') ?? '';
                      atualizar(p.id, { retornos: p.retornos.map((x) => (x === r ? { ...x, feitoEm: new Date().toISOString(), resultado: res } : x)) }, { tipo: 'retorno', detalhe: `Retorno feito: ${res}` });
                    }}>Feito</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="cartao">
        <h2>Fila única <span className="suave">({abertos.length} abertos)</span></h2>
        {abertos.length === 0 ? <p className="suave">Nenhum protocolo aberto.</p> : (
          <table>
            <thead><tr><th>Prioridade</th><th>Protocolo</th><th>Aberto em</th><th>Origem</th><th>Frota</th><th>Queixa</th><th>Estado</th><th>Operador</th></tr></thead>
            <tbody>
              {abertos.map((p) => (
                <tr key={p.id} className="clicavel" onClick={() => ir(`/atendimento/${p.id}`)}>
                  <td><Prio p={p.prioridade} /></td>
                  <td>{p.numero}</td>
                  <td>{fmtData(p.abertoEm)}</td>
                  <td>{p.origem}</td>
                  <td>{p.frota || '—'}</td>
                  <td>{queixaPorId(p.queixa)?.nome ?? '—'}</td>
                  <td>{ESTADOS[p.estado]}</td>
                  <td>{p.operador || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
