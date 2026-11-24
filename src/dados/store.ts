// Armazenamento da tela. Guarda tudo na memória e no navegador (localStorage).
// Com o Supabase configurado (site online), cada mudança também vai para o banco: ver dados/nuvem.ts.
import { useSyncExternalStore } from 'react';
import type { ChecklistAberto, Estado, Historico, Prestador, Preventiva, Protocolo, Veiculo } from '../types';
import { lerCsv } from './csv';
import { VERSAO_REGRAS } from '../conteudo';
import { emAberto, kmReferencia, situacao } from './preventivas';
import type { FotoVeiculo } from '../types';

export interface Usuario { nome: string; perfil: 'N1' | 'N2' | 'N3' | 'gestao' | 'centro'; centro?: string }

interface Banco {
  protocolos: Protocolo[];
  veiculos: Veiculo[];
  historico: Historico[];
  checklist: ChecklistAberto[];
  preventivas: Preventiva[];
  prestadores: Prestador[];
  checklistApp?: ChecklistAberto[]; // itens em aberto do app de vistoria (online; lidos do banco, não da planilha)
  usuario?: Usuario;
  seq: number;
}

// Online, o cache do navegador usa outra chave, para não misturar testes locais com dados reais.
const NUVEM = !!import.meta.env.VITE_SUPABASE_URL;
const CHAVE = NUVEM ? 'central-atendimento:nuvem' : 'central-atendimento:v1';

// Quem quer saber das mudanças (a sincronização com o Supabase). Sem nuvem, ninguém escuta.
type Mudanca = { tipo: 'protocolo'; id: string } | { tipo: 'cadastro'; nome: 'veiculos' | 'historico' | 'checklist' | 'preventivas' | 'prestadores' };
let ouvinteMudancas: ((m: Mudanca) => void) | null = null;
export const definirOuvinteMudancas = (f: typeof ouvinteMudancas) => { ouvinteMudancas = f; };
const mudou = (m: Mudanca) => ouvinteMudancas?.(m);
const vazio = (): Banco => ({ protocolos: [], veiculos: [], historico: [], checklist: [], preventivas: [], prestadores: [], seq: 0 });

function carregar(): Banco {
  try {
    const raw = localStorage.getItem(CHAVE);
    if (raw) return { ...vazio(), ...JSON.parse(raw) };
  } catch { /* ignora e recomeça */ }
  return vazio();
}

let banco = carregar();
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

function salvar(novo: Banco) {
  banco = novo;
  try { localStorage.setItem(CHAVE, JSON.stringify(banco)); } catch { /* sem espaço */ }
  avisar();
}

// Outra aba (por exemplo, o painel do centro) vê as mudanças na hora.
window.addEventListener('storage', (e) => { if (e.key === CHAVE) { banco = carregar(); avisar(); } });

export function useBanco(): Banco {
  return useSyncExternalStore((f) => { ouvintes.add(f); return () => ouvintes.delete(f); }, () => banco);
}
export const lerBanco = () => banco;

/** Checklist em aberto da frota: o da planilha mais o que veio do app de vistoria (online). */
export const checklistDaFrota = (b: Pick<Banco, 'checklist' | 'checklistApp'>, frota: string) =>
  [...(b.checklistApp ?? []), ...b.checklist].filter((c) => c.frota === frota);

export function definirUsuario(u: Usuario | undefined) { salvar({ ...banco, usuario: u }); }

const agora = () => new Date().toISOString();
const autor = () => banco.usuario?.nome ?? 'sistema';

export function novoProtocolo(dados: Partial<Protocolo> & { origem: Protocolo['origem'] }): Protocolo {
  const seq = banco.seq + 1;
  const hoje = new Date();
  const p: Protocolo = {
    id: crypto.randomUUID(),
    // Online, o número definitivo vem do banco (sequência única da equipe); até lá fica um provisório.
    numero: `${NUVEM ? 'TMP-' : 'CA-'}${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}${String(hoje.getDate()).padStart(2, '0')}-${String(seq).padStart(4, '0')}`,
    abertoEm: agora(),
    frota: '', km: '', motoristaNome: '', motoristaTelefone: '', localInformado: '',
    queixa: '', estado: 'na_fila', operador: '', relato: '', respostas: {}, palpite: '',
    retornos: [], validacoes: [], sugestoes: [],
    eventos: [{ em: agora(), autor: autor(), tipo: 'abertura', detalhe: `Origem: ${dados.origem}` }],
    versaoRegras: VERSAO_REGRAS,
    ...dados,
  };
  salvar({ ...banco, seq, protocolos: [p, ...banco.protocolos] });
  mudou({ tipo: 'protocolo', id: p.id });
  return p;
}

