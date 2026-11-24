import type { Estado, Prioridade, Protocolo } from './types';

export const fmtData = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtDia = (d?: string) => (d ? d.split('-').reverse().join('/') : '—');

export const ESTADOS: Record<Estado, string> = {
  na_fila: 'Na fila',
  em_triagem: 'Em triagem',
  com_analista: 'Com o analista',
  direcionado: 'Direcionado ao prestador',
  aguarda_orcamento: 'Aguarda orçamento',
  em_validacao: 'Em validação',
  encerrado: 'Encerrado',
};

/** Fase em linguagem simples, para o painel do centro de coleta. */
export const FASE_CENTRO: Record<Estado, string> = {
  na_fila: 'Aguardando atendimento da central',
  em_triagem: 'Em atendimento na central',
  com_analista: 'Em análise técnica',
  direcionado: 'Prestador acionado',
  aguarda_orcamento: 'No prestador (diagnóstico)',
  em_validacao: 'Orçamento em validação',
  encerrado: 'Reparo aprovado',
};

export function Prio({ p }: { p?: Prioridade }) {
  if (!p) return <span className="badge cinza">sem prioridade</span>;
  return <span className={`badge ${p.toLowerCase()}`}>{p}</span>;
}

export const ordemFila = (a: Protocolo, b: Protocolo) => {
  const o = { P0: 0, P1: 1, P2: 2 } as Record<string, number>;
  return (o[a.prioridade ?? ''] ?? 3) - (o[b.prioridade ?? ''] ?? 3) || a.abertoEm.localeCompare(b.abertoEm);
};

export const ir = (rota: string) => { window.location.hash = rota; };

/** Próximo retorno ainda não feito. */
export const retornoPendente = (p: Protocolo) => p.retornos.find((r) => !r.feitoEm);
