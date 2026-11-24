// Cliente da IA na tela. Se não houver chave (ou falhar), cai para a orientação pelas regras,
// e a tela avisa que a IA está desligada.
import type { ItemArvore, Respostas } from '../types';
import { roteiro } from '../conteudo';

export interface RespostaIA {
  fonte: 'claude' | 'regras';
  aviso?: string;
  ja_respondidos: { item: string; valor: string; trecho: string }[];
  falta_perguntar: { item: string; pergunta: string }[];
  falhas: { codigo: string; motivo: string }[];
  queixa_sugerida: string | null;
  dica: string;
  fala_sugerida?: string;
  atencao?: string;
  ms?: number; // tempo de resposta do Claude
}

// Onde a IA roda:
// - protótipo local (npm run dev): rota /api/ia do servidor do Vite, chave no .env;
// - site online: função do Supabase, endereço em VITE_IA_URL (definido na publicação),
//   protegida por um código de acesso que cada atendente informa uma vez neste navegador.
export const IA_URL = (import.meta.env.VITE_IA_URL as string | undefined)?.trim() || '';
export const IA_ONLINE = !!IA_URL;
const CHAVE_CODIGO = 'central-atendimento:codigo-ia';
export const codigoIA = () => { try { return localStorage.getItem(CHAVE_CODIGO) ?? ''; } catch { return ''; } };
export function definirCodigoIA(codigo: string) {
  try { localStorage.setItem(CHAVE_CODIGO, codigo.trim()); } catch { /* sem armazenamento */ }
  status = null; // confere de novo com o código novo
}
const cabecalhos = (): Record<string, string> => ({ 'content-type': 'application/json', ...(IA_ONLINE ? { 'x-codigo-acesso': codigoIA() } : {}) });

export type StatusIA = { ativa: boolean; modelo?: string; motivo?: 'sem_chave' | 'sem_codigo' | 'codigo_errado' | 'sem_servidor' };
let status: Promise<StatusIA> | null = null;
export function statusIA(): Promise<StatusIA> {
  if (IA_ONLINE && !codigoIA()) return Promise.resolve({ ativa: false, motivo: 'sem_codigo' });
  status ??= fetch(IA_ONLINE ? IA_URL : '/api/ia/status', { headers: cabecalhos() })
    .then(async (r): Promise<StatusIA> => {
      if (r.status === 401) return { ativa: false, motivo: 'codigo_errado' };
      if (!r.ok) return { ativa: false, motivo: 'sem_servidor' };
      const j = await r.json();
      return j.ativa ? j : { ...j, motivo: 'sem_chave' };
    })
    .catch(() => ({ ativa: false, motivo: 'sem_servidor' }));
  return status;
}

/** Frase para o painel quando a IA não está disponível. */
export function avisoIADesligada(st: StatusIA): string {
  switch (st.motivo) {
    case 'sem_codigo': return 'IA desligada: informe o código de acesso da IA em “Planilhas e dados”. Orientação pelas regras.';
    case 'codigo_errado': return 'IA desligada: o código de acesso da IA está incorreto (confira em “Planilhas e dados”). Orientação pelas regras.';
    case 'sem_servidor': return IA_ONLINE ? 'IA fora do ar (sem resposta do servidor). Orientação pelas regras.' : 'IA desligada (servidor local sem resposta). Orientação pelas regras.';
    default: return IA_ONLINE ? 'IA desligada (servidor sem a chave da Anthropic). Orientação pelas regras.' : 'IA desligada (sem chave no arquivo .env). Orientação pelas regras.';
  }
}

/** Orientação sem IA: segue o roteiro do treinamento e a próxima informação da árvore. */
export function orientacaoPorRegras(itens: ItemArvore[], r: Respostas, momento: number, itemAtual: ItemArvore | undefined, falhas: string[]): RespostaIA {
  const m = roteiro[momento - 1];
  const pend = (i: ItemArvore) => !(r[i.id] ?? '').trim();
  const proximas = [
    ...itens.filter((i) => i.obrigatoria === 'trava' && pend(i)),
    ...itens.filter((i) => i.obrigatoria === 'sim' && pend(i) && i.momento === momento),
  ].filter((i) => i.id !== itemAtual?.id);
  return {
    fonte: 'regras',
    fala_sugerida: itemAtual?.perguntas[0] ?? m.falas[0],
    atencao: itemAtual?.cuidado || `Evite: ${m.evite[0]}`,
    ja_respondidos: [],
    falta_perguntar: proximas.slice(0, 3).map((i) => ({ item: i.id, pergunta: i.perguntas[0] ?? i.info })),
    falhas: falhas.slice(0, 3).map((c) => ({ codigo: c, motivo: 'Indicada pelas regras da saída' })),
    queixa_sugerida: null,
    dica: m.intencao,
  };
}

export async function pedirIA(p: { queixa: string; relato: string; respostas: Respostas; momento: number; passo?: string; itemAtual?: string; veiculo?: object }, signal?: AbortSignal): Promise<RespostaIA | { erro: string } | null> {
  try {
    const r = await fetch(IA_ONLINE ? IA_URL : '/api/ia', { method: 'POST', headers: cabecalhos(), body: JSON.stringify(p), signal });
    const j = await r.json();
    if (!r.ok) return { erro: explicar(j.erro ?? `erro ${r.status}`, j.detalhe ?? '') };
    return { fonte: 'claude', ...j };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null; // pedido antigo cancelado: a conversa já andou
    return { erro: IA_ONLINE ? 'servidor da IA sem resposta' : 'sem_servidor' };
  }
}

/** Traduz o erro da API para o operador entender o que fazer. */
function explicar(codigo: string, detalhe: string): string {
  const d = detalhe.toLowerCase();
  if (d.includes('credit balance')) return 'sem saldo na conta da API — adicione créditos em Billing no Console da Anthropic';
  if (codigo === 'codigo_acesso') return 'código de acesso da IA incorreto — confira em “Planilhas e dados”';
  if (codigo === 'origem_nao_permitida') return 'este endereço do site não está liberado na função da IA (ORIGENS_PERMITIDAS)';
  if (codigo === 'limite_minuto') return 'muitos pedidos à IA neste minuto — espere um pouco';
  if (codigo === 'api_401') return IA_ONLINE ? 'chave da Anthropic inválida no servidor — confira o segredo ANTHROPIC_API_KEY no Supabase' : 'chave inválida — confira se a chave foi colada inteira no arquivo .env';
  if (codigo === 'api_404' || d.includes('not_found') || d.includes('model:')) return `modelo não encontrado — confira ANTHROPIC_MODEL no .env (${detalhe})`;
  if (codigo === 'resposta_fora_do_formato') return 'o Claude respondeu fora do formato combinado; a próxima resposta tenta de novo';
  if (codigo === 'api_429') return 'limite de uso atingido — espere um minuto';
  if (codigo === 'api_529' || codigo === 'api_503') return 'serviço da Anthropic sobrecarregado — tente de novo';
  return detalhe ? `${codigo}: ${detalhe}` : codigo;
}
