// Tela de atendimento em três áreas (PRD 7.2):
// A. Conversa guiada (esquerda, em cima): o roteiro do treinamento corre como um diálogo.
//    Cada fala sugerida aparece como mensagem; a resposta do motorista vira um balão e abre a próxima.
// B. Histórico do veículo (esquerda, embaixo) · C. Orientação da IA + resultado das regras (lateral)
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { atualizar, lerBanco, mudarEstado, registrarFotoVeiculo, useBanco } from '../dados/store';
import { falhaPorId, itens as todosItens, itensDaQueixa, queixaPorId, queixas, roteiro, saidasDaQueixa, temArvore } from '../conteudo';
import { triar, type ResultadoTriagem } from '../motor/motor';
import { EditorOS, osEmDia, resumoOrdens } from './OrdemServico';
import { emAberto, fmtKm, kmReferencia, situacao } from '../dados/preventivas';
import { pendentes } from '../motor/roteiro';
import { avisoIADesligada, orientacaoPorRegras, pedirIA, statusIA, type RespostaIA } from '../ia/cliente';
import { ESTADOS, Prio, fmtData, fmtDia, ir, retornoPendente } from '../ui';
import type { ItemArvore, Nivel, OrientacaoMostrada, Prestador, Protocolo, Veiculo } from '../types';

const paraInput = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const deInput = (v: string) => (v ? new Date(v).toISOString() : undefined);
const marcarPasso = (p: Protocolo, k: string, v = true, detalhe?: string) =>
  atualizar(p.id, { passos: { ...(p.passos ?? {}), [k]: v } }, detalhe ? { tipo: 'roteiro', detalhe } : undefined);
const responder = (p: Protocolo, id: string, v: string, origem = '') =>
  atualizar(p.id, { respostas: { ...p.respostas, [id]: v } }, { tipo: 'marcacao', detalhe: `${id} = ${v}${origem}` });
const reabrir = (p: Protocolo, id: string) => {
  const r = { ...p.respostas }; delete r[id];
  atualizar(p.id, { respostas: r, passos: { ...(p.passos ?? {}), [`pulou:${id}`]: false, [`relato:${id}`]: false } }, { tipo: 'marcacao', detalhe: `${id} reaberto` });
};


// ---------------- Nível de complexidade ----------------
const ORDEM_NIVEL: Record<Nivel, number> = { N1: 1, N2: 2, N3: 3 };
/** O mínimo que as regras indicam. O atendente pode subir, nunca baixar. */
export const nivelMinimo = (res: ResultadoTriagem): Nivel => res.nivel ?? (res.paraAnalista ? 'N2' : 'N1');
const NIVEIS: { n: Nivel; nome: string; quando: string }[] = [
  { n: 'N1', nome: 'Assistente resolve', quando: 'Sintoma claro, as regras chegaram a uma saída e o prestador da rede resolve. Você conduz até o fim.' },
  { n: 'N2', nome: 'Analista', quando: 'Mais de um sintoma, problema repetido, “não sei” em informação importante, divergência com o motorista ou caso que pede olhar técnico.' },
  { n: 'N3', nome: 'Consultor técnico', quando: 'Fora das árvores, falha que volta mesmo após reparo, risco técnico alto (tanque, bomba, estrutura) ou decisão de engenharia.' },
];

type Passo = 'acolher' | 'ouvir' | 'item' | 'queixa' | 'frota' | 'nivel' | 'fechar';
interface Ponto { momento: number; passo: Passo; item?: ItemArvore }

/** Em que ponto da conversa estamos: o primeiro passo ainda sem resposta. A conversa e o painel da IA leem daqui. */
function pontoDaConversa(p: Protocolo, itens: ItemArvore[], res: ResultadoTriagem): Ponto {
  const ps = p.passos ?? {};
  // Ordem da ligação: acolher → segurança e bem-estar (local seguro, como ele está) → relato → entender…
  if (!ps.acolher) return { momento: 1, passo: 'acolher' };
  const p3 = pendentes(p, itens, 3);
  if (p3.length) return { momento: 3, passo: 'item', item: p3[0] };
  if (!ps.ouvir || !p.relato.trim()) return { momento: 2, passo: 'ouvir' };
  if (!p.queixa) return { momento: 4, passo: 'queixa' };
  if (!p.frota || !p.km) return { momento: 4, passo: 'frota' };
  const p4 = pendentes(p, itens, 4);
  const obrig4 = p4.some((i) => i.obrigatoria !== 'nao');
  if (p4.length && (obrig4 || !(res.saida || res.paraAnalista || ps.entender))) return { momento: 4, passo: 'item', item: p4[0] };
  const p5 = pendentes(p, itens, 5);
  if (p5.length) return { momento: 5, passo: 'item', item: p5[0] };
  if (!p.nivelOperador) return { momento: 5, passo: 'nivel' };
  return { momento: 6, passo: 'fechar' };
}

/** "Evite: a; b." sem pontuação dobrada (ex.: "frota?." vira "frota?"). */
function textoEvite(lista: string[]) {
  const t = lista.map((x) => x.trim().replace(/\.$/, '')).join('; ');
  return `Evite: ${t}${/[?!]$/.test(t) ? '' : '.'}`;
}

/** Troca os marcadores das falas do treinamento pelos dados do atendimento. */
function substituir(t: string, p: Protocolo, res: ResultadoTriagem, operador: string) {
  const nome = p.motoristaNome.trim().split(' ')[0];
  return t
    .replaceAll('[nome]', nome || 'motorista')
    .replaceAll('[operador]', operador.split(' ')[0])
    .replaceAll('[resumo com as palavras dele]', p.relato.split(/[.!?\n]/)[0].trim().toLowerCase() || '…')
    .replaceAll('[plano]', (res.orientacao ?? 'o que combinarmos').replace(/\.$/, '').toLowerCase())
    .replaceAll('[hora]', '[hora do retorno]');
}

