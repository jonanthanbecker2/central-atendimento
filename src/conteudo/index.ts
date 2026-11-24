// Conteúdo da triagem (catálogo, queixas, árvores e saídas).
// Gerado a partir da planilha "Base de falhas da triagem". Todo o conteúdo está em RASCUNHO
// até a validação dos analistas. Os analistas editam estes JSON; o código não muda.
import catalogoJson from './catalogo.json';
import itensJson from './arvore_itens.json';
import saidasJson from './arvore_saidas.json';
import queixasJson from './queixas.json';
import type { Falha, ItemArvore, Queixa, Saida } from '../types';

export const VERSAO_REGRAS = 'conteudo-2026-11-21-rascunho';

export const catalogo = catalogoJson as Falha[];
export const itens = itensJson as ItemArvore[];
export const saidas = saidasJson as Saida[];
export const queixas = queixasJson as Queixa[];

export const falhaPorId = (id: string) => catalogo.find((f) => f.id === id);
export const queixaPorId = (id: string) => queixas.find((q) => q.id === id);

/** Itens do mapa de uma queixa: bloco comum + itens próprios, na ordem dos momentos. */
export function itensDaQueixa(queixa: string): ItemArvore[] {
  return itens
    .filter((i) => i.queixa === '*' || i.queixa === queixa)
    .sort((a, b) => a.momento - b.momento);
}

export function saidasDaQueixa(queixa: string): Saida[] {
  return saidas.filter((s) => s.queixa === '*' || s.queixa === queixa);
}

export const temArvore = (queixa: string) => itens.some((i) => i.queixa === queixa);

import roteiroJson from './roteiro.json';
export interface PassoRoteiro { n: number; nome: string; intencao: string; falas: string[]; evite: string[]; conclui: string }
export const roteiro = roteiroJson as PassoRoteiro[];
