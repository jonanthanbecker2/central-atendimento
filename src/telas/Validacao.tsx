// Segunda avaliação: validação do orçamento técnico e registro da causa confirmada (PRD 7.6).
import { useState } from 'react';
import { atualizar, mudarEstado, useBanco } from '../dados/store';
import { catalogo, falhaPorId, queixaPorId } from '../conteudo';
import { Prio, fmtData } from '../ui';
import type { Protocolo } from '../types';

function Form({ p }: { p: Protocolo }) {
  const b = useBanco();
  const u = b.usuario!;
  const [diag, setDiag] = useState('');
  const [causa, setCausa] = useState('');
  const [nova, setNova] = useState('');
  // Corte assistente × analista (RF-51)
  const critAlta = (p.falhas ?? []).some((f) => falhaPorId(f)?.criticidade === 'Alta');
  const prevista = !causa || causa === 'NOVA' ? false : (p.falhas ?? []).includes(causa);
  const podeN1 = p.nivel === 'N1' && prevista && !critAlta;
  const pode = u.perfil !== 'N1' || podeN1;

  const decidir = (decisao: 'aprovado' | 'devolvido' | 'escalado') => {
    const v = { diagnosticoPrestador: diag, causaConfirmada: causa, causaNova: causa === 'NOVA' ? nova : undefined, decisao, validadoPor: u.nome, em: new Date().toISOString() };
    atualizar(p.id, { validacoes: [...p.validacoes, v] }, { tipo: 'validacao', detalhe: `${decisao}; causa ${causa}${nova ? ` (${nova})` : ''}` });
    if (decisao === 'aprovado') mudarEstado(p.id, 'encerrado', `causa confirmada ${causa}`);
    if (decisao === 'devolvido') mudarEstado(p.id, 'aguarda_orcamento', 'orçamento devolvido ao prestador');
    if (decisao === 'escalado') atualizar(p.id, { nivel: 'N2' }, { tipo: 'escalado', detalhe: 'validação passada ao analista' });
  };

  return (
    <div className="cartao">
      <div><strong>{p.numero}</strong> · frota {p.frota} · {queixaPorId(p.queixa)?.nome} · <Prio p={p.prioridade} /> {p.nivel} · triagem: {(p.falhas ?? []).join(', ') || '—'}</div>
      {p.estado === 'aguarda_orcamento' ? (
        <button onClick={() => mudarEstado(p.id, 'em_validacao', 'orçamento técnico recebido')}>Orçamento técnico recebido</button>
      ) : (
        <>
          <label className="bloco">Diagnóstico do prestador<textarea rows={2} value={diag} onChange={(e) => setDiag(e.target.value)} /></label>
          <label className="bloco">Causa confirmada *
            <select value={causa} onChange={(e) => setCausa(e.target.value)}>
              <option value="">— escolher —</option>
              {(p.falhas ?? []).map((f) => <option key={f} value={f}>{f} {falhaPorId(f)?.sintoma} (prevista na triagem)</option>)}
              {catalogo.filter((f) => !(p.falhas ?? []).includes(f.id)).map((f) => <option key={f.id} value={f.id}>{f.id} {f.sintoma}</option>)}
              <option value="NOVA">Nova falha (não está no catálogo)</option>
            </select>
          </label>
          {causa === 'NOVA' && <label className="bloco">Descreva a nova falha<input value={nova} onChange={(e) => setNova(e.target.value)} /></label>}
          {!pode && causa && <p className="aviso">Este orçamento precisa do analista (fora das falhas previstas, criticidade alta ou triagem acima do N1).</p>}
          <div className="linha">
            <button className="primario" disabled={!causa || (causa === 'NOVA' && !nova) || !pode} onClick={() => decidir('aprovado')}>Aprovar orçamento técnico</button>
            <button disabled={!causa} onClick={() => decidir('devolvido')}>Devolver ao prestador</button>
            {u.perfil === 'N1' && <button onClick={() => decidir('escalado')}>Passar ao analista</button>}
          </div>
        </>
      )}
    </div>
  );
}

export function Validacao() {
  const b = useBanco();
  const lista = b.protocolos.filter((p) => p.estado === 'em_validacao' || p.estado === 'aguarda_orcamento');
  const encerrados = b.protocolos.filter((p) => p.estado === 'encerrado').slice(0, 10);
  return (
    <div className="fila">
      <h2>Segunda avaliação — orçamento técnico</h2>
      <p className="suave">Valores e pedido seguem pelo chatbot direto com o Suprimentos; aqui só o técnico. Nenhum protocolo encerra sem causa confirmada.</p>
      {lista.length === 0 && <p className="suave">Nada aguardando orçamento ou validação.</p>}
      {lista.map((p) => <Form key={p.id} p={p} />)}
      {encerrados.length > 0 && <>
        <h3>Encerrados recentes</h3>
        <table><thead><tr><th>Protocolo</th><th>Frota</th><th>Triagem</th><th>Causa confirmada</th><th>Acertou?</th><th>Quando</th></tr></thead>
          <tbody>{encerrados.map((p) => { const v = p.validacoes.at(-1); return (
            <tr key={p.id}><td><a href={`#/atendimento/${p.id}`}>{p.numero}</a></td><td>{p.frota}</td><td>{(p.falhas ?? []).join(', ')}</td><td>{v?.causaConfirmada}{v?.causaNova ? ` (${v.causaNova})` : ''}</td><td>{v && (p.falhas ?? []).includes(v.causaConfirmada) ? 'sim' : 'não'}</td><td>{fmtData(v?.em)}</td></tr>); })}
          </tbody></table>
      </>}
    </div>
  );
}