/** O que o painel mostra para o passo aberto na conversa (mesma fonte da conversa). */
function guiaDoPasso(pt: Ponto, p: Protocolo, res: ResultadoTriagem, operador: string): { titulo: string; fala?: string; atencao: string; dica: string } {
  const m = roteiro[pt.momento - 1];
  const sub = (t: string) => substituir(t, p, res, operador);
  const evite = textoEvite([m.evite[0]]);
  switch (pt.passo) {
    case 'acolher': return { titulo: 'Acolher', fala: sub(m.falas[0]), atencao: evite, dica: m.intencao };
    case 'ouvir': return { titulo: 'Ouvir o relato', fala: sub(m.falas[0]), atencao: 'Quando ele parar: “Mais alguma coisa que você notou?”', dica: m.intencao };
    case 'queixa': return { titulo: 'Entender · escolher a queixa', atencao: 'Não precisa perguntar: escolha pelo que ele contou.', dica: 'Se nenhuma das cinco servir, use “outra…”: o caso segue para o analista.' };
    case 'frota': return { titulo: 'Entender · frota e km', fala: sub(m.falas[0]), atencao: evite, dica: m.intencao };
    case 'nivel': return { titulo: 'Classificar a complexidade', atencao: `As regras indicam ${nivelMinimo(res)}. Você pode subir o nível, não baixar.`, dica: 'Subiu o nível? Escreva o motivo: ele vai para o analista.' };
    case 'fechar': return { titulo: 'Fechar', fala: sub(m.falas[0]), atencao: evite, dica: m.intencao };
    default: {
      const i = pt.item!;
      return { titulo: `${m.nome} · ${i.info}`, fala: sub(i.perguntas[0] ?? i.info), atencao: i.cuidado || evite, dica: m.intencao };
    }
  }
}

