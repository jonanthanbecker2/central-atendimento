// Sincronização com o Supabase (site online). Sem VITE_SUPABASE_URL, nada aqui roda:
// o protótipo local continua só no navegador.
//
// - Login individual (e-mail e senha criados pela gestão no Supabase) e perfil vindo de ca_perfis.
// - Cada protocolo alterado vai inteiro para ca_protocolos (com quem e quando, no banco).
//   O banco guarda também uma cópia de cada versão (ca_protocolos_historico).
// - A cada 10 segundos, busca o que a equipe mudou (fila compartilhada).
// - Planilhas (veículos, histórico, checklist, preventivas, prestadores) ficam em ca_cadastros.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Protocolo } from '../types';
import { aplicarDoBanco, atualizar, definirOuvinteMudancas, definirUsuario, lerBanco, limparCache, mesclarProtocolosDoBanco, type Usuario } from './store';

const URL_SUPABASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const CHAVE_PUBLICA = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
export const NUVEM = !!(URL_SUPABASE && CHAVE_PUBLICA);
export const supabase: SupabaseClient | null = NUVEM ? createClient(URL_SUPABASE, CHAVE_PUBLICA) : null;

type NomeCadastro = 'veiculos' | 'historico' | 'checklist' | 'preventivas' | 'prestadores';

// ---------------- Estado da sincronização (para o aviso no topo da tela) ----------------
export type EstadoSync = { pendentes: number; erro?: string; ultimaVez?: string };
let estado: EstadoSync = { pendentes: 0 };
const ouvintes = new Set<() => void>();
const avisar = (mud: Partial<EstadoSync>) => { estado = { ...estado, ...mud }; ouvintes.forEach((f) => f()); };
export const lerEstadoSync = () => estado;
export const assinarEstadoSync = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };

// ---------------- Login ----------------
/** Token do login atual, para a função da IA saber quem está pedindo. */
export async function tokenAtual(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function carregarPerfil(): Promise<Usuario | string> {
  const { data: u } = await supabase!.auth.getUser();
  if (!u.user) return 'Sessão expirada. Entre de novo.';
  const { data, error } = await supabase!.from('ca_perfis').select('nome, perfil, centro, ativo').eq('user_id', u.user.id).maybeSingle();
  if (error) return `Não foi possível ler o perfil: ${error.message}`;
  if (!data || !data.ativo) return 'Seu login ainda não foi liberado na central. Peça à gestão para cadastrar seu perfil.';
  return { nome: data.nome, perfil: data.perfil, centro: data.centro ?? undefined };
}

/** Entra com e-mail e senha. Devolve uma mensagem de erro, ou null se deu certo. */
export async function entrar(email: string, senha: string): Promise<string | null> {
  if (!supabase) return 'Supabase não configurado.';
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error) return error.message.includes('Invalid login') ? 'E-mail ou senha incorretos.' : error.message;
  const perfil = await carregarPerfil();
  if (typeof perfil === 'string') { await supabase.auth.signOut(); return perfil; }
  limparCache();
  definirUsuario(perfil);
  await carregarTudo();
  iniciarSincronizacao();
  return null;
}

export async function sair() {
  pararSincronizacao();
  await supabase?.auth.signOut();
  limparCache();
  definirUsuario(undefined);
}

/** Ao abrir o site: se já há login salvo, recarrega perfil e dados. */
export async function retomarSessao(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) { if (lerBanco().usuario) { limparCache(); definirUsuario(undefined); } return; }
  const perfil = await carregarPerfil();
  if (typeof perfil === 'string') { await sair(); return; }
  definirUsuario(perfil);
  await carregarTudo();
  iniciarSincronizacao();
}

// ---------------- Leitura ----------------
let cursorProtocolos = '1970-01-01T00:00:00Z';
const versaoNoBanco = new Map<string, string>(); // id → atualizado_em da última versão vista
let cursorCadastros = new Map<NomeCadastro, string>();

async function carregarTudo() {
  const u = lerBanco().usuario;
  if (!u || u.perfil === 'centro') return; // o centro só vê o painel (ca_painel_centro)
  await buscarCadastros();
  const desde = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data, error } = await supabase!.from('ca_protocolos').select('id, dados, atualizado_em')
    .or(`estado.neq.encerrado,atualizado_em.gte.${desde}`).order('atualizado_em');
  if (error) { avisar({ erro: `Falha ao ler os protocolos: ${error.message}` }); return; }
  receberProtocolos(data ?? []);
}

