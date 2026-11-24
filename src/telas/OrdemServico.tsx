// Ordem de serviço para avaliação mecânica (OS), emitida ao prestador no fechamento da triagem.
// Vem preenchida com os dados da triagem; o atendente revisa os serviços a verificar, inclui novos
// e gera o arquivo (página para imprimir ou salvar em PDF) e o texto para o WhatsApp.
import { useState } from 'react';
import { atualizar, useBanco } from '../dados/store';
import { falhaPorId, itens as todosItens, queixaPorId } from '../conteudo';
import type { ResultadoTriagem } from '../motor/motor';
import { fmtData, fmtDia } from '../ui';
import { emAberto, fmtKm, kmReferencia, situacao } from '../dados/preventivas';
import type { ChecklistAberto, OrdemServico, Preventiva, Prestador, Protocolo, RascunhoOS, ServicoOS, TipoOS, Veiculo } from '../types';

// Informações da triagem que não vão ao prestador: bem-estar do motorista e passos internos da conversa.
const FORA_DA_OS = new Set(['SEG-02', 'COM-03', 'COM-04']);

/** Item do checklist em aberto transformado em serviço a verificar. */
export const servicoDoChecklist = (c: ChecklistAberto): ServicoOS => ({
  origem: 'checklist', checklist: `${c.data}|${c.item}`,
  texto: `${c.item}: verificar (${c.resposta.toLowerCase()} no checklist de ${fmtDia(c.data)})`,
});

/** Preventiva programada transformada em serviço da OS preventiva. */
export const servicoDaPreventiva = (pv: Preventiva): ServicoOS => ({
  origem: 'preventiva', preventiva: pv.id,
  texto: `${pv.tipo} (programada para ${fmtKm(pv.kmPrevisto)} km)${pv.observacao ? ` — ${pv.observacao}` : ''}`,
});

/** Serviços sugeridos pela triagem: um por falha provável, com o sistema e o que verificar. */
export function servicosDaTriagem(res: ResultadoTriagem): ServicoOS[] {
  return res.falhas.map((c) => {
    const f = falhaPorId(c);
    return { codigo: c, origem: 'triagem', texto: f ? `${f.sistema}: verificar ${f.modos.charAt(0).toLowerCase()}${f.modos.slice(1)}` : c };
  });
}

export const TIPOS_OS: { tipo: TipoOS; quando: string }[] = [
  { tipo: 'Corretiva', quando: 'Falha ou defeito: o que levou à parada' },
  { tipo: 'Preventiva', quando: 'Revisão ou troca programada (plano do fabricante)' },
  { tipo: 'Preditiva', quando: 'Inspeção por condição: análise de óleo, medições, desgaste' },
  { tipo: 'Reforma', quando: 'Recuperação maior: cabine, chassi, tanque, implemento' },
  { tipo: 'Sinistro', quando: 'Dano por acidente, colisão, avaria ou roubo' },
];

/** A primeira OS da parada é corretiva e já vem com as falhas prováveis da triagem; as demais começam vazias. */
export function rascunhoPadrao(res: ResultadoTriagem, seq = 1, tipo: TipoOS = 'Corretiva'): RascunhoOS {
  return { seq, tipo, servicos: seq === 1 && tipo === 'Corretiva' ? servicosDaTriagem(res) : [], observacoes: '', incluirContato: !!res.local };
}

/** OS em edição do protocolo (converte o formato antigo, de uma OS só). */
export function rascunhosDe(p: Protocolo, res: ResultadoTriagem): RascunhoOS[] {
  if (p.osRascunhos?.length) return p.osRascunhos;
  if (p.osRascunho) return [{ seq: 1, tipo: 'Corretiva', ...p.osRascunho }];
  return [rascunhoPadrao(res)];
}