export function Atendimento({ id }: { id: string }) {
  const b = useBanco();
  const p = b.protocolos.find((x) => x.id === id);
  const [histAberto, setHistAberto] = useState(false);
  const usuario = b.usuario!;

  useEffect(() => {
    if (p?.estado === 'na_fila') {
      atualizar(p.id, { operador: usuario.nome });
      mudarEstado(p.id, 'em_triagem', `assumido por ${usuario.nome}`);
    }
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const veiculo = p ? b.veiculos.find((v) => v.frota === p.frota) : undefined;
  const itens = p?.queixa ? itensDaQueixa(p.queixa) : todosItens.filter((i) => i.queixa === '*');
  const res = triar(itens, saidasDaQueixa(p?.queixa || '*'), p?.respostas ?? {});
  const ponto: Ponto = p ? pontoDaConversa(p, itens, res) : { momento: 1, passo: 'acolher' };
  const guia = p ? guiaDoPasso(ponto, p, res, usuario.nome) : { titulo: '', atencao: '', dica: '' };
  const orient = useOrientacao(p, itens, res, ponto, guia, veiculo);

  if (!p) return <p>Protocolo não encontrado. <a href="#/fila">Voltar à fila</a></p>;

  return (
    <div className="atendimento">
      <Cabecalho p={p} />
      <div className="areaA">
        <Conversa p={p} itens={itens} res={res} veiculo={veiculo} prestadores={b.prestadores} operador={usuario.nome} orient={orient} />
      </div>
      <div className={`areaB ${histAberto ? 'aberta' : ''}`}>
        <button className="link pequeno alterna" onClick={() => setHistAberto(!histAberto)}>{histAberto ? 'diminuir' : 'ver mais'}</button>
        <HistoricoVeiculo frota={p.frota} km={p.km} veiculo={veiculo} />
      </div>
      <aside className="areaC"><Orientacoes p={p} itens={itens} res={res} ponto={ponto} guia={guia} orient={orient} /></aside>
    </div>
  );
}

// ---------------- Conversa guiada ----------------
type Orient = ReturnType<typeof useOrientacao>;

/** Mensagem do guia (o roteiro falando com o operador). */
function Guia({ intro, fala, outras, cuidado, extra }: { intro?: string; fala?: string; outras?: string[]; cuidado?: string; extra?: ReactNode }) {
  return (
    <div className="msg guia">
      {intro && <p className="intro">{intro}</p>}
      {fala && <p className="diga">“{fala}”</p>}
      {outras && outras.length > 0 && <p className="ou">ou: {outras.map((o) => `“${o}”`).join(' · ')}</p>}
      {cuidado && <p className="cuid">{cuidado}</p>}
      {extra}
    </div>
  );
}

/** Balão da resposta do motorista (ou do registro do operador). Clique para corrigir. */
function Resposta({ quem, children, onEditar }: { quem: string; children: ReactNode; onEditar?: () => void }) {
  return (
    <div className="msg resp" onClick={onEditar} title={onEditar ? 'clique para corrigir' : undefined}>
      <span className="quem">{quem}</span>
      <div>{children}</div>
      {onEditar && <span className="editar">corrigir</span>}
    </div>
  );
}

function Conversa({ p, itens, res, veiculo, prestadores, operador, orient }: { p: Protocolo; itens: ItemArvore[]; res: ResultadoTriagem; veiculo?: Veiculo; prestadores: Prestador[]; operador: string; orient: Orient }) {
  const ref = useRef<HTMLDivElement>(null);
  const ps = p.passos ?? {};
  const nome = p.motoristaNome.trim() || 'Motorista';
  const primeiroNome = nome.split(' ')[0];
  const subst = (t: string) => substituir(t, p, res, operador);
  const m = (n: number) => roteiro[n - 1];
  const linhas: ReactNode[] = [];
  let ativo: ReactNode = null;

  const turnoItem = (i: ItemArvore, primeiro: boolean, n: number): boolean => {
    const v = p.respostas[i.id];
    const pulou = ps[`pulou:${i.id}`];
    const intro = primeiro ? m(n).intencao : undefined;
    const fala = subst(i.perguntas[0] ?? i.info);
    // Fumaça/fogo e vazamento não fazem parte da conversa: se houver, aparece no relato do motorista
    if (i.naConversa === false) return true;
    if (v || pulou) {
      linhas.push(
        <Fragment key={i.id}>
          <Guia intro={intro} fala={fala} />
          <Resposta quem={pulou && !v ? 'não perguntado' : primeiroNome} onEditar={() => reabrir(p, i.id)}>{v || <span className="suave">pulado</span>}</Resposta>
        </Fragment>,
      );
      return true;
    }
    const jaDisse = (orient.ia?.ja_respondidos ?? []).find((x) => x.item === i.id && orient.ativa('ja_respondido', x.item, x.valor));
    ativo = (
      <Fragment key={i.id}>
        <Guia intro={intro} fala={fala} outras={i.perguntas.slice(1, 2).map(subst)} cuidado={i.cuidado || undefined}
          extra={<>
            {i.obrigatoria === 'trava' && <p className="trava">Segurança: precisa da resposta antes de seguir.</p>}
            {jaDisse && (
              <div className="jadisse">Ele já disse: <i>“{jaDisse.trecho}”</i> → <b>{jaDisse.valor}</b>
                <button onClick={() => { responder(p, i.id, jaDisse.valor, ' (relato, sugestão da IA)'); orient.registrar('ja_respondido', i.id, jaDisse.trecho, 'aceita', jaDisse.valor); }}>Confirmar</button>
                <button className="link" onClick={() => orient.registrar('ja_respondido', i.id, jaDisse.trecho, 'recusada', jaDisse.valor)}>não</button>
              </div>
            )}
          </>} />
        <Compositor p={p} item={i} podeEncerrar={n === 4 && !pendentes(p, itens, 4).some((x) => x.obrigatoria !== 'nao')} />
      </Fragment>
    );
    return false;
  };

  const momentoItens = (n: number): boolean => {
    const ordem = { trava: 0, sim: 1, nao: 2 } as const;
    const feitos = itens.filter((i) => i.momento === n && (p.respostas[i.id] || ps[`pulou:${i.id}`])).sort((a, c) => ordem[a.obrigatoria] - ordem[c.obrigatoria]);
    const pend = pendentes(p, itens, n);
    let primeiro = true;
    for (const i of [...feitos, ...pend].filter((x) => x.naConversa !== false)) {
      if (!turnoItem(i, primeiro, n)) return false;
      primeiro = false;
    }
    return true;
  };

  (() => {
    // 1. Acolher
    if (!ps.acolher) { ativo = <Fragment key="acolher"><Guia intro={`Atenda pelo nome e se apresente. ${m(1).intencao} Logo depois, a segurança dele.`} fala={subst(m(1).falas[0])} cuidado={textoEvite(m(1).evite)} /><CompositorAcolher p={p} /></Fragment>; return; }
    linhas.push(<Fragment key="acolher"><Guia intro="Atenda pelo nome e se apresente." fala={subst(m(1).falas[0])} /><Resposta quem="atendido" onEditar={() => marcarPasso(p, 'acolher', false)}>{p.motoristaNome || 'Motorista na linha'}</Resposta></Fragment>);

    // 2. Cuidar: antes do relato, o caminhão em local seguro e o motorista bem
    if (!momentoItens(3)) return;


    // 3. Ouvir: só depois da segurança, o relato com as palavras dele
    if (!ps.ouvir || !p.relato.trim()) { ativo = <Fragment key="ouvir"><Guia intro={m(2).intencao} fala={subst(m(2).falas[0])} outras={m(2).falas.slice(1)} cuidado="Quando ele parar, pergunte: “Mais alguma coisa que você notou?”" /><CompositorRelato p={p} /></Fragment>; return; }
    linhas.push(<Fragment key="ouvir"><Guia intro="Deixe ele contar." fala={subst(m(2).falas[0])} /><Resposta quem={primeiroNome} onEditar={() => marcarPasso(p, 'ouvir', false)}>“{p.relato}”</Resposta></Fragment>);

    // 4. Entender: queixa, caminhão, depois só o que falta na árvore
    if (!p.queixa) {
      const sug = orient.ia?.queixa_sugerida;
      ativo = <Fragment key="queixa"><Guia intro="Agora, para entender o defeito: pelo que ele contou, qual é a queixa principal?" extra={sug && orient.ativa('queixa', sug) ? <p className="jadisse">O relato aponta para: <b>{queixaPorId(sug)?.nome}</b></p> : undefined} /><CompositorQueixa p={p} sugerida={sug ?? undefined} orient={orient} /></Fragment>;
      return;
    }
    linhas.push(<Fragment key="queixa"><Guia intro="Pelo relato, qual é a queixa principal?" /><Resposta quem="queixa" onEditar={() => atualizar(p.id, { queixa: '' }, { tipo: 'queixa', detalhe: 'trocada' })}>{queixaPorId(p.queixa)?.nome}</Resposta></Fragment>);
    if (!temArvore(p.queixa)) linhas.push(<Guia key="semarvore" intro="Esta queixa ainda não tem árvore. Pergunte o que achar importante, registre no relato e passe ao analista no fim." />);

    if (!p.frota || !p.km) { ativo = <Fragment key="frota"><Guia fala={subst(m(4).falas[0])} /><CompositorFrota p={p} /></Fragment>; return; }
    linhas.push(<Fragment key="frota"><Guia fala={subst(m(4).falas[0])} /><Resposta quem={primeiroNome}>Frota {p.frota} · {p.km} km{veiculo ? <span className="suave"> · {veiculo.marca} {veiculo.modelo}, {veiculo.centro}</span> : <span className="aviso-inline"> · não achei essa frota na planilha</span>}</Resposta></Fragment>);

    const p4 = pendentes(p, itens, 4);
    const fecha4 = p4.length && !p4.some((x) => x.obrigatoria !== 'nao') && (res.saida || res.paraAnalista || ps.entender);
    if (fecha4) {
      const feitos = itens.filter((i) => i.momento === 4 && (p.respostas[i.id] || ps[`pulou:${i.id}`]));
      feitos.forEach((i, k) => turnoItem(i, k === 0, 4));
    } else if (!momentoItens(4)) return;
    if (res.saida) linhas.push(<Guia key="saida" intro={`Já dá para combinar: as regras chegaram a ${res.saida.id} (${res.prioridade}; nível indicado ${nivelMinimo(res)}). Agora o plano, com a opinião dele.`} />);

    // 5. Combinar
    if (!momentoItens(5)) return;

    // Classificação da complexidade pelo atendente
    const minimo = nivelMinimo(res);
    const motivoRegra = res.motivos.filter((x) => /analista|N2|N3/.test(x)).join('; ');
    if (!p.nivelOperador) {
      ativo = <Fragment key="nivel"><Guia intro={`Antes de fechar, classifique a complexidade do atendimento. As regras indicam ${minimo}${motivoRegra ? ` (${motivoRegra})` : ''}. Você pode subir o nível, não baixar.`} /><CompositorNivel p={p} minimo={minimo} /></Fragment>;
      return;
    }
    linhas.push(<Fragment key="nivel"><Guia intro="Complexidade do atendimento" /><Resposta quem="classificado pelo atendente" onEditar={() => atualizar(p.id, { nivelOperador: undefined, nivelMotivo: undefined }, { tipo: 'nivel', detalhe: 'classificação reaberta' })}>{p.nivelOperador} · {NIVEIS.find((x) => x.n === p.nivelOperador)?.nome}{p.nivelMotivo ? <span className="suave"> — {p.nivelMotivo}</span> : null}</Resposta></Fragment>);

    // 6. Fechar
    ativo = (
      <Fragment key="fechar">
        <Guia intro={m(6).intencao} fala={subst(m(6).falas[0])} outras={m(6).falas.slice(1).map(subst)} cuidado={textoEvite(m(6).evite)}
          extra={p.nivelOperador && p.nivelOperador !== 'N1' ? <p className="trava">Classificado como {p.nivelOperador}: passe ao {p.nivelOperador === 'N3' ? 'consultor técnico' : 'analista'} antes de direcionar.</p> : undefined} />
        <div className="msg compositor largo"><Fechar p={p} res={comNivelDoAtendente(p, res)} veiculo={veiculo} prestadores={prestadores} /></div>
      </Fragment>
    );
  })();

  const total = linhas.length;
  useEffect(() => { const el = ref.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [total, p.queixa, p.frota]);

  return (
    <div className="conversa" ref={ref}>
      {linhas}
      {ativo}
    </div>
  );
}

// ---------------- Campos de resposta (abrem um por vez, como num chat) ----------------
function CompositorAcolher({ p }: { p: Protocolo }) {
  const [n, setN] = useState(p.motoristaNome);
  const ok = () => { atualizar(p.id, { motoristaNome: n.trim() }); marcarPasso(p, 'acolher', true, 'acolheu'); };
  return (
    <div className="msg compositor">
      <input autoFocus value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} placeholder="Nome do motorista, como ele se apresentou" />
      <button className="primario" onClick={ok}>Me apresentei ↵</button>
    </div>
  );
}

function CompositorRelato({ p }: { p: Protocolo }) {
  const [t, setT] = useState(p.relato);
  useEffect(() => { const h = setTimeout(() => t !== p.relato && atualizar(p.id, { relato: t }), 800); return () => clearTimeout(h); }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = () => {
    atualizar(p.id, { relato: t.trim(), passos: { ...(p.passos ?? {}), ouvir: true } }, { tipo: 'roteiro', detalhe: 'relato concluído' });
  };
  return (
    <div className="msg compositor">
      <textarea autoFocus rows={4} value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && t.trim() && ok()} placeholder='Anote com as palavras dele. Ex.: "tô pisando e ele demora pra parar, o pedal tá indo mais fundo"' />
      <div className="linha"><span className="suave pequeno">Ctrl+Enter quando ele terminar</span><button className="primario" disabled={!t.trim()} onClick={ok}>Ele terminou de contar</button></div>
    </div>
  );
}

function CompositorQueixa({ p, sugerida, orient }: { p: Protocolo; sugerida?: string; orient: Orient }) {
  const escolher = (id: string, ia = false) => {
    atualizar(p.id, { queixa: id }, { tipo: 'queixa', detalhe: id + (ia ? ' (sugestão da IA)' : '') });
    if (sugerida) orient.registrar('queixa', sugerida, 'queixa', sugerida === id ? 'aceita' : 'recusada');
  };
  return (
    <div className="msg compositor">
      <div className="respostas-rapidas">
        {queixas.filter((q) => q.piloto).map((q) => <button key={q.id} className={q.id === sugerida ? 'sugerida' : ''} onClick={() => escolher(q.id, q.id === sugerida)}>{q.nome}</button>)}
        <select value="" onChange={(e) => e.target.value && escolher(e.target.value)}>
          <option value="">outra…</option>
          {queixas.filter((q) => !q.piloto).map((q) => <option key={q.id} value={q.id}>{q.nome} (sem árvore → analista)</option>)}
        </select>
      </div>
    </div>
  );
}

function CompositorFrota({ p }: { p: Protocolo }) {
  const [f, setF] = useState(p.frota);
  const [k, setK] = useState(p.km);
  const ok = () => { if (!f.trim() || !k.trim()) return; atualizar(p.id, { frota: f.trim(), km: k.trim() }, { tipo: 'veiculo', detalhe: `frota ${f} · ${k} km` }); registrarFotoVeiculo(p.id, 'frota_informada'); };
  return (
    <div className="msg compositor">
      <div className="linha">
        <input autoFocus style={{ width: 110 }} value={f} onChange={(e) => setF(e.target.value)} placeholder="Frota" />
        <input style={{ width: 130 }} value={k} inputMode="numeric" onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} placeholder="Km atual" />
        <button className="primario" disabled={!f.trim() || !k.trim()} onClick={ok}>Registrar ↵</button>
      </div>
    </div>
  );
}

function Compositor({ p, item, podeEncerrar }: { p: Protocolo; item: ItemArvore; podeEncerrar: boolean }) {
  const [t, setT] = useState('');
  const pular = () => marcarPasso(p, `pulou:${item.id}`, true, `${item.id} não perguntado`);
  return (
    <div className="msg compositor">
      {item.frases && <p className="suave pequeno">Ele pode dizer: {item.frases}</p>}
      {item.tipo === 'texto' ? (
        <div className="linha">
          <input autoFocus className="cresce" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && t.trim() && responder(p, item.id, t.trim())} placeholder="com as palavras dele" />
          <button className="primario" disabled={!t.trim()} onClick={() => responder(p, item.id, t.trim())}>Registrar ↵</button>
          {item.id === 'COM-01' && <button onClick={() => responder(p, item.id, 'Não tem ideia')}>Não tem ideia</button>}
        </div>
      ) : (
        <div className="respostas-rapidas">
          {item.opcoes.map((o) => <button key={o} onClick={() => responder(p, item.id, o)}>{o}</button>)}
        </div>
      )}
      {(item.obrigatoria === 'nao' || podeEncerrar) && (
        <div className="linha fim">
          {item.obrigatoria === 'nao' && <button className="link" onClick={pular}>não perguntar isto</button>}
          {podeEncerrar && <button className="link" onClick={() => marcarPasso(p, 'entender', true, 'informações suficientes')}>já tenho o suficiente, seguir para o combinado →</button>}
        </div>
      )}
    </div>
  );
}

