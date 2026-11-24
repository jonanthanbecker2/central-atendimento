// Núcleo da orientação da IA, sem dependências: o mesmo código roda
// no servidor local do Vite (npm run dev) e na função online do Supabase (Deno).
// A IA só sugere; quem decide prioridade, nível e segurança é o motor de regras.

export interface Pedido {
  queixa: string;
  relato: string;
  respostas: Record<string, string>;
  veiculo?: { marca?: string; modelo?: string; classe?: string };
  momento?: number;
  passo?: string;
  itemAtual?: string;
}

export const SISTEMA = `Você apoia, em tempo real, o operador de uma central de manutenção de caminhões de coleta de óleo lubrificante usado (OLUC).
O operador conversa por telefone com o motorista (coletor) seguindo um roteiro de seis momentos:
Ordem da ligação: 1 Acolher, depois 3 Cuidar (local seguro e como o motorista está, ANTES do relato), depois 2 Ouvir (relato), 4 Entender (árvore de perguntas da queixa), 5 Combinar, 6 Fechar.
Você recebe o momento atual, a próxima informação que a árvore pede (item_atual), o relato anotado e as marcações já feitas. O mapa de itens, as queixas e o catálogo de falhas estão no conteúdo fixo.
Seu trabalho é acompanhar o passo atual:
passo_atual diz o que está aberto na tela agora: acolher, ouvir, item (pergunta da árvore em item_atual), queixa (o operador escolhe a queixa pelo relato, sem perguntar ao motorista: preencha queixa_sugerida), frota (pedir frota e km), nivel (o operador classifica a complexidade) ou fechar.
A fala_sugerida é SEMPRE para o passo_atual, nunca para um passo seguinte.
Seja breve: frases curtas, sem explicações longas. Velocidade importa, o motorista está na linha.
- fala_sugerida: UMA frase curta e natural, em português do Brasil coloquial, que o operador pode dizer AGORA para avançar o passo atual.
  No momento 4, ela obtém o item_atual, pelos sentidos do motorista (o que vê, ouve, sente, cheira), sem nome de peça e sem induzir a resposta.
  Se o relato já respondeu o item_atual, a fala confirma com as palavras dele (exemplo: Você falou que o pedal vai mais fundo, certo?).
  Nos momentos 1, 2, 3, 5 e 6 use as falas de referência do treinamento como base, adaptadas ao que o motorista contou.
- atencao: um cuidado curto para este passo (segurança, tom, o que não dizer). Pode ser vazio.
- ja_respondidos: itens do mapa que o RELATO já responde, com a opção exata e o trecho do relato. Não repita o que já está marcado.
- falta_perguntar: até 3 próximos itens pendentes, seguindo a árvore (travas e obrigatórias primeiro).
- falhas: até 3 códigos do catálogo coerentes com o relato e as marcações.
- queixa_sugerida: id da queixa se ainda não foi escolhida e o relato indicar.
- dica: uma frase de orientação de conversa para o operador, ligada ao momento atual.
Princípios: conversa, não formulário; uma pergunta por vez; segurança primeiro; não apurar culpa; valorizar a opinião do motorista.
Você NÃO decide prioridade, nível nem orientação de segurança: isso é do motor de regras.
Use SOMENTE os ids de itens, opções e códigos fornecidos. Nunca invente código.
Entregue a resposta SEMPRE pela ferramenta registrar_orientacao. Não coloque aspas dentro dos textos.`;

// A resposta vem pela ferramenta (saída estruturada): a API entrega o objeto já montado,
// sem depender de o modelo escrever JSON à mão.
export const FERRAMENTA = {
  name: 'registrar_orientacao',
  description: 'Registra a orientação para o passo atual do atendimento.',
  input_schema: {
    type: 'object',
    properties: {
      fala_sugerida: { type: 'string' },
      atencao: { type: 'string' },
      ja_respondidos: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, valor: { type: 'string' }, trecho: { type: 'string' } }, required: ['item', 'valor', 'trecho'] } },
      falta_perguntar: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, pergunta: { type: 'string' } }, required: ['item', 'pergunta'] } },
      falhas: { type: 'array', items: { type: 'object', properties: { codigo: { type: 'string' }, motivo: { type: 'string' } }, required: ['codigo', 'motivo'] } },
      queixa_sugerida: { type: ['string', 'null'] },
      dica: { type: 'string' },
    },
    required: ['fala_sugerida', 'atencao', 'ja_respondidos', 'falta_perguntar', 'falhas', 'queixa_sugerida', 'dica'],
  },
};

/** Plano B: se por algum motivo vier texto em vez da ferramenta, lê o JSON do texto. */
function lerJsonDoTexto(texto: string): Record<string, unknown> {
  return JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
}


// Formato do conteúdo da central (arquivos de src/conteudo)
export interface Conteudo {
  itens: { id: string; queixa: string; info: string; opcoes: string[]; obrigatoria: string; tipo: string; naConversa?: boolean; perguntas?: string[]; frases?: string; cuidado?: string }[];
  catalogo: { id: string; queixa: string; sintoma: string; modos: string }[];
  queixas: { id: string; nome: string }[];
  roteiro: { n: number; nome: string; intencao: string; falas: string[]; evite: string[] }[];
}

let forcarFerramenta = true; // alguns modelos não aceitam ferramenta obrigatória: aí cai para automática

