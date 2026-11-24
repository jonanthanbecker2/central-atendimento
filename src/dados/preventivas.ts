// Situação de cada preventiva programada em relação ao km atual do caminhão.
import type { Historico, Preventiva } from '../types';

/** Faltando até este km, a preventiva aparece como "próxima" (valor inicial; calibrar com os analistas). */
export const AVISO_KM = 5000;

const num = (t?: string | number) => Number(String(t ?? '').replace(/\D/g, '')) || 0;
export const fmtKm = (n: number) => n.toLocaleString('pt-BR');

/** Km atual: o informado no atendimento ou, sem ele, o maior km do histórico da frota. */
export function kmReferencia(kmInformado: string | undefined, historico: Historico[], frota: string): number {
  return num(kmInformado) || Math.max(0, ...historico.filter((h) => h.frota === frota).map((h) => num(h.km)));
}

export type Situacao = { rotulo: string; classe: 'vencida' | 'proxima' | 'futura'; falta: number };

export function situacao(pv: Preventiva, kmAtual: number): Situacao {
  const falta = pv.kmPrevisto - kmAtual;
  if (!kmAtual) return { rotulo: 'km atual desconhecido', classe: 'futura', falta };
  if (falta <= 0) return { rotulo: `vencida há ${fmtKm(-falta)} km`, classe: 'vencida', falta };
  if (falta <= AVISO_KM) return { rotulo: `faltam ${fmtKm(falta)} km`, classe: 'proxima', falta };
  return { rotulo: `faltam ${fmtKm(falta)} km`, classe: 'futura', falta };
}

/** Preventivas em aberto da frota, da mais urgente para a mais distante. */
export const emAberto = (lista: Preventiva[], frota: string) =>
  lista.filter((x) => x.frota === frota && !x.executadaEm).sort((a, b) => a.kmPrevisto - b.kmPrevisto);
