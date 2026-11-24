// Progresso do roteiro da ligação (seis momentos do treinamento).
// O bloco atual é o primeiro ainda não concluído; dentro dele, a próxima informação segue a árvore:
// travas primeiro, depois obrigatórias, depois as demais (que podem ser puladas).
import type { ItemArvore, Protocolo } from '../types';
import type { ResultadoTriagem } from './motor';

const resp = (p: Protocolo, id: string) => (p.respostas[id] ?? '').trim() !== '';
const passo = (p: Protocolo, k: string) => !!p.passos?.[k];

export function pendentes(p: Protocolo, itens: ItemArvore[], momento: number): ItemArvore[] {
  const ordem = { trava: 0, sim: 1, nao: 2 } as const;
  return itens
    .filter((i) => i.momento === momento && i.naConversa !== false && !resp(p, i.id) && !passo(p, `pulou:${i.id}`))
    .sort((a, b) => ordem[a.obrigatoria] - ordem[b.obrigatoria]);
}

export interface Progresso {
  concluido: boolean[]; // índice 1..6
  atual: number; // primeiro bloco não concluído (7 = tudo concluído)
}

export function progresso(p: Protocolo, itens: ItemArvore[], res: ResultadoTriagem): Progresso {
  const obrigPend = (m: number) => itens.some((i) => i.momento === m && i.obrigatoria !== 'nao' && !resp(p, i.id));
  const c: boolean[] = [];
  c[1] = passo(p, 'acolher');
  c[2] = passo(p, 'ouvir') && p.relato.trim() !== '';
  c[3] = !obrigPend(3);
  c[4] = !!p.queixa && !!p.frota && !!p.km && !obrigPend(4) && (!!res.saida || res.paraAnalista || passo(p, 'entender'));
  c[5] = !obrigPend(5);
  c[6] = !['na_fila', 'em_triagem', 'com_analista'].includes(p.estado);
  let atual = 1;
  while (atual <= 6 && c[atual]) atual++;
  return { concluido: c, atual };
}