function receberProtocolos(linhas: { id: string; dados: Protocolo; atualizado_em: string }[]) {
  const aceitos: Protocolo[] = [];
  for (const l of linhas) {
    if (l.atualizado_em > cursorProtocolos) cursorProtocolos = l.atualizado_em;
    if (versaoNoBanco.get(l.id) === l.atualizado_em) continue; // é a nossa própria gravação
    versaoNoBanco.set(l.id, l.atualizado_em);
    if (pendentes.has(l.id)) continue; // mudança local ainda não enviada: o envio junta as duas
    aceitos.push(l.dados);
  }
  mesclarProtocolosDoBanco(aceitos);
}

async function buscarCadastros() {
  const { data, error } = await supabase!.from('ca_cadastros').select('tipo, dados, atualizado_em');
  if (error) { avisar({ erro: `Falha ao ler as planilhas: ${error.message}` }); return; }
  const parcial: Record<string, unknown> = {};
  for (const l of data ?? []) {
    const nome = l.tipo as NomeCadastro;
    if (cursorCadastros.get(nome) === l.atualizado_em || cadastrosPendentes.has(nome)) continue;
    cursorCadastros.set(nome, l.atualizado_em);
    parcial[nome] = l.dados;
  }
  if (Object.keys(parcial).length) aplicarDoBanco(parcial);
}

async function buscarMudancas() {
  const u = lerBanco().usuario;
  if (!u || u.perfil === 'centro') return;
  const { data, error } = await supabase!.from('ca_protocolos').select('id, dados, atualizado_em')
    .gt('atualizado_em', cursorProtocolos).order('atualizado_em');
  if (error) { avisar({ erro: `Sem conexão com o banco (${error.message}). As mudanças ficam guardadas e vão quando voltar.` }); return; }
  receberProtocolos(data ?? []);
  await buscarCadastros();
  avisar({ erro: undefined, ultimaVez: new Date().toISOString() });
}

/** Painel do centro de coleta: só frota, queixa, fase, prestador e previsão. */
export async function lerPainelCentro() {
  const { data, error } = await supabase!.rpc('ca_painel_centro');
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; numero: string; frota: string; centro: string | null; queixa: string | null; estado: Protocolo['estado']; prioridade: string | null; prestador_nome: string | null; previsao_liberacao: string | null; aberto_em: string }[];
}

// ---------------- Gravação ----------------
const pendentes = new Set<string>();
const cadastrosPendentes = new Set<NomeCadastro>();
let temporizador: ReturnType<typeof setTimeout> | null = null;
let enviando = false;

const contar = () => avisar({ pendentes: pendentes.size + cadastrosPendentes.size });
function agendarEnvio(ms = 1200) {
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => { void enviar(); }, ms);
}

/** Junta duas versões do mesmo protocolo: listas que só crescem são somadas, o resto fica com a local. */
function juntar(local: Protocolo, remoto: Protocolo): Protocolo {
  const unir = <T,>(a: T[] = [], b: T[] = []) => {
    const vistos = new Set(a.map((x) => JSON.stringify(x)));
    return [...a, ...b.filter((x) => !vistos.has(JSON.stringify(x)))];
  };
  const porData = <T extends { em?: string }>(l: T[]) => l.sort((x, y) => (x.em ?? '').localeCompare(y.em ?? ''));
  return {
    ...remoto, ...local,
    respostas: { ...remoto.respostas, ...local.respostas },
    eventos: porData(unir(local.eventos, remoto.eventos)),
    sugestoes: porData(unir(local.sugestoes, remoto.sugestoes)),
    validacoes: unir(local.validacoes, remoto.validacoes),
    ordens: unir(local.ordens, remoto.ordens),
    fotosVeiculo: unir(local.fotosVeiculo, remoto.fotosVeiculo),
    orientacoesIA: porData(unir(local.orientacoesIA, remoto.orientacoesIA)),
  };
}