/** Versões emitidas de uma OS (as antigas, sem número de sequência, contam como a OS 1). */
const versoesDe = (p: Protocolo, seq: number) => (p.ordens ?? []).filter((o) => (o.seq ?? 1) === seq);
const conteudo = (r: RascunhoOS) => JSON.stringify([r.tipo, r.servicos, r.observacoes, r.incluirContato, r.prestadorSpot ?? '']);

/** Informações da triagem que interessam ao mecânico, com o nome da informação e a resposta. */
function informacoesDaTriagem(p: Protocolo): { info: string; valor: string }[] {
  // na ordem da árvore (segurança primeiro, depois a queixa)
  return todosItens
    .filter((i) => p.respostas[i.id] && !FORA_DA_OS.has(i.id) && i.naConversa !== false)
    .sort((a, b) => a.momento - b.momento)
    .map((i) => ({ info: i.info, valor: p.respostas[i.id] }));
}

const PRAZO: Record<string, string> = { P0: 'Urgente', P1: 'Alta', P2: 'Programável' };

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Dados { os: OrdemServico; p: Protocolo; res: ResultadoTriagem; veiculo?: Veiculo; prestador?: Prestador; outras?: OrdemServico[] }

/** Documento da OS em HTML, pronto para imprimir ou salvar em PDF (A4). */
export function htmlDaOS({ os, p, res, veiculo, prestador, outras = [] }: Dados): string {
  const linha = (r: string, v?: string) => (v ? `<tr><th>${esc(r)}</th><td>${esc(v)}</td></tr>` : '');
  const infos = informacoesDaTriagem(p);
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(os.numero)}</title>
<style>
@page { size: A4; margin: 14mm; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11.5pt; color: #1d2733; margin: 0; }
.pagina { max-width: 182mm; margin: 0 auto; padding: 8mm 0; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d2733; padding-bottom: 6px; }
h1 { font-size: 16pt; margin: 0; } .sub { color: #555; font-size: 10pt; }
.num { text-align: right; font-size: 10pt; white-space: nowrap; padding-left: 12px; } .num b { font-size: 13pt; display: block; }
h2 { font-size: 11.5pt; text-transform: uppercase; letter-spacing: .4px; margin: 14px 0 4px; border-bottom: 1px solid #c9d0d8; padding-bottom: 2px; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 2px 6px 2px 0; font-size: 11pt; }
th { width: 38%; font-weight: 600; color: #444; }
.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
.prio { display: inline-block; font-weight: 700; padding: 1px 8px; border-radius: 4px; border: 1px solid #1d2733; }
.prio.P0 { background: #f3d6d2; } .prio.P1 { background: #f8e6c8; } .prio.P2 { background: #e2efe0; }
blockquote { margin: 4px 0; padding: 6px 10px; background: #f3f5f7; border-left: 3px solid #8a96a3; font-style: italic; }
ol.servicos { margin: 4px 0; padding-left: 22px; } ol.servicos li { margin: 4px 0; }
.caixa { display: inline-block; width: 11px; height: 11px; border: 1px solid #1d2733; margin-right: 6px; vertical-align: -1px; }
.nota { font-size: 9.5pt; color: #555; }
.instrucoes { border: 1.5px solid #1d2733; border-radius: 6px; padding: 6px 10px; margin-top: 12px; }
.instrucoes p { margin: 3px 0; }
.preencher { border-bottom: 1px solid #8a96a3; height: 22px; }
.assin { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 26px; text-align: center; font-size: 10pt; }
.assin div { border-top: 1px solid #1d2733; padding-top: 3px; }
@media print { .naoimprime { display: none; } }
.naoimprime { text-align: right; margin-bottom: 6px; } .naoimprime button { font-size: 13px; padding: 6px 12px; cursor: pointer; }
</style></head><body><div class="pagina">
<div class="naoimprime"><button onclick="window.print()">Imprimir / salvar em PDF</button></div>
<header>
  <div><h1>Ordem de Serviço — ${esc(os.tipo ?? 'Corretiva')}</h1><div class="sub">Avaliação mecânica · Central de Atendimento da Automotiva · protocolo ${esc(p.numero)}</div></div>
  <div class="num"><b>${esc(os.numero)}</b>Emitida em ${esc(fmtData(os.geradaEm))}<br>por ${esc(os.geradaPor)}${os.versao > 1 ? `<br>Versão ${os.versao} (substitui as anteriores)` : ''}</div>
</header>

<div class="duas">
<section><h2>Prestador</h2><table>
${linha('Nome', os.prestadorNome)}
${linha('Cidade', prestador ? `${prestador.cidade}${prestador.uf ? '-' + prestador.uf : ''}` : undefined)}
${linha('Telefone', prestador?.telefone)}
${linha('Atendimento', res.local ? 'No local onde o veículo está' : 'Na oficina do prestador')}
${linha('Especialidade', res.especialidade)}
</table></section>
<section><h2>Veículo</h2><table>
${linha('Frota', p.frota)}
${linha('Placa', veiculo?.placa)}
${linha('Marca e modelo', veiculo ? `${veiculo.marca ?? ''} ${veiculo.modelo ?? ''}`.trim() : undefined)}
${linha('Tipo', veiculo?.classe)}
${linha('Centro de coleta', veiculo?.centro)}
${linha('Km informado', p.km)}
</table></section>
</div>

<h2>Atendimento</h2><table>
<tr><th>${(os.tipo ?? 'Corretiva') === 'Corretiva' ? 'Prioridade' : 'Prioridade da parada (corretiva)'}</th><td><span class="prio ${esc(res.prioridade ?? '')}">${esc(res.prioridade ?? '—')}${res.prioridade ? ' · ' + PRAZO[res.prioridade] : ''}</span></td></tr>
<tr><th>Tipo de serviço</th><td><b>${esc(os.tipo ?? 'Corretiva')}</b></td></tr>
${linha('Queixa', queixaPorId(p.queixa)?.nome)}
${outras.length ? linha('Outras OS desta parada', outras.map((o) => `${o.numero} (${o.tipo ?? 'Corretiva'})`).join('; ')) : ''}
${linha('Onde o veículo está', p.localInformado || undefined)}
${os.incluirContato ? linha('Motorista', [p.motoristaNome, p.motoristaTelefone].filter(Boolean).join(' · ') || undefined) : ''}
${linha('Previsão de liberação', p.previsaoLiberacao ? fmtData(p.previsaoLiberacao) : undefined)}
${linha('Orientação dada ao motorista', res.orientacao)}
</table>

<h2>${(os.tipo ?? 'Corretiva') === 'Corretiva' ? 'Relato do motorista' : 'Relato do motorista (contexto da parada)'}</h2>
<blockquote>${esc(p.relato || '—')}</blockquote>

${infos.length ? `<h2>Informações da triagem</h2><table>${infos.map((x) => linha(x.info, x.valor)).join('')}</table>` : ''}

<h2>Serviços a verificar</h2>
<ol class="servicos">${os.servicos.map((s) => `<li><span class="caixa"></span>${esc(s.texto)}${s.codigo ? ` <span class="nota">(${esc(s.codigo)})</span>` : s.origem === 'checklist' ? ' <span class="nota">(checklist em aberto)</span>' : s.origem === 'preventiva' ? ' <span class="nota">(preventiva programada)</span>' : ''}</li>`).join('')}</ol>
${os.servicos.some((x) => x.codigo) ? '<p class="nota">Os itens indicados pela triagem são hipóteses a partir do relato do motorista, não diagnóstico. O diagnóstico é do prestador.</p>' : ''}

${os.observacoes ? `<h2>Observações da central</h2><p>${esc(os.observacoes).replace(/\n/g, '<br>')}</p>` : ''}

<div class="instrucoes">
<p><b>Esta OS autoriza somente a avaliação mecânica.</b></p>
<p>Envie à central o diagnóstico e o orçamento técnico antes de executar qualquer serviço. A execução só acontece depois da validação da central.</p>
<p>Encontrou risco à segurança (freio, fogo, vazamento do tanque)? Avise a central na hora.</p>
<p>Informe o número desta OS em todo contato.</p>
</div>

<h2>Diagnóstico do prestador</h2>
<p class="nota">Causa encontrada, peças e serviços necessários.</p>
<div class="preencher"></div><div class="preencher"></div><div class="preencher"></div><div class="preencher"></div>

<div class="assin"><div>Prestador (nome e assinatura)</div><div>Data e hora da avaliação</div></div>
</div></body></html>`;
}

/** Texto curto da OS para colar no WhatsApp do prestador. */
export function textoDaOS({ os, p, res, veiculo }: Dados): string {
  const v = veiculo ? `${veiculo.marca ?? ''} ${veiculo.modelo ?? ''}`.trim() : '';
  return [
    `*${os.numero}* — Ordem de Serviço ${os.tipo ?? 'Corretiva'} (avaliação mecânica)`,
    `Protocolo ${p.numero} · Prioridade ${res.prioridade ?? '—'}${res.prioridade ? ` (${PRAZO[res.prioridade]})` : ''}`,
    `Veículo: frota ${p.frota}${veiculo?.placa ? ` · placa ${veiculo.placa}` : ''}${v ? ` · ${v}` : ''} · ${p.km} km`,
    `Atendimento: ${res.local ? 'no local' : 'na oficina'}${p.localInformado ? ` · ${p.localInformado}` : ''}`,
    os.incluirContato && (p.motoristaNome || p.motoristaTelefone) ? `Motorista: ${[p.motoristaNome, p.motoristaTelefone].filter(Boolean).join(' · ')}` : '',
    `Relato: "${p.relato}"`,
    'Verificar:',
    ...os.servicos.map((s, i) => `${i + 1}. ${s.texto}`),
    os.observacoes ? `Obs.: ${os.observacoes}` : '',
    'Esta OS autoriza só a avaliação. Envie diagnóstico e orçamento técnico à central antes de executar.',
  ].filter(Boolean).join('\n');
}

function abrirDocumento(html: string, nomeArquivo: string, baixar: boolean) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  if (baixar) {
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo; a.click();
  } else window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Todas as OS da parada: uma por tipo de serviço (ex.: corretiva + preventiva). */
export function EditorOS({ p, res, veiculo, prestador, autor }: { p: Protocolo; res: ResultadoTriagem; veiculo?: Veiculo; prestador?: Prestador; autor: string }) {
  const rascunhos = rascunhosDe(p, res);
  const salvarTodas = (lista: RascunhoOS[], evento?: string) =>
    atualizar(p.id, { osRascunhos: lista, osRascunho: undefined }, evento ? { tipo: 'os', detalhe: evento } : undefined);
  const salvar = (seq: number, mud: Partial<RascunhoOS>) => salvarTodas(rascunhos.map((r) => (r.seq === seq ? { ...r, ...mud } : r)));
  const proximoSeq = Math.max(0, ...rascunhos.map((r) => r.seq), ...(p.ordens ?? []).map((o) => o.seq ?? 1)) + 1;
  const abrirNova = (tipo: TipoOS) => { salvarTodas([...rascunhos, rascunhoPadrao(res, proximoSeq, tipo)], `nova OS ${proximoSeq} (${tipo}) em edição`); };

  return (
    <div className="ordens-os">
      <h4>Ordens de serviço desta parada ({rascunhos.length})</h4>
      <div className="nova-os">
        <span>Abrir nova OS:</span>
        {TIPOS_OS.map((t) => <button key={t.tipo} title={t.quando} onClick={() => abrirNova(t.tipo)}>+ {t.tipo}</button>)}
      </div>
      <p className="suave pequeno">Uma OS por tipo de serviço. Ex.: a corretiva do defeito e, na mesma parada, a preventiva da revisão. Cada botão acima cria uma OS nova.</p>
      <PreventivasDaParada p={p} rascunhos={rascunhos} incluir={(pv) => {
        const alvo = rascunhos.find((r) => r.tipo === 'Preventiva');
        if (alvo) salvarTodas(rascunhos.map((r) => (r.seq === alvo.seq ? { ...r, servicos: [...r.servicos, servicoDaPreventiva(pv)] } : r)), `preventiva "${pv.tipo}" incluída na OS ${alvo.seq}`);
        else salvarTodas([...rascunhos, { ...rascunhoPadrao(res, proximoSeq, 'Preventiva'), servicos: [servicoDaPreventiva(pv)] }], `OS ${proximoSeq} (Preventiva) aberta com "${pv.tipo}"`);
      }} />
      {rascunhos.map((r) => (
        <CartaoOS key={r.seq} p={p} res={res} veiculo={veiculo} prestador={prestador} autor={autor} r={r} todas={rascunhos}
          salvar={(m) => salvar(r.seq, m)}
          remover={() => salvarTodas(rascunhos.filter((x) => x.seq !== r.seq), `OS ${r.seq} (${r.tipo}) ${versoesDe(p, r.seq).length ? 'cancelada' : 'descartada'}`)} />
      ))}
    </div>
  );
}

/** Preventivas em aberto da frota, para programar junto com esta parada. */
function PreventivasDaParada({ p, rascunhos, incluir }: { p: Protocolo; rascunhos: RascunhoOS[]; incluir: (pv: Preventiva) => void }) {
  const b = useBanco();
  const lista = emAberto(b.preventivas, p.frota);
  if (!lista.length) return null;
  const kmAtual = kmReferencia(p.km, b.historico, p.frota);
  const onde = (pv: Preventiva) => rascunhos.find((r) => r.servicos.some((s) => s.preventiva === pv.id));
  return (
    <div className="prev-os">
      <span className="rotulo">Preventivas em aberto da frota {p.frota} · aproveite a parada</span>
      {lista.map((pv) => {
        const st = situacao(pv, kmAtual); const em = onde(pv);
        return (
          <div key={pv.id} className="linha">
            <span className="cresce">{pv.tipo} · {fmtKm(pv.kmPrevisto)} km · <span className={st.classe}>{st.rotulo}</span></span>
            {em ? <span className="ok pequeno">na OS {em.seq} ({em.tipo}) ✓</span> : <button className="pequeno" onClick={() => incluir(pv)}>Incluir na OS preventiva</button>}
          </div>
        );
      })}
    </div>
  );
}

function CartaoOS({ p, res, veiculo, prestador, autor, r, todas, salvar, remover }: {
  p: Protocolo; res: ResultadoTriagem; veiculo?: Veiculo; prestador?: Prestador; autor: string;
  r: RascunhoOS; todas: RascunhoOS[]; salvar: (m: Partial<RascunhoOS>) => void; remover: () => void;
}) {
  const checklist = useBanco().checklist.filter((c) => c.frota === p.frota);
  // Em qual OS da parada o item do checklist já está
  const ondeEsta = (c: ChecklistAberto) => todas.find((x) => x.servicos.some((s) => s.checklist === `${c.data}|${c.item}`));
  const [novo, setNovo] = useState('');
  const [copiado, setCopiado] = useState(false);
  const versoes = versoesDe(p, r.seq);
  const ultima = versoes.at(-1);
  const spot = p.prestadorId === 'spot';
  const nomePrestador = spot ? (r.prestadorSpot?.trim() || '') : prestador?.nome ?? '';

  const incluir = () => {
    if (!novo.trim()) return;
    salvar({ servicos: [...r.servicos, { texto: novo.trim(), origem: 'atendente' }] });
    setNovo('');
  };
  const retiradas = r.tipo === 'Corretiva' ? servicosDaTriagem(res).filter((s) => !todas.some((x) => x.servicos.some((y) => y.codigo === s.codigo))) : [];

  // As outras OS da parada já emitidas (para o prestador saber que há mais de uma)
  const outrasEmitidas = (): OrdemServico[] => todas.filter((x) => x.seq !== r.seq).map((x) => versoesDe(p, x.seq).at(-1)).filter((x): x is OrdemServico => !!x);
  const dados = (os: OrdemServico): Dados => ({ os, p, res, veiculo, prestador, outras: outrasEmitidas() });

  const gerar = () => {
    const versao = versoes.length + 1;
    const os: OrdemServico = {
      ...r, numero: `OS-${p.numero}-${r.seq}${versao > 1 ? `-v${versao}` : ''}`, versao, geradaEm: new Date().toISOString(), geradaPor: autor,
      prestadorId: p.prestadorId!, prestadorNome: nomePrestador,
    };
    atualizar(p.id, { ordens: [...(p.ordens ?? []), os], osRascunhos: todas, osRascunho: undefined }, { tipo: 'os', detalhe: `${os.numero} (${os.tipo}) para ${os.prestadorNome}: ${os.servicos.length} serviço(s)` });
    abrirDocumento(htmlDaOS(dados(os)), `${os.numero}.html`, false);
  };
  const desatualizada = ultima && (ultima.prestadorId !== p.prestadorId || conteudo({ ...ultima, tipo: ultima.tipo ?? 'Corretiva' }) !== conteudo(r));

  return (
    <div className="editor-os">
      <div className="linha topo-os">
        <h4 className="cresce">OS {r.seq} · <span className={`tipo-os ${r.tipo.toLowerCase()}`}>{r.tipo}</span> {ultima && <span className="suave pequeno">· {ultima.numero}</span>}</h4>
        <label className="trocar-tipo">trocar o tipo desta OS
          <select value={r.tipo} onChange={(e) => salvar({ tipo: e.target.value as TipoOS })}>
            {TIPOS_OS.map((t) => <option key={t.tipo} value={t.tipo}>{t.tipo}</option>)}
          </select>
        </label>
        <button className="link pequeno" onClick={() => { if (!versoes.length || window.confirm(`Cancelar a OS ${r.seq} (${r.tipo})? Avise o prestador.`)) remover(); }}>{versoes.length ? 'cancelar esta OS' : 'descartar'}</button>
      </div>
      <p className="suave pequeno">{TIPOS_OS.find((t) => t.tipo === r.tipo)?.quando}</p>
      {spot && <label className="cresce">Prestador spot (nome e telefone)<input value={r.prestadorSpot ?? ''} onChange={(e) => salvar({ prestadorSpot: e.target.value })} /></label>}

      <div className="rotulo">Serviços a verificar</div>
      <ol className="servicos-os">
        {r.servicos.map((s, i) => (
          <li key={i}>
            <span>{s.texto} <span className="suave">({s.codigo ? `${s.codigo}, da triagem` : s.origem === 'checklist' ? 'do checklist' : s.origem === 'preventiva' ? 'preventiva programada' : 'incluído'})</span></span>
            <button className="link pequeno" onClick={() => salvar({ servicos: r.servicos.filter((_, k) => k !== i) })}>retirar</button>
          </li>
        ))}
        {r.servicos.length === 0 && <li className="suave">Nenhum serviço na lista. Inclua abaixo{checklist.length ? ' ou traga do checklist' : ''}.</li>}
      </ol>
      {checklist.length > 0 && (
        <div className="checklist-os">
          <span className="rotulo">Checklist em aberto da frota {p.frota}</span>
          {checklist.map((c) => {
            const em = ondeEsta(c);
            return (
              <div key={c.data + c.item} className="linha">
                <span className="cresce">{fmtDia(c.data)} · {c.item}: <b>{c.resposta}</b></span>
                {em
                  ? <span className="ok pequeno">na OS {em.seq} ({em.tipo}) ✓</span>
                  : <button className="pequeno" onClick={() => salvar({ servicos: [...r.servicos, servicoDoChecklist(c)] })}>Incluir nesta OS</button>}
              </div>
            );
          })}
        </div>
      )}
      <div className="linha">
        <input className="cresce" value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && incluir()} placeholder={r.tipo === 'Preventiva' ? 'Ex.: revisão de 20.000 km conforme plano do fabricante' : 'Incluir serviço a verificar (ex.: verificar regulagem do freio traseiro)'} />
        <button disabled={!novo.trim()} onClick={incluir}>Incluir ↵</button>
      </div>
      {retiradas.length > 0 && <p className="suave pequeno">Retirados da triagem: {retiradas.map((s) => <button key={s.codigo} className="link pequeno" onClick={() => salvar({ servicos: [...r.servicos, s] })}>{s.codigo} (trazer de volta)</button>)}</p>}

      <label className="cresce">Observações ao prestador<textarea rows={2} value={r.observacoes} onChange={(e) => salvar({ observacoes: e.target.value })} placeholder="Ex.: veículo carregado; motorista aguarda no posto; ligar antes de ir" /></label>
      <label className="check"><input type="checkbox" checked={r.incluirContato} onChange={(e) => salvar({ incluirContato: e.target.checked })} /> Incluir nome e telefone do motorista <span className="suave">(só quando o prestador precisa falar com ele)</span></label>

      <div className="linha">
        <button className="primario" disabled={!p.prestadorId || !nomePrestador || r.servicos.length === 0} onClick={gerar}>{ultima ? `Gerar nova versão da OS ${r.seq}` : `Gerar OS ${r.seq} (${r.tipo})`}</button>
        {ultima && <>
          <button onClick={() => abrirDocumento(htmlDaOS(dados(ultima)), `${ultima.numero}.html`, false)}>Abrir</button>
          <button onClick={() => abrirDocumento(htmlDaOS(dados(ultima)), `${ultima.numero}.html`, true)}>Baixar arquivo</button>
          <button onClick={async () => { await navigator.clipboard.writeText(textoDaOS(dados(ultima))); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>{copiado ? 'Copiado ✓' : 'Copiar texto para WhatsApp'}</button>
        </>}
      </div>
      {desatualizada && <p className="aviso pequeno">A {ultima.numero} não tem as últimas mudanças. Gere uma nova versão antes de enviar.</p>}
    </div>
  );
}

/** Todas as OS da parada (com serviço) estão emitidas para o prestador escolhido e com as últimas mudanças? */
export function osEmDia(p: Protocolo): boolean {
  const lista = p.osRascunhos?.length ? p.osRascunhos : p.osRascunho ? [{ seq: 1, tipo: 'Corretiva' as TipoOS, ...p.osRascunho }] : [];
  const comServico = lista.filter((r) => r.servicos.length > 0);
  if (!comServico.length) return false;
  return comServico.every((r) => {
    const u = versoesDe(p, r.seq).at(-1);
    return !!u && u.prestadorId === p.prestadorId && conteudo({ ...u, tipo: u.tipo ?? 'Corretiva' }) === conteudo(r);
  });
}

/** Resumo das OS emitidas, para o histórico e a passagem. */
export function resumoOrdens(p: Protocolo): string {
  const seqs = [...new Set((p.ordens ?? []).map((o) => o.seq ?? 1))];
  const vivas = new Set((p.osRascunhos ?? []).map((r) => r.seq));
  return seqs.filter((s) => !p.osRascunhos || vivas.has(s)).map((s) => { const u = versoesDe(p, s).at(-1)!; return `${u.numero} (${u.tipo ?? 'Corretiva'})`; }).join(', ');
}
