// Armazenamento do PROTÓTIPO: fica no navegador (localStorage) deste computador.
// Na versão do servidor, esta camada é trocada pelo banco (PostgreSQL), sem mudar as telas.
import { useSyncExternalStore } from 'react';
import type { ChecklistAberto, Estado, Historico, Prestador, Preventiva, Protocolo, Veiculo } from '../types';
import { lerCsv } from './csv';
import { VERSAO_REGRAS } from '../conteudo';

export interface Usuario { nome: string; perfil: 'N1' | 'N2' | 'N3' | 'gestao' | 'centro'; centro?: string }

interface Banco {
  protocolos: Protocolo[];
  veiculos: Veiculo[];
  historico: Historico[];
  checklist: ChecklistAberto[];
  preventivas: Preventiva[];
  prestadores: Prestador[];
  usuario?: Usuario;
  seq: number;
}

const CHAVE = 'central-atendimento:v1';
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

export function definirUsuario(u: Usuario | undefined) { salvar({ ...banco, usuario: u }); }

const agora = () => new Date().toISOString();
const autor = () => banco.usuario?.nome ?? 'sistema';

export function novoProtocolo(dados: Partial<Protocolo> & { origem: Protocolo['origem'] }): Protocolo {
  const seq = banco.seq + 1;
  const hoje = new Date();
  const p: Protocolo = {
    id: crypto.randomUUID(),
    numero: `CA-${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}${String(hoje.getDate()).padStart(2, '0')}-${String(seq).padStart(4, '0')}`,
    abertoEm: agora(),
    frota: '', km: '', motoristaNome: '', motoristaTelefone: '', localInformado: '',
    queixa: '', estado: 'na_fila', operador: '', relato: '', respostas: {}, palpite: '',
    retornos: [], validacoes: [], sugestoes: [],
    eventos: [{ em: agora(), autor: autor(), tipo: 'abertura', detalhe: `Origem: ${dados.origem}` }],
    versaoRegras: VERSAO_REGRAS,
    ...dados,
  };
  salvar({ ...banco, seq, protocolos: [p, ...banco.protocolos] });
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
}

export function mudarEstado(id: string, estado: Estado, detalhe = '') {
  const p = banco.protocolos.find((x) => x.id === id);
  if (!p || p.estado === estado) return;
  atualizar(id, { estado }, { tipo: 'estado', detalhe: `${p.estado} → ${estado}${detalhe ? ` (${detalhe})` : ''}` });
}

// ---------------- Planilhas (D-12: dados vêm de planilha) ----------------
const lista = (s: string) => s.split('|').map((x) => x.trim()).filter(Boolean);

const numero = (t?: string) => Number(String(t ?? '').replace(/\D/g, '')) || 0;

export function importarCsv(tipo: 'veiculos' | 'historico' | 'checklist' | 'preventivas' | 'prestadores', texto: string): number {
  const linhas = lerCsv(texto);
  if (tipo === 'preventivas') {
    const pv: Preventiva[] = linhas.filter((l) => l.frota && (l.tipo_revisao || l.tipo)).map((l) => ({
      id: crypto.randomUUID(), frota: l.frota, tipo: l.tipo_revisao || l.tipo, kmPrevisto: numero(l.km_previsto || l.km),
      observacao: l.observacao || undefined, executadaEm: l.executada_em || undefined, executadaKm: l.executada_km ? numero(l.executada_km) : undefined,
    }));
    salvar({ ...banco, preventivas: pv });
    return pv.length;
  }
  if (tipo === 'veiculos') {
    const v: Veiculo[] = linhas.filter((l) => l.frota).map((l) => ({ frota: l.frota, placa: l.placa, marca: l.marca, modelo: l.modelo, classe: l.classe, centro: l.centro }));
    salvar({ ...banco, veiculos: v });
    return v.length;
  }
  if (tipo === 'historico') {
    const h: Historico[] = linhas.filter((l) => l.frota).map((l) => ({ frota: l.frota, tipo: (l.tipo || '').toLowerCase().startsWith('rev') ? 'revisao' : 'manutencao', data: l.data, km: l.km, descricao: l.descricao, prestador: l.prestador }));
    salvar({ ...banco, historico: h });
    return h.length;
  }
  if (tipo === 'checklist') {
    const c: ChecklistAberto[] = linhas.filter((l) => l.frota).map((l) => ({ frota: l.frota, data: l.data, item: l.item, resposta: l.resposta }));
    salvar({ ...banco, checklist: c });
    return c.length;
  }
  const pr: Prestador[] = linhas.filter((l) => l.nome).map((l, i) => ({
    id: l.id || `P${i + 1}`, nome: l.nome, cidade: l.cidade, uf: l.uf,
    especialidades: lista(l.especialidades), marcas: lista(l.marcas),
    tipo: (l.tipo || '').toLowerCase() === 'spot' ? 'spot' : 'homologado',
    atendeNoLocal: /^s/i.test(l.atende_no_local || ''), telefone: l.telefone, centros: lista(l.centros),
  }));
  salvar({ ...banco, prestadores: pr });
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
}
export function alterarPreventiva(id: string, mud: Partial<Preventiva>) {
  salvar({ ...banco, preventivas: banco.preventivas.map((x) => (x.id === id ? { ...x, ...mud } : x)) });
}
export function removerPreventiva(id: string) {
  salvar({ ...banco, preventivas: banco.preventivas.filter((x) => x.id !== id) });
}