/** Resultado das regras com o nível escolhido pelo atendente (que nunca fica abaixo do indicado). */
function comNivelDoAtendente(p: Protocolo, res: ResultadoTriagem): ResultadoTriagem {
  const n = p.nivelOperador && ORDEM_NIVEL[p.nivelOperador] >= ORDEM_NIVEL[nivelMinimo(res)] ? p.nivelOperador : nivelMinimo(res);
  return { ...res, nivel: n, paraAnalista: res.paraAnalista || n !== 'N1' };
}

function CompositorNivel({ p, minimo }: { p: Protocolo; minimo: Nivel }) {
  const [escolha, setEscolha] = useState<Nivel | null>(null);
  const [motivo, setMotivo] = useState('');
  const precisaMotivo = escolha !== null && escolha !== minimo;
  const confirmar = (n: Nivel, m = '') =>
    atualizar(p.id, { nivelOperador: n, nivelMotivo: m || undefined }, { tipo: 'nivel', detalhe: `${n} (regras indicam ${minimo})${m ? ` — ${m}` : ''}` });
  return (
    <div className="msg compositor largo">
      <div className="niveis">
        {NIVEIS.map((x) => {
          const abaixo = ORDEM_NIVEL[x.n] < ORDEM_NIVEL[minimo];
          return (
            <button key={x.n} disabled={abaixo} className={`nivel ${x.n === minimo ? 'indicado' : ''} ${escolha === x.n ? 'escolhido' : ''}`}
              title={abaixo ? `As regras indicam no mínimo ${minimo}` : ''}
              onClick={() => (x.n === minimo ? confirmar(x.n) : setEscolha(x.n))}>
              <b>{x.n} · {x.nome}</b>{x.n === minimo && <span className="tag">indicado</span>}
              <span>{x.quando}</span>
            </button>
          );
        })}
      </div>
      {precisaMotivo && (
        <div className="linha">
          <input autoFocus className="cresce" value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && motivo.trim() && confirmar(escolha!, motivo.trim())} placeholder={`Por que ${escolha}? (fica registrado para o analista)`} />
          <button className="primario" disabled={!motivo.trim()} onClick={() => confirmar(escolha!, motivo.trim())}>Classificar {escolha} ↵</button>
        </div>
      )}
    </div>
  );
}

