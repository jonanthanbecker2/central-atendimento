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
//   ORIGENS_PERMITIDAS     endereço do site, ex.: https://usuario.github.io (opcional, recomendado)
//   ANTHROPIC_MODEL_RAPIDO modelo das sugestões (opcional; padrão claude-haiku-5-5)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos no Supabase.
// Acesso: só quem entrou no site com login individual e tem perfil ativo N1, N2, N3 ou gestão.
// Cada orientação (pedido e resposta) é gravada em ca_ia_orientacoes.
const CHAVE = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODELO = Deno.env.get('ANTHROPIC_MODEL_RAPIDO') || 'claude-haiku-5-5';
const ORIGENS = (Deno.env.get('ORIGENS_PERMITIDAS') ?? '').split(',').map((s) => s.trim().replace(/\\/$/, '')).filter(Boolean);
const SB_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\\/$/, '');
const SB_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PERFIS_IA = ['N1', 'N2', 'N3', 'gestao'];
const LIMITE_POR_MINUTO = 120; // proteção contra uso em excesso (por instância da função)
let janela = { inicio: Date.now(), total: 0 };

// Quem está pedindo: confere o login no Supabase e o perfil em ca_perfis (guardado por 5 minutos).
type Quem = { id: string; nome: string; perfil: string };
const conhecidos = new Map<string, { quem: Quem | null; ate: number }>();
async function quemPede(req: Request): Promise<Quem | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\\s+/i, '');
  if (!token || !SB_URL || !SB_SERVICO) return null;
  const guardado = conhecidos.get(token);
  if (guardado && guardado.ate > Date.now()) return guardado.quem;
  let quem: Quem | null = null;
  try {
    const u = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_SERVICO, authorization: 'Bearer ' + token } });
    if (u.ok) {
      const id = (await u.json()).id as string;
      const r = await fetch(SB_URL + '/rest/v1/ca_perfis?select=nome,perfil,ativo&user_id=eq.' + encodeURIComponent(id), { headers: { apikey: SB_SERVICO, authorization: 'Bearer ' + SB_SERVICO } });
      const linha = r.ok ? (await r.json())[0] : undefined;
      if (linha?.ativo && PERFIS_IA.includes(linha.perfil)) quem = { id, nome: linha.nome, perfil: linha.perfil };
    }
  } catch { /* sem resposta do Supabase: trata como sem acesso */ }
  if (conhecidos.size > 500) conhecidos.clear();
  conhecidos.set(token, { quem, ate: Date.now() + 5 * 60_000 });
  return quem;
}

// Grava a orientação no banco. Falha na gravação não impede a resposta ao atendente.
async function registrar(quem: Quem, p: Pedido & { protocoloId?: string }, status: number, corpo: Record<string, unknown>, ms: number) {
  try {
    const uuid = /^[0-9a-f-]{36}$/i.test(p.protocoloId ?? '') ? p.protocoloId : null;
    const r = await fetch(SB_URL + '/rest/v1/ca_ia_orientacoes', {
      method: 'POST',
      headers: { apikey: SB_SERVICO, authorization: 'Bearer ' + SB_SERVICO, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ protocolo_id: uuid, usuario: quem.id, passo: p.passo ?? null, momento: p.momento ?? null, item: p.itemAtual ?? null, modelo: MODELO, ms, status, pedido: p, resposta: corpo }),
    });
    if (!r.ok) console.error('ca_ia_orientacoes', r.status, await r.text());
  } catch (e) { console.error('ca_ia_orientacoes', e); }
}

Deno.serve(async (req: Request) => {
  const origem = req.headers.get('origin') ?? '';
  const origemOk = !ORIGENS.length || ORIGENS.includes(origem);
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': origemOk && origem ? origem : ORIGENS[0] ?? '*',
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
  const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!origemOk) return resposta(403, { erro: 'origem_nao_permitida' });
  const quem = await quemPede(req);
  if (!quem) return resposta(401, { erro: 'sem_login' });
  if (req.method === 'GET') return resposta(200, { ativa: !!CHAVE, modelo: MODELO });
  if (req.method !== 'POST') return resposta(405, { erro: 'metodo' });
  if (Date.now() - janela.inicio > 60_000) janela = { inicio: Date.now(), total: 0 };
  if (++janela.total > LIMITE_POR_MINUTO) return resposta(429, { erro: 'limite_minuto' });
  const texto = await req.text();
  if (texto.length > 30_000) return resposta(413, { erro: 'pedido_grande' });
  let p: Pedido & { protocoloId?: string };
  try { p = JSON.parse(texto); } catch { return resposta(400, { erro: 'pedido_invalido' }); }
  const inicio = Date.now();
  const r = await orientar(p, CHAVE, MODELO, CONTEUDO);
  const gravar = registrar(quem, p, r.status, r.corpo, Date.now() - inicio);
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(gravar); else await gravar;
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