/** Atualiza um protocolo e registra o evento (o histórico só cresce). */
export function atualizar(id: string, mudanca: Partial<Protocolo>, evento?: { tipo: string; detalhe: string }) {
  salvar({
    ...banco,
    protocolos: banco.protocolos.map((p) => {
      if (p.id !== id) return p;
      const eventos = evento ? [...p.eventos, { em: agora(), autor: autor(), ...evento }] : p.eventos;
      return { ...p, ...mudanca, eventos };
    }),
  });
  mudou({ tipo: 'protocolo', id });
}

export function mudarEstado(id: string, estado: Estado, detalhe = '') {
  const p = banco.protocolos.find((x) => x.id === id);
  if (!p || p.estado === estado) return;
  atualizar(id, { estado }, { tipo: 'estado', detalhe: `${p.estado} → ${estado}${detalhe ? ` (${detalhe})` : ''}` });
}

// ---------------- Planilhas (D-12: dados vêm de planilha) ----------------
const lista = (s?: string) => (s ?? '').split('|').map((x) => x.trim()).filter(Boolean);

const numero = (t?: string) => Number(String(t ?? '').replace(/\D/g, '')) || 0;

export function importarCsv(tipo: 'veiculos' | 'historico' | 'checklist' | 'preventivas' | 'prestadores', texto: string): number {
  const linhas = lerCsv(texto);
  if (tipo === 'preventivas') {
    const pv: Preventiva[] = linhas.filter((l) => l.frota && (l.tipo_revisao || l.tipo)).map((l) => ({
      id: crypto.randomUUID(), frota: l.frota, tipo: l.tipo_revisao || l.tipo, kmPrevisto: numero(l.km_previsto || l.km),
      observacao: l.observacao || undefined, executadaEm: l.executada_em || undefined, executadaKm: l.executada_km ? numero(l.executada_km) : undefined,
    }));
    salvar({ ...banco, preventivas: pv });
    mudou({ tipo: 'cadastro', nome: 'preventivas' });
    return pv.length;
  }
  if (tipo === 'veiculos') {
    const v: Veiculo[] = linhas.filter((l) => l.frota).map((l) => ({ frota: l.frota, placa: l.placa, marca: l.marca, modelo: l.modelo, classe: l.classe, centro: l.centro }));
    salvar({ ...banco, veiculos: v });
    mudou({ tipo: 'cadastro', nome: 'veiculos' });
    return v.length;
  }
  if (tipo === 'historico') {
    const h: Historico[] = linhas.filter((l) => l.frota).map((l) => ({ frota: l.frota, tipo: (l.tipo || '').toLowerCase().startsWith('rev') ? 'revisao' : 'manutencao', data: l.data, km: l.km, descricao: l.descricao, prestador: l.prestador }));
    salvar({ ...banco, historico: h });
    mudou({ tipo: 'cadastro', nome: 'historico' });
    return h.length;
  }
  if (tipo === 'checklist') {
    const c: ChecklistAberto[] = linhas.filter((l) => l.frota).map((l) => ({ frota: l.frota, data: l.data, item: l.item, resposta: l.resposta }));
    salvar({ ...banco, checklist: c });
    mudou({ tipo: 'cadastro', nome: 'checklist' });
    return c.length;
  }
  const pr: Prestador[] = linhas.filter((l) => l.nome).map((l, i) => ({
    id: l.id || `P${i + 1}`, nome: l.nome, cidade: l.cidade, uf: l.uf,
    especialidades: lista(l.especialidades), marcas: lista(l.marcas),
    tipo: (l.tipo || '').toLowerCase() === 'spot' ? 'spot' : 'homologado',
    atendeNoLocal: /^s/i.test(l.atende_no_local || ''), telefone: l.telefone, centros: lista(l.centros),
  }));
  salvar({ ...banco, prestadores: pr });
  mudou({ tipo: 'cadastro', nome: 'prestadores' });
  return pr.length;
}