function linhaDoProtocolo(p: Protocolo) {
  const b = lerBanco();
  const centro = b.veiculos.find((v) => v.frota === p.frota)?.centro ?? null;
  const prestador = p.prestadorId === 'spot' ? 'Spot' : b.prestadores.find((x) => x.id === p.prestadorId)?.nome ?? null;
  return {
    id: p.id, numero: p.numero, estado: p.estado, frota: p.frota || null, centro, queixa: p.queixa || null,
    prioridade: p.prioridade ?? null, prestador_nome: prestador, previsao_liberacao: p.previsaoLiberacao ?? null,
    liberado_em: p.liberadoEm ?? null, aberto_em: p.abertoEm, dados: p,
  };
}

async function enviarProtocolo(id: string): Promise<boolean> {
  let p = lerBanco().protocolos.find((x) => x.id === id);
  if (!p) return true;
  if (p.numero.startsWith('TMP-')) return false; // ainda esperando o número do banco
  // Alguém gravou depois da última versão que vimos? Junta antes de gravar.
  const { data: atual } = await supabase!.from('ca_protocolos').select('dados, atualizado_em').eq('id', id).maybeSingle();
  if (atual && atual.atualizado_em !== versaoNoBanco.get(id)) {
    p = juntar(p, atual.dados as Protocolo);
    mesclarProtocolosDoBanco([p]);
  }
  const { data, error } = await supabase!.from('ca_protocolos').upsert(linhaDoProtocolo(p)).select('atualizado_em').single();
  if (error) { avisar({ erro: `Não foi possível gravar o protocolo ${p.numero}: ${error.message}. Tento de novo em instantes.` }); return false; }
  versaoNoBanco.set(id, data.atualizado_em);
  return true;
}

async function enviar() {
  if (enviando || !supabase) return;
  enviando = true;
  try {
    for (const id of [...pendentes]) if (await enviarProtocolo(id)) pendentes.delete(id);
    for (const nome of [...cadastrosPendentes]) {
      const { data, error } = await supabase.from('ca_cadastros').upsert({ tipo: nome, dados: lerBanco()[nome] }).select('atualizado_em').single();
      if (error) { avisar({ erro: `Não foi possível gravar a planilha ${nome}: ${error.message}` }); continue; }
      cursorCadastros.set(nome, data.atualizado_em);
      cadastrosPendentes.delete(nome);
    }
    if (!pendentes.size && !cadastrosPendentes.size) avisar({ erro: undefined, ultimaVez: new Date().toISOString() });
  } finally {
    enviando = false;
    contar();
    if (pendentes.size || cadastrosPendentes.size) agendarEnvio(5000); // tenta de novo
  }
}

/** Número do protocolo vem do banco (sequência única para a equipe). */
export async function numerarProtocolo(id: string, aplicar: (numero: string) => void) {
  const { data, error } = await supabase!.rpc('ca_proximo_numero');
  if (error || !data) { avisar({ erro: `Não foi possível gerar o número do protocolo: ${error?.message ?? 'sem permissão'}` }); return; }
  aplicar(data as string);
  pendentes.add(id); contar(); agendarEnvio(200);
}

// ---------------- Ciclo ----------------
const numerando = new Set<string>();
let relogio: ReturnType<typeof setInterval> | null = null;
function iniciarSincronizacao() {
  if (!supabase) return;
  definirOuvinteMudancas((m) => {
    if (m.tipo === 'protocolo') {
      pendentes.add(m.id);
      const p = lerBanco().protocolos.find((x) => x.id === m.id);
      if (p?.numero.startsWith('TMP-') && !numerando.has(m.id)) {
        numerando.add(m.id);
        void numerarProtocolo(m.id, (numero) => atualizar(m.id, { numero }, { tipo: 'numero', detalhe: `Número definitivo ${numero}` }))
          .finally(() => numerando.delete(m.id));
      }
    } else cadastrosPendentes.add(m.nome);
    contar(); agendarEnvio();
  });
  if (!relogio) relogio = setInterval(() => { void buscarMudancas(); }, 10000);
  window.addEventListener('beforeunload', avisoAoFechar);
}
function pararSincronizacao() {
  definirOuvinteMudancas(null);
  if (relogio) clearInterval(relogio);
  relogio = null;
  pendentes.clear(); cadastrosPendentes.clear(); versaoNoBanco.clear();
  cursorProtocolos = '1970-01-01T00:00:00Z'; cursorCadastros = new Map();
  window.removeEventListener('beforeunload', avisoAoFechar);
}
function avisoAoFechar(e: BeforeUnloadEvent) { if (pendentes.size || cadastrosPendentes.size) { e.preventDefault(); } }