function Cabecalho({ p }: { p: Protocolo }) {
  const [editar, setEditar] = useState(false);
  const campo = (k: keyof Protocolo, rotulo: string, larg = 120) => (
    <label style={{ width: larg }}>{rotulo}
      <input value={String(p[k] ?? '')} onChange={(e) => atualizar(p.id, { [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="cabecalho">
      <div className="num">
        <strong>{p.numero}</strong> {p.prioridade && <Prio p={p.prioridade} />} <span className="suave">· {p.origem} · {fmtData(p.abertoEm)} · {ESTADOS[p.estado]}</span>
        {!editar && <span> · {p.motoristaNome || 'motorista ?'}{p.frota ? ` · frota ${p.frota}` : ''}{p.km ? ` · ${p.km} km` : ''}{p.localInformado ? ` · ${p.localInformado}` : ''}</span>}
      </div>
      {editar && <div className="linha">
        {campo('motoristaNome', 'Motorista', 140)}
        {campo('motoristaTelefone', 'Telefone', 120)}
        {campo('localInformado', 'Onde está', 170)}
        {campo('frota', 'Frota', 70)}
        {campo('km', 'Km atual', 90)}
      </div>}
      <button className="link pequeno" onClick={() => setEditar(!editar)}>{editar ? 'ok' : 'dados do protocolo'}</button>
      <button className="link pequeno" onClick={() => ir('/fila')}>← fila</button>
    </div>
  );
}

function resumoSBAR(p: Protocolo, res: ResultadoTriagem, veiculo?: Veiculo) {
  const seguro = p.respostas['SEG-01'] ?? 'local não confirmado';
  const marcados = Object.entries(p.respostas).filter(([k]) => !k.startsWith('SEG') && !k.startsWith('COM')).map(([k, v]) => `${k}: ${v}`).join('; ');
  return [
    `Situação: frota ${p.frota || '?'} (${veiculo ? `${veiculo.marca} ${veiculo.modelo}, ${veiculo.centro}` : 'sem cadastro'}), km ${p.km || '?'}, ${seguro.toLowerCase()}${p.localInformado ? `, ${p.localInformado}` : ''}.`,
    `Contexto: ${p.relato || 'sem relato'}${marcados ? ` | ${marcados}` : ''}.`,
    `Avaliação: ${res.saida ? `${res.saida.id} (${res.saida.quando})` : 'sem saída definida'}, ${res.prioridade ?? '?'}, ${res.nivel ?? '?'}. Falhas: ${res.falhas.join(', ') || '—'}. Palpite do motorista: ${p.respostas['COM-01'] || '—'}.`,
    `Recomendação: ${res.orientacao ?? 'definir com o analista'}${res.local ? ' (atendimento no local)' : ''}.`,
  ].join('\n');
}

function Fechar({ p, res, veiculo, prestadores }: { p: Protocolo; res: ResultadoTriagem; veiculo?: Veiculo; prestadores: Prestador[] }) {
  const u = lerBanco().usuario!;
  const [retorno, setRetorno] = useState(paraInput(retornoPendente(p)?.combinadoPara));
  const [previsao, setPrevisao] = useState(paraInput(p.previsaoLiberacao));
  const ehAnalista = u.perfil !== 'N1';

  const candidatos = useMemo(() => {
    const esp = (res.especialidade ?? '').toLowerCase();
    const base = esp.split(/[ /(]/)[0];
    return prestadores
      .map((pr) => ({
        pr,
        esp: pr.especialidades.some((e) => e.toLowerCase() === esp) ? 2 : pr.especialidades.some((e) => base && e.toLowerCase().includes(base)) ? 1 : 0,
        marca: pr.marcas.some((m) => m.toLowerCase() === 'todas' || (veiculo?.marca && m.toLowerCase() === veiculo.marca.toLowerCase())),
        centro: !veiculo?.centro || pr.centros.includes(veiculo.centro),
      }))
      .filter((x) => x.esp > 0 && x.marca)
      .sort((a, c) => Number(c.centro) - Number(a.centro) || c.esp - a.esp || Number(c.pr.tipo === 'homologado') - Number(a.pr.tipo === 'homologado') || Number(c.pr.atendeNoLocal && res.local) - Number(a.pr.atendeNoLocal && res.local));
  }, [prestadores, res.especialidade, res.local, veiculo]);

  const faltas: string[] = [];
  if (!p.frota || !p.km) faltas.push('frota e km');
  if (!res.podeConcluir) faltas.push('travas e informações obrigatórias');
  if (!res.prioridade) faltas.push('saída definida');
  if (!p.prestadorId) faltas.push('prestador');
  if (!retorno) faltas.push('hora do retorno');
  if (p.prestadorId && !osEmDia(p)) faltas.push('ordens de serviço geradas e em dia');
  if (!p.nivelOperador) faltas.push('classificação do nível');
  if (res.paraAnalista && !ehAnalista) faltas.push(`passagem ao ${res.nivel === 'N3' ? 'consultor técnico (N3)' : 'analista (N2)'}`);

  const gravarResultado = () => ({
    saidaId: res.saida?.id, prioridade: res.prioridade, nivel: res.nivel, falhas: res.falhas,
    especialidade: res.especialidade, local: res.local, previsaoLiberacao: deInput(previsao),
  });

  const direcionar = () => {
    const retornos = [...p.retornos.filter((r) => r.feitoEm), { combinadoPara: deInput(retorno)! }];
    atualizar(p.id, { ...gravarResultado(), retornos }, { tipo: 'triagem', detalhe: res.motivos.join(' | ') });
    registrarFotoVeiculo(p.id, 'direcionado');
    const os = (p.ordens ?? []).at(-1);
    mudarEstado(p.id, 'direcionado', `prestador ${os?.prestadorNome ?? prestadores.find((x) => x.id === p.prestadorId)?.nome} · ${resumoOrdens(p) || 'sem OS'}`);
  };

  const passar = () => {
    atualizar(p.id, gravarResultado(), { tipo: 'passagem', detalhe: resumoSBAR(p, res, veiculo) });
    registrarFotoVeiculo(p.id, 'passado_adiante');
    mudarEstado(p.id, 'com_analista');
  };

  const emTriagem = p.estado === 'em_triagem' || p.estado === 'com_analista';

  return (
    <div className="fechar">
      {emTriagem && <>
        <div className="linha">
          <label className="cresce">Prestador {res.especialidade && <span className="suave">({res.especialidade}{res.local ? ', no local' : ''})</span>}
            <select value={p.prestadorId ?? ''} onChange={(e) => atualizar(p.id, { prestadorId: e.target.value || undefined }, { tipo: 'prestador', detalhe: e.target.value })}>
              <option value="">— escolher —</option>
              {candidatos.map(({ pr, centro }) => (
                <option key={pr.id} value={pr.id}>{pr.nome} · {pr.cidade} · {pr.tipo}{pr.atendeNoLocal ? ' · vai ao local' : ''}{centro ? '' : ' · fora do centro'} · {pr.telefone}</option>
              ))}
              <option value="spot">Spot (sem homologado na região)</option>
            </select>
          </label>
        </div>
        <div className="linha">
          <label>Ligar de volta às *<input type="datetime-local" value={retorno} onChange={(e) => setRetorno(e.target.value)} /></label>
          <label>Previsão de liberação (painel do centro)<input type="datetime-local" value={previsao} onChange={(e) => setPrevisao(e.target.value)} /></label>
        </div>
        {p.prestadorId && <EditorOS p={p} res={res} veiculo={veiculo} prestador={prestadores.find((x) => x.id === p.prestadorId)} autor={u.nome} />}
        {res.fechamento && <p className="plano"><b>Exemplo de fechamento:</b> “{res.fechamento}” <span className="suave">— peça que ele repita o combinado e pergunte se ficou dúvida.</span></p>}
        <div className="linha">
          <button className="primario" disabled={faltas.length > 0} onClick={direcionar} title={faltas.length ? `Falta: ${faltas.join(', ')}` : ''}>Direcionar ao prestador</button>
          {p.estado === 'em_triagem' && <button onClick={passar}>{res.nivel === 'N3' ? 'Passar ao consultor técnico' : 'Passar ao analista'}</button>}
          {p.estado === 'com_analista' && ehAnalista && <button onClick={() => mudarEstado(p.id, 'em_triagem', 'devolvido ao operador')}>Devolver ao operador</button>}
        </div>
        {faltas.length > 0 && <p className="suave">Para direcionar falta: {faltas.join(', ')}.</p>}
      </>}
      {!emTriagem && p.prestadorId && (
        <details className="os-emitida"><summary>Ordens de serviço ({resumoOrdens(p) || 'nenhuma emitida'})</summary>
          <EditorOS p={p} res={res} veiculo={veiculo} prestador={prestadores.find((x) => x.id === p.prestadorId)} autor={u.nome} />
        </details>
      )}
      {p.estado === 'direcionado' && (
        <div className="linha">
          <button className="primario" onClick={() => mudarEstado(p.id, 'aguarda_orcamento', 'prestador confirmou')}>Prestador confirmou o atendimento</button>
        </div>
      )}
      {['direcionado', 'aguarda_orcamento', 'em_validacao', 'encerrado'].includes(p.estado) && (
        <div className="linha">
          <label>Previsão de liberação<input type="datetime-local" value={previsao} onChange={(e) => { setPrevisao(e.target.value); atualizar(p.id, { previsaoLiberacao: deInput(e.target.value) }, { tipo: 'previsao', detalhe: e.target.value }); }} /></label>
          <label>Novo retorno<input type="datetime-local" value={retorno} onChange={(e) => setRetorno(e.target.value)} /></label>
          <button onClick={() => retorno && atualizar(p.id, { retornos: [...p.retornos, { combinadoPara: deInput(retorno)! }] }, { tipo: 'retorno', detalhe: `combinado para ${retorno}` })}>Agendar retorno</button>
          <button onClick={() => ir('/validacao')}>Orçamento técnico →</button>
          {!p.liberadoEm && <button onClick={() => atualizar(p.id, { liberadoEm: new Date().toISOString() }, { tipo: 'liberacao', detalhe: 'veículo liberado' })}>Veículo liberado</button>}
        </div>
      )}
      <details className="historico"><summary>Histórico do protocolo ({p.eventos.length})</summary>
        <ul>{p.eventos.slice().reverse().map((e, i) => <li key={i}><span className="suave">{fmtData(e.em)} · {e.autor} · {e.tipo}</span> {e.detalhe}</li>)}</ul>
      </details>
    </div>
  );
}

function HistoricoVeiculo({ frota, km, veiculo }: { frota: string; km: string; veiculo?: Veiculo }) {
  const b = useBanco();
  if (!frota) return <p className="suave">Informe a frota para ver revisão, manutenção, checklist e preventivas em aberto.</p>;
  if (!veiculo) return <p className="aviso">Frota {frota} não encontrada na planilha de veículos. Confira o número com o motorista ou atualize a planilha em “Planilhas e dados”.</p>;
  const h = b.historico.filter((x) => x.frota === frota).sort((a, c) => c.data.localeCompare(a.data));
  const rev = h.find((x) => x.tipo === 'revisao');
  const man = h.find((x) => x.tipo === 'manutencao');
  const ck = b.checklist.filter((x) => x.frota === frota);
  const kmAtual = kmReferencia(km, b.historico, frota);
  const pv = emAberto(b.preventivas, frota);
  return (
    <div className="historico-veiculo">
      <div><b>Frota {veiculo.frota}</b> · {veiculo.marca} {veiculo.modelo} · {veiculo.classe} · {veiculo.centro}</div>
      <div className="tres">
        <div><h4>Última revisão</h4>{rev ? <p>{fmtDia(rev.data)} · {rev.km} km<br />{rev.descricao}<br /><span className="suave">{rev.prestador}</span></p> : <p className="suave">Sem registro</p>}</div>
        <div><h4>Última manutenção</h4>{man ? <p>{fmtDia(man.data)} · {man.km} km<br />{man.descricao}<br /><span className="suave">{man.prestador}</span></p> : <p className="suave">Sem registro</p>}</div>
        <div><h4>Checklist em aberto ({ck.length})</h4>{ck.length ? <ul>{ck.map((c, i) => <li key={i}>{fmtDia(c.data)} · {c.item}: {c.resposta}</li>)}</ul> : <p className="suave">Nada em aberto</p>}</div>
        <div><h4>Preventivas em aberto ({pv.length}){kmAtual ? <span className="suave"> · km {fmtKm(kmAtual)}</span> : null}</h4>
          {pv.length ? <ul className="preventivas">{pv.map((x) => { const st = situacao(x, kmAtual); return <li key={x.id} className={st.classe}>{x.tipo} · {fmtKm(x.kmPrevisto)} km · <b>{st.rotulo}</b></li>; })}</ul> : <p className="suave">Nada programado</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------- IA: lê o ponto da conversa e orienta ----------------
// Passos em que não há frase para o motorista: a IA só ajuda a decidir (queixa, nível).
const SEM_FALA: Passo[] = ['queixa', 'nivel'];

/** Guarda no protocolo a orientação que o painel mostrou em cada bloco (só quando muda). */
function guardarOrientacao(id: string, passo: Passo, momento: number, item: string | undefined, r: RespostaIA) {
  const atual = lerBanco().protocolos.find((x) => x.id === id);
  if (!atual) return;
  const nova: OrientacaoMostrada = {
    em: new Date().toISOString(), autor: lerBanco().usuario?.nome ?? '', passo, momento, item,
    fonte: r.fonte, aviso: r.aviso, fala: r.fala_sugerida, dica: r.dica, atencao: r.atencao,
    ja_respondidos: r.ja_respondidos, falta_perguntar: r.falta_perguntar, falhas: r.falhas, queixa_sugerida: r.queixa_sugerida, ms: r.ms,
  };
  const ultima = atual.orientacoesIA?.at(-1);
  const semData = (o?: OrientacaoMostrada) => o && JSON.stringify({ ...o, em: '', autor: '', ms: 0 });
  if (semData(ultima) === semData(nova)) return;
  atualizar(id, { orientacoesIA: [...(atual.orientacoesIA ?? []), nova] });
}

function useOrientacao(p: Protocolo | undefined, itens: ItemArvore[], res: ResultadoTriagem, ponto: Ponto, guia: { fala?: string; atencao: string; dica: string }, veiculo?: Veiculo) {
  const { momento, item: itemAtual, passo } = ponto;
  const [ia, setIa] = useState<RespostaIA | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [dispensadas, setDispensadas] = useState<Set<string>>(new Set());
  const chave = JSON.stringify([p?.relato, p?.respostas, p?.queixa, p?.frota, p?.nivelOperador, passo, itemAtual?.id]);
  const ultimo = useRef('');

  const ultimoRelato = useRef('');
  const pedidoAtual = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!p) return;
    const regras: RespostaIA = { ...orientacaoPorRegras(itens, p.respostas, momento, itemAtual, res.falhas), fala_sugerida: guia.fala, atencao: guia.atencao, dica: guia.dica };
    // A orientação pelas regras aparece na hora; a do Claude substitui assim que chega.
    setIa((atual) => (atual && atual.fonte === 'claude' && ultimo.current === chave ? atual : { ...regras, aviso: atual?.aviso }));
    // Mudou o passo (resposta clicada): pede na hora. Só o texto do relato mudou: espera uma pausa curta na digitação.
    const soRelato = ultimoRelato.current !== '' && ultimoRelato.current !== p.relato;
    const espera = soRelato ? 700 : 0;
    const t = setTimeout(async () => {
      if (ultimo.current === chave) return;
      ultimo.current = chave;
      ultimoRelato.current = p.relato;
      const st = await statusIA();
      if (!st.ativa) { setIa({ ...regras, aviso: avisoIADesligada(st) }); guardarOrientacao(p.id, passo, momento, itemAtual?.id, regras); return; }
      if (momento < 2 || !p.relato.trim()) { guardarOrientacao(p.id, passo, momento, itemAtual?.id, regras); return; }
      pedidoAtual.current?.abort(); // descarta o pedido anterior: a conversa já andou
      const ctrl = new AbortController();
      pedidoAtual.current = ctrl;
      setCarregando(true);
      const r = await pedirIA({ protocoloId: p.id, queixa: p.queixa, relato: p.relato, respostas: p.respostas, momento, passo, itemAtual: itemAtual?.id, veiculo: veiculo ? { marca: veiculo.marca, modelo: veiculo.modelo, classe: veiculo.classe } : undefined }, ctrl.signal);
      if (r === null || ctrl.signal.aborted) return;
      setCarregando(false);
      const final: RespostaIA = 'erro' in r ? { ...regras, aviso: `IA indisponível (${r.erro}). Orientação pelas regras.` }
        : SEM_FALA.includes(passo) ? { ...r, fala_sugerida: undefined, atencao: guia.atencao } // sem frase ao motorista neste passo
        : { ...r, fala_sugerida: r.fala_sugerida || guia.fala, atencao: r.atencao || guia.atencao };
      setIa(final);
      guardarOrientacao(p.id, passo, momento, itemAtual?.id, final);
    }, espera);
    return () => clearTimeout(t);
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps

  const registrar = (tipo: 'ja_respondido' | 'falha' | 'queixa', codigo: string, texto: string, resposta: 'aceita' | 'recusada', valor?: string) => {
    if (!p) return;
    const atual = lerBanco().protocolos.find((x) => x.id === p.id) ?? p;
    atualizar(p.id, { sugestoes: [...atual.sugestoes, { em: new Date().toISOString(), tipo, codigo, valor, texto, resposta }] }, { tipo: 'ia', detalhe: `${resposta}: ${tipo} ${codigo}${valor ? ` = ${valor}` : ''}` });
    setDispensadas((d) => new Set(d).add(`${tipo}:${codigo}:${valor ?? ''}`));
  };
  const ativa = (tipo: string, codigo: string, valor?: string) => !dispensadas.has(`${tipo}:${codigo}:${valor ?? ''}`);
  return { ia, carregando, registrar, ativa };
}

function Orientacoes({ p, itens, res, ponto, guia, orient }: { p: Protocolo; itens: ItemArvore[]; res: ResultadoTriagem; ponto: Ponto; guia: { titulo: string }; orient: Orient }) {
  const { ia, carregando, registrar, ativa } = orient;
  const itemAtual = ponto.item;
  const nomeItem = (id: string) => itens.find((i) => i.id === id)?.info ?? id;
  // o item atual já aparece na conversa; aqui ficam os outros que o relato já respondeu
  const jaResp = (ia?.ja_respondidos ?? []).filter((x) => x.item !== itemAtual?.id && itens.find((i) => i.id === x.item)?.naConversa !== false && !p.respostas[x.item] && itens.some((i) => i.id === x.item) && ativa('ja_respondido', x.item, x.valor));

  return (
    <div className="orientacoes">
      <section className="ia passo">
        <h3><span className="suave pequeno">Agora</span><br />{guia.titulo} {carregando && <span className="suave">· lendo…</span>}</h3>
        {ponto.passo === 'queixa' && ia?.queixa_sugerida && <p className="dica">O relato aponta para: <b>{queixaPorId(ia.queixa_sugerida)?.nome}</b></p>}
        {ia?.fala_sugerida && <div className="fala grande">“{ia.fala_sugerida}”</div>}
        {/* Primeiro a orientação, depois o que evitar */}
        {ia?.dica && <p className="dica">{ia.dica}</p>}
        {ia?.atencao && <p className="cuidado">{ia.atencao}</p>}
        {ia?.aviso && <p className="aviso pequeno">{ia.aviso}</p>}
        <p className="suave pequeno">{ia?.fonte === 'claude' ? `Sugestão do Claude${ia.ms ? ` (${(ia.ms / 1000).toFixed(1).replace('.', ',')} s)` : ''}: diga com suas palavras.` : 'Orientação pelo roteiro e pela árvore.'}</p>
      </section>

      {jaResp.length > 0 && (
        <section className="ia">
          <h3>O relato já respondeu</h3>
          <p className="suave">Confirme e a conversa não pergunta de novo.</p>
          {jaResp.map((x) => (
            <div className="sug" key={x.item + x.valor}>
              {nomeItem(x.item)}: <b>{x.valor}</b><br /><span className="suave">“{x.trecho}”</span>
              <button onClick={() => { responder(p, x.item, x.valor, ' (relato, sugestão da IA)'); registrar('ja_respondido', x.item, x.trecho, 'aceita', x.valor); }}>Confirmar</button>
              <button className="link" onClick={() => registrar('ja_respondido', x.item, x.trecho, 'recusada', x.valor)}>não</button>
            </div>
          ))}
        </section>
      )}

      <section className="motor">
        <h3>Resultado das regras</h3>
        <p className="suave">Decide prioridade, nível e travas. Não é a IA.</p>
        {res.travasPendentes.length > 0 && <p className="aviso">Travas pendentes: {res.travasPendentes.map((i) => i.info).join('; ')}</p>}
        {res.saida || res.prioridade ? (
          <>
            <div className="resultado"><Prio p={res.prioridade} /> <span className="badge cinza">{res.nivel}</span> {res.local && <span className="badge cinza">no local</span>} {res.paraAnalista && <span className="badge p1">analista</span>}</div>
            {p.nivelOperador && p.nivelOperador !== res.nivel && <p className="suave">Atendente classificou como <b>{p.nivelOperador}</b>{p.nivelMotivo ? `: ${p.nivelMotivo}` : ''}.</p>}
            {res.saida && <p><b>{res.saida.id}</b> — {res.saida.quando}</p>}
            <p><b>Orientação ao motorista:</b> {res.orientacao}</p>
            <p><b>Especialidade:</b> {res.especialidade}</p>
            <details><summary>Por que (regras aplicadas)</summary><ul>{res.motivos.map((x, i) => <li key={i}>{x}</li>)}</ul></details>
          </>
        ) : <p className="suave">{p.queixa ? 'Ainda sem saída. Continue a conversa.' : 'A queixa é definida depois do relato e da segurança.'}</p>}
      </section>

      {(ia?.falhas ?? []).filter((x) => ativa('falha', x.codigo)).length > 0 && (
        <section className="ia">
          <h3>Falhas prováveis</h3>
          <p className="suave">Apoio ao prestador, não diagnóstico.</p>
          {(ia?.falhas ?? []).filter((x) => ativa('falha', x.codigo)).map((x) => (
            <div className="sug" key={x.codigo}><b>{x.codigo}</b> {falhaPorId(x.codigo)?.sintoma}<br /><span className="suave">{x.motivo}</span>
              {ia?.fonte === 'claude' && <><button onClick={() => registrar('falha', x.codigo, x.motivo, 'aceita')}>Concordo</button><button className="link" onClick={() => registrar('falha', x.codigo, x.motivo, 'recusada')}>não</button></>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