/** Carrega as planilhas de exemplo (dados fictícios) da pasta public/modelos. */
export async function carregarExemplos() {
  for (const tipo of ['veiculos', 'historico', 'checklist', 'preventivas', 'prestadores'] as const) {
    const nome = tipo === 'checklist' ? 'checklist_aberto' : tipo;
    const r = await fetch(`${import.meta.env.BASE_URL}modelos/${nome}.csv`);
    if (r.ok) importarCsv(tipo, await r.text());
  }
}

export function apagarProtocolos() { salvar({ ...banco, protocolos: [], seq: 0 }); }

export function exportarBackup(): string { return JSON.stringify(banco, null, 1); }
export function importarBackup(texto: string) { salvar({ ...vazio(), ...JSON.parse(texto) }); }

// ---------------- Cadastro de preventivas programadas ----------------
export function incluirPreventiva(pv: Omit<Preventiva, 'id'>) {
  salvar({ ...banco, preventivas: [...banco.preventivas, { ...pv, id: crypto.randomUUID() }] });
  mudou({ tipo: 'cadastro', nome: 'preventivas' });
}
export function alterarPreventiva(id: string, mud: Partial<Preventiva>) {
  salvar({ ...banco, preventivas: banco.preventivas.map((x) => (x.id === id ? { ...x, ...mud } : x)) });
  mudou({ tipo: 'cadastro', nome: 'preventivas' });
}
export function removerPreventiva(id: string) {
  salvar({ ...banco, preventivas: banco.preventivas.filter((x) => x.id !== id) });
  mudou({ tipo: 'cadastro', nome: 'preventivas' });
}

/** Guarda o que a tela mostrava do veículo (histórico, checklist, preventivas) no momento de uma decisão. */
export function registrarFotoVeiculo(id: string, momento: FotoVeiculo['momento']) {
  const p = banco.protocolos.find((x) => x.id === id);
  if (!p?.frota) return;
  const km = kmReferencia(p.km, banco.historico, p.frota);
  const foto: FotoVeiculo = {
    em: agora(), autor: autor(), momento, frota: p.frota, kmInformado: p.km,
    veiculo: banco.veiculos.find((v) => v.frota === p.frota),
    historico: banco.historico.filter((h) => h.frota === p.frota).sort((a, c) => c.data.localeCompare(a.data)).slice(0, 10),
    checklist: checklistDaFrota(banco, p.frota),
    preventivasEmAberto: emAberto(banco.preventivas, p.frota).map((pv) => ({ ...pv, situacao: situacao(pv, km).rotulo })),
  };
  atualizar(id, { fotosVeiculo: [...(p.fotosVeiculo ?? []), foto] });
}

// ---------------- Usados pela sincronização com o Supabase ----------------
/** Troca dados vindos do banco (cadastros, protocolos de outras pessoas) sem avisar a sincronização de volta. */
export function aplicarDoBanco(parcial: Partial<Omit<Banco, 'usuario' | 'seq'>>) { salvar({ ...banco, ...parcial }); }
/** Coloca protocolos vindos do banco no lugar dos locais (mesmo id) ou acrescenta os novos. */
export function mesclarProtocolosDoBanco(lista: Protocolo[]) {
  if (!lista.length) return;
  const porId = new Map(lista.map((p) => [p.id, p]));
  const ficam = banco.protocolos.map((p) => porId.get(p.id) ?? p);
  const novos = lista.filter((p) => !banco.protocolos.some((x) => x.id === p.id));
  salvar({ ...banco, protocolos: [...novos, ...ficam].sort((a, c) => c.abertoEm.localeCompare(a.abertoEm)) });
}
/** Ao sair do site online, apaga a cópia dos dados reais deste navegador. */
export function limparCache() { salvar({ ...vazio() }); }
