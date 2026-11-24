import { describe, expect, it } from 'vitest';
import { triar } from './motor';
import { itensDaQueixa, saidasDaQueixa } from '../conteudo';
import type { Respostas } from '../types';

const base: Respostas = {
  'SEG-01': 'Parado em local seguro',
  'SEG-02': 'Bem',
  'SEG-03': 'Não',
  'SEG-04': 'Não',
  'SEG-05': 'Parcial',
  'COM-01': 'acho que é regulagem',
  'COM-03': 'Confirmou',
  'COM-04': 'Concorda',
};
const freio = (r: Respostas) =>
  triar(itensDaQueixa('freio'), saidasDaQueixa('freio'), { ...base, 'FR-09': 'Nenhuma', 'FR-12': 'Normal', ...r });

describe('travas', () => {
  it('sem as travas não pode concluir', () => {
    const r = triar(itensDaQueixa('freio'), saidasDaQueixa('freio'), {});
    expect(r.podeConcluir).toBe(false);
    expect(r.travasPendentes.map((i) => i.id)).toEqual(['SEG-01']); // fumaça e vazamento saem do relato, não travam
  });
  it('chama leva a S-01, P0, socorro', () => {
    const r = freio({ 'SEG-03': 'Chama' });
    expect(r.saida?.id).toBe('S-01');
    expect(r.prioridade).toBe('P0');
  });
  it('vazamento do tanque leva a S-02', () => {
    expect(freio({ 'SEG-04': 'Sim' }).saida?.id).toBe('S-02');
  });
});

describe('árvore de Freio (FS-02 a FS-12)', () => {
  const casos: [string, Respostas, string, string][] = [
    ['FS-02 fumaça na roda', { 'SEG-03': 'Fumaça ou cheiro forte' }, 'FS-02', 'P0'],
    ['FS-02 não solta', { 'FR-12': 'Não solta' }, 'FS-02', 'P0'],
    ['FS-03 luz vermelha', { 'FR-09': 'Vermelha' }, 'FS-03', 'P0'],
    ['FS-03 ar não sobe', { 'FR-10': 'Não sobe' }, 'FS-03', 'P0'],
    ['FS-04 freia sozinho', { 'FR-12': 'Freia sozinho andando' }, 'FS-04', 'P0'],
    ['FS-05 freio fraco', { 'FR-12': 'Fraco, demora para parar' }, 'FS-05', 'P0'],
    ['FS-06 estacionamento não segura', { 'FR-13': 'Não segura' }, 'FS-06', 'P0'],
    ['FS-07 cai a cada pisada', { 'FR-10': 'Cai a cada pisada' }, 'FS-07', 'P1'],
    ['FS-08 demora a encher', { 'FR-10': 'Demora muito' }, 'FS-08', 'P1'],
    ['FS-09 puxa', { 'FR-12': 'Puxa para um lado' }, 'FS-09', 'P1'],
    ['FS-10 duro', { 'FR-12': 'Duro ou pega de repente' }, 'FS-10', 'P1'],
    ['FS-11 estacionamento não solta com ar normal', { 'FR-13': 'Não solta', 'FR-10': 'Normal' }, 'FS-11', 'P1'],
    ['FS-12 ABS amarela', { 'FR-09': 'Amarela ou laranja' }, 'FS-12', 'P1'],
  ];
  for (const [nome, r, saida, prio] of casos) {
    it(nome, () => {
      const res = freio(r);
      expect(res.saida?.id).toBe(saida);
      expect(res.prioridade).toBe(prio);
      expect(res.podeConcluir).toBe(true);
    });
  }
  it('FS-07 não vale com luz vermelha (vira FS-03)', () => {
    expect(freio({ 'FR-10': 'Cai a cada pisada', 'FR-09': 'Vermelha' }).saida?.id).toBe('FS-03');
  });
});

describe('regras de escalonamento (FS-13) e da opinião (FS-14)', () => {
  it('sem encaixe com mapa completo vai ao analista', () => {
    const r = freio({});
    expect(r.saida).toBeUndefined();
    expect(r.nivel).toBe('N2');
    expect(r.paraAnalista).toBe(true);
  });
  it('dois P0 diferentes vão ao analista', () => {
    const r = freio({ 'FR-09': 'Vermelha', 'FR-13': 'Não segura' });
    expect(r.prioridade).toBe('P0');
    expect(r.nivel).toBe('N2');
  });
  it('"não sei" em obrigatória vai ao analista', () => {
    expect(freio({ 'FR-09': 'Não sei' }).nivel).toBe('N2');
  });
  it('problema repetido vai ao analista', () => {
    expect(freio({ 'FR-12': 'Puxa para um lado', 'COM-02': 'Já aconteceu' }).nivel).toBe('N2');
  });
  it('regra 1: não se sente seguro => atendimento no local, prioridade mantida', () => {
    const r = freio({ 'FR-12': 'Puxa para um lado', 'COM-04': 'Não se sente seguro para seguir' });
    expect(r.local).toBe(true);
    expect(r.prioridade).toBe('P1');
  });
  it('regra 2: opinião nunca rebaixa P0', () => {
    const r = freio({ 'FR-09': 'Vermelha', 'COM-04': 'Quer seguir apesar da orientação' });
    expect(r.prioridade).toBe('P0');
    expect(r.nivel).toBe('N2');
  });
  it('determinístico', () => {
    const a = freio({ 'FR-12': 'Puxa para um lado' });
    const b = freio({ 'FR-12': 'Puxa para um lado' });
    expect(a).toEqual(b);
  });
});

describe('outras queixas do piloto', () => {
  const t = (q: string, r: Respostas) => triar(itensDaQueixa(q), saidasDaQueixa(q), { ...base, ...r });
  it('luz de óleo => LS-01 P0', () => expect(t('luz_painel', { 'LP-01': 'Vermelha', 'LP-03': 'Pressão do óleo' }).saida?.id).toBe('LS-01'));
  it('ponteiro alto => SS-02 P0', () => expect(t('superaquecimento', { 'SA-01': 'Ponteiro alto ou luz vermelha' }).prioridade).toBe('P0'));
  it('turbo assobiando => PS-03', () => expect(t('perda_forca', { 'PF-01': 'Nenhuma', 'PF-06': 'Não', 'PF-03': 'Assobio ou sirene' }).saida?.id).toBe('PS-03'));
  it('só clique => NS-03', () => expect(t('nao_liga', { 'NL-01': 'Painel acende, só faz clique' }).saida?.id).toBe('NS-03'));
});
