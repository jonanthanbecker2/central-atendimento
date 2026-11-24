// Motor de triagem — regras fixas, sem IA.
// Mesmas respostas => mesmo resultado. Cada resultado traz os motivos (rastreabilidade).
// Ordem (PRD RF-20): travas -> saídas da queixa (P0 primeiro) -> regras da opinião -> fallback N2.
import type { Condicao, ItemArvore, Nivel, Prioridade, Respostas, Saida } from '../types';

export interface ResultadoTriagem {
  travasPendentes: ItemArvore[];
  obrigatoriasPendentes: ItemArvore[];
  podeConcluir: boolean; // travas e obrigatórias respondidas
  saidasAtivas: Saida[]; // todas as que casaram, P0 primeiro
  saida?: Saida; // principal
  prioridade?: Prioridade;
  nivel?: Nivel;
  falhas: string[];
  especialidade?: string;
  local: boolean;
  orientacao?: string;
  fechamento?: string;
  paraAnalista: boolean;
  motivos: string[];
}

const ORDEM_P: Record<Prioridade, number> = { P0: 0, P1: 1, P2: 2 };
const ORDEM_N: Record<Nivel, number> = { N1: 1, N2: 2, N3: 3 };
const NAO_SEI = /^n[ãa]o sei/i;

export function avaliaCondicao(c: Condicao, r: Respostas): boolean {
  if ('item' in c) return r[c.item] !== undefined && c.in.includes(r[c.item]);
  if ('any' in c) return c.any.some((x) => avaliaCondicao(x, r));
  if ('all' in c) return c.all.every((x) => avaliaCondicao(x, r));
  return !avaliaCondicao(c.not, r);
}

const respondido = (r: Respostas, id: string) => (r[id] ?? '').trim() !== '';

export function triar(itens: ItemArvore[], saidas: Saida[], r: Respostas): ResultadoTriagem {
  const motivos: string[] = [];
  const travasPendentes = itens.filter((i) => i.obrigatoria === 'trava' && !respondido(r, i.id));
  const obrigatoriasPendentes = itens.filter((i) => i.obrigatoria === 'sim' && !respondido(r, i.id));

  const saidasAtivas = saidas
    .filter((s) => avaliaCondicao(s.condicao, r))
    .sort((a, b) => ORDEM_P[a.prioridade] - ORDEM_P[b.prioridade] || ORDEM_N[b.nivel] - ORDEM_N[a.nivel]);

  const res: ResultadoTriagem = {
    travasPendentes,
    obrigatoriasPendentes,
    podeConcluir: travasPendentes.length === 0 && obrigatoriasPendentes.length === 0,
    saidasAtivas,
    falhas: [],
    local: false,
    paraAnalista: false,
    motivos,
  };

  const principal = saidasAtivas[0];
  if (principal) {
    res.saida = principal;
    res.prioridade = principal.prioridade;
    res.nivel = principal.nivel;
    res.especialidade = principal.especialidade;
    res.local = principal.local;
    res.orientacao = principal.orientacao;
    res.fechamento = principal.fechamento;
    motivos.push(`${principal.id}: ${principal.quando} → ${principal.prioridade}, ${principal.nivel}`);
    // Falhas de todas as saídas ativas, sem repetir
    res.falhas = [...new Set(saidasAtivas.flatMap((s) => s.falhas))];
    for (const s of saidasAtivas.slice(1)) motivos.push(`Também casou ${s.id}: ${s.quando} (${s.prioridade})`);
  }

  const escala = (n: Nivel, motivo: string) => {
    if (!res.nivel || ORDEM_N[n] > ORDEM_N[res.nivel]) res.nivel = n;
    res.paraAnalista = true;
    motivos.push(motivo);
  };

  // Mais de um sintoma grave (P0 de saídas diferentes)
  if (saidasAtivas.filter((s) => s.prioridade === 'P0').length > 1)
    escala('N2', 'Mais de um sintoma grave (P0) → analista');

  // "Não sei" em informação obrigatória
  const naoSeiObrig = itens.filter((i) => i.obrigatoria !== 'nao' && NAO_SEI.test(r[i.id] ?? ''));
  if (naoSeiObrig.length) escala('N2', `"Não sei" em informação obrigatória (${naoSeiObrig.map((i) => i.id).join(', ')}) → analista`);

  // Problema repetido
  if (r['COM-02'] === 'Já aconteceu') escala('N2', 'Problema repetido → analista olha a causa, não só o sintoma');

  // Regra 1: não se sente seguro => não segue (atendimento no local)
  if (r['COM-04'] === 'Não se sente seguro para seguir') {
    res.local = true;
    res.orientacao = 'Não seguir; aguardar o atendimento no local';
    res.fechamento = 'Sem problema, você fica aí e eu mando o mecânico até você. Te ligo às [hora] para dizer como está.';
    motivos.push('Regra 1: o motorista não se sente seguro → atendimento no local');
  }
  // Regra 2: a opinião não rebaixa P0
  if (r['COM-04'] === 'Quer seguir apesar da orientação' && res.prioridade === 'P0')
    escala('N2', 'Regra 2: quer seguir com P0 → mantém P0 e passa ao analista');

  // Sem saída: se o mapa está completo, vai ao analista
  if (!principal && res.podeConcluir) {
    res.prioridade = 'P1';
    escala('N2', 'Respostas não se encaixam em nenhuma saída → analista (P1 provisória)');
    res.especialidade = 'Definida pelo analista';
    res.orientacao = 'Aguardar orientação do analista';
    res.fechamento = 'Vou passar seu caso ao analista para ele ver com mais detalhe. Te retorno às [hora].';
  }

  return res;
}