/** Monta o pedido, chama o Claude e devolve a orientação já validada. */
export async function orientar(p: Pedido, chave: string, modelo: string, c: Conteudo): Promise<{ status: number; corpo: Record<string, unknown> }> {
  if (!chave) return { status: 503, corpo: { erro: 'sem_chave' } };
  try {
    const itens = c.itens.filter((i) => (i.queixa === '*' || i.queixa === p.queixa) && i.naConversa !== false); // fumaça e vazamento não entram na conversa
    const catalogo = c.catalogo.filter((f) => !p.queixa || f.queixa === p.queixa || ['outro', 'vazamento'].includes(f.queixa));
    const passo = c.roteiro.find((r) => r.n === (p.momento ?? 2));
    const atual = c.itens.find((i) => i.id === p.itemAtual);
    // Parte fixa (mapa da queixa, catálogo, queixas): vai em cache na Anthropic e não é relida a cada pedido.
    const fixo = JSON.stringify({
      queixas: c.queixas.map((q) => ({ id: q.id, nome: q.nome })),
      itens_do_mapa: itens.map((i) => ({ id: i.id, info: i.info, obrigatoria: i.obrigatoria, opcoes: i.tipo === 'texto' ? 'texto livre' : i.opcoes })),
      catalogo: catalogo.map((f) => ({ codigo: f.id, sintoma: f.sintoma, modos: f.modos })),
    });
    const usuario = JSON.stringify({
      passo_atual: p.passo ?? null,
      momento_atual: passo ? { numero: passo.n, nome: passo.nome, intencao: passo.intencao, falas_de_referencia: passo.falas, evitar: passo.evite } : null,
      item_atual: atual ? { id: atual.id, info: atual.info, opcoes: atual.opcoes, perguntas_de_referencia: atual.perguntas, frases_do_motorista: atual.frases, cuidado: atual.cuidado } : null,
      queixa_atual: p.queixa || null,
      veiculo: p.veiculo ?? {},
      relato: String(p.relato ?? '').slice(0, 4000),
      marcacoes: p.respostas ?? {},
    });
    const inicio = Date.now();
    const chamar = () => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: modelo, max_tokens: 700,
        system: [{ type: 'text', text: SISTEMA }, { type: 'text', text: 'Conteúdo fixo da central:\n' + fixo, cache_control: { type: 'ephemeral' } }],
        tools: [FERRAMENTA],
        tool_choice: forcarFerramenta ? { type: 'tool', name: FERRAMENTA.name } : { type: 'auto' },
        messages: [{ role: 'user', content: usuario }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    let r = await chamar();
    if (r.status === 400 && forcarFerramenta) {
      const txt = await r.clone().text();
      if (txt.includes('tool_choice')) { forcarFerramenta = false; console.log('[IA] modelo não aceita ferramenta obrigatória; usando automática'); r = await chamar(); }
    }
    if (!r.ok) {
      const txt = await r.text();
      let msg = txt.slice(0, 300);
      try { msg = JSON.parse(txt).error?.message ?? msg; } catch { /* mantém o texto */ }
      console.error(`[IA] erro ${r.status}: ${msg}`);
      return { status: 502, corpo: { erro: `api_${r.status}`, detalhe: msg } };
    }
    const dados = await r.json() as { content: { type: string; text?: string; input?: Record<string, unknown> }[] };
    const uso = dados.content.find((x) => x.type === 'tool_use');
    const texto = dados.content.filter((x) => x.type === 'text').map((x) => x.text).join('');
    let json: Record<string, unknown>;
    if (uso?.input) json = uso.input;
    else {
      try { json = lerJsonDoTexto(texto); } catch {
        console.error('[IA] resposta sem o formato combinado:', texto.slice(0, 200));
        return { status: 502, corpo: { erro: 'resposta_fora_do_formato', detalhe: texto.slice(0, 120) } };
      }
    }
    const ms = Date.now() - inicio;
    console.log(`[IA] ${modelo} respondeu em ${ms} ms`);
    return { status: 200, corpo: { ...validar(json, itens, catalogo.map((f) => f.id), c.queixas.map((q) => q.id)), ms } };
  } catch (e) {
    console.error('[IA] falha:', e);
    return { status: 500, corpo: { erro: 'falha', detalhe: String(e).slice(0, 300) } };
  }
}

/** Descarta qualquer código que não exista no conteúdo (trava da IA, PRD seção 9). */
function validar(
  j: Record<string, unknown>,
  itens: { id: string; opcoes: string[]; tipo: string }[],
  falhas: string[],
  queixas: string[],
) {
  const porId = new Map(itens.map((i) => [i.id, i]));
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, string>[]) : []);
  return {
    ja_respondidos: arr(j.ja_respondidos).filter((x) => {
      const it = porId.get(x.item);
      return it && (it.tipo === 'texto' || it.opcoes.includes(x.valor));
    }).slice(0, 8),
    falta_perguntar: arr(j.falta_perguntar).filter((x) => porId.has(x.item)).slice(0, 3),
    falhas: arr(j.falhas).filter((x) => falhas.includes(x.codigo)).slice(0, 3),
    queixa_sugerida: typeof j.queixa_sugerida === 'string' && queixas.includes(j.queixa_sugerida) ? j.queixa_sugerida : null,
    dica: typeof j.dica === 'string' ? j.dica.slice(0, 300) : '',
    fala_sugerida: typeof j.fala_sugerida === 'string' ? j.fala_sugerida.slice(0, 300) : '',
    atencao: typeof j.atencao === 'string' ? j.atencao.slice(0, 300) : '',
  };
}
