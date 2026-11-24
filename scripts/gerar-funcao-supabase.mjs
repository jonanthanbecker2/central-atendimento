// Gera supabase/functions/ia/index.ts: UM arquivo só, para colar no painel do Supabase
// (Edge Functions → Deploy a new function → Via Editor) ou publicar pela linha de comando.
// Junta o núcleo da IA (servidor/nucleo.ts) com o conteúdo da central (src/conteudo/*.json).
// Rode de novo sempre que mudar o núcleo ou o conteúdo:  npm run funcao
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const json = (f) => JSON.parse(ler(`src/conteudo/${f}`));
const enxuto = (lista, campos) => lista.map((x) => Object.fromEntries(campos.filter((c) => x[c] !== undefined).map((c) => [c, x[c]])));

const conteudo = {
  itens: enxuto(json('arvore_itens.json'), ['id', 'queixa', 'info', 'opcoes', 'obrigatoria', 'tipo', 'naConversa', 'perguntas', 'frases', 'cuidado']),
  catalogo: enxuto(json('catalogo.json'), ['id', 'queixa', 'sintoma', 'modos']),
  queixas: enxuto(json('queixas.json'), ['id', 'nome']),
  roteiro: enxuto(json('roteiro.json'), ['n', 'nome', 'intencao', 'falas', 'evite']),
};

const nucleo = ler('servidor/nucleo.ts');

const entrada = `
// ---------------- Entrada da função online (Supabase Edge Function, Deno) ----------------
// Segredos (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY      chave da API da Anthropic (obrigatória; nunca vai para o navegador)
//   CODIGO_ACESSO          código que os atendentes informam no site (obrigatório)
//   ORIGENS_PERMITIDAS     endereço do site, ex.: https://usuario.github.io (opcional, recomendado)
//   ANTHROPIC_MODEL_RAPIDO modelo das sugestões (opcional; padrão claude-haiku-5-5)
const CHAVE = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODELO = Deno.env.get('ANTHROPIC_MODEL_RAPIDO') || 'claude-haiku-5-5';
const CODIGO = Deno.env.get('CODIGO_ACESSO') ?? '';
const ORIGENS = (Deno.env.get('ORIGENS_PERMITIDAS') ?? '').split(',').map((s) => s.trim().replace(/\\/$/, '')).filter(Boolean);
const LIMITE_POR_MINUTO = 120; // proteção contra uso em excesso (por instância da função)
let janela = { inicio: Date.now(), total: 0 };

Deno.serve(async (req: Request) => {
  const origem = req.headers.get('origin') ?? '';
  const origemOk = !ORIGENS.length || ORIGENS.includes(origem);
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': origemOk && origem ? origem : ORIGENS[0] ?? '*',
    'Access-Control-Allow-Headers': 'content-type, x-codigo-acesso, authorization, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
  const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!origemOk) return resposta(403, { erro: 'origem_nao_permitida' });
  if (!CODIGO || req.headers.get('x-codigo-acesso') !== CODIGO) return resposta(401, { erro: 'codigo_acesso' });
  if (req.method === 'GET') return resposta(200, { ativa: !!CHAVE, modelo: MODELO });
  if (req.method !== 'POST') return resposta(405, { erro: 'metodo' });

  if (Date.now() - janela.inicio > 60_000) janela = { inicio: Date.now(), total: 0 };
  if (++janela.total > LIMITE_POR_MINUTO) return resposta(429, { erro: 'limite_minuto' });

  const texto = await req.text();
  if (texto.length > 30_000) return resposta(413, { erro: 'pedido_grande' });
  let p: Pedido;
  try { p = JSON.parse(texto); } catch { return resposta(400, { erro: 'pedido_invalido' }); }
  const r = await orientar(p, CHAVE, MODELO, CONTEUDO);
  return resposta(r.status, r.corpo);
});
`;

const saida = `// ARQUIVO GERADO por scripts/gerar-funcao-supabase.mjs em ${new Date().toISOString().slice(0, 10)}. Não edite à mão:
// mude servidor/nucleo.ts ou src/conteudo/*.json e rode "npm run funcao".
// Função "ia" da Central de Atendimento: recebe o passo da conversa e devolve a orientação do Claude.

const CONTEUDO: Conteudo = ${JSON.stringify(conteudo)};

${nucleo}
${entrada}`;

mkdirSync(new URL('../supabase/functions/ia/', import.meta.url), { recursive: true });
writeFileSync(new URL('../supabase/functions/ia/index.ts', import.meta.url), saida);
console.log(`supabase/functions/ia/index.ts gerado (${(saida.length / 1024).toFixed(0)} KB)`);
