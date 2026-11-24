// Sincronização com o Supabase, com um banco falso em memória (mesmo comportamento das tabelas:
// atualizado_em muda a cada gravação). Confere login, número do protocolo, gravação, leitura do que
// outra pessoa mudou e junção quando duas pessoas mexem no mesmo protocolo.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const tabelas: Record<string, Linha[]> = {
  ca_perfis: [{ user_id: 'u1', nome: 'Ana', perfil: 'N1', centro: null, ativo: true }],
  ca_protocolos: [],
  ca_cadastros: [],
};
let relogio = Date.parse('2026-11-24T10:00:00Z');
const carimbo = () => new Date((relogio += 1000)).toISOString();
let seq = 0;
let logado = false;

function consulta(tabela: string) {
  let linhas = () => tabelas[tabela];
  const filtros: ((l: Linha) => boolean)[] = [];
  let gravar: Linha | null = null;
  const q = {
    select: () => q,
    order: () => q,
    or: () => q,
    eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; },
    gt: (c: string, v: string) => { filtros.push((l) => l[c] > v); return q; },
    upsert: (l: Linha) => { gravar = l; return q; },
    executar() {
      if (gravar) {
        const chave = tabela === 'ca_cadastros' ? 'tipo' : 'id';
        const nova: Linha = { ...structuredClone(gravar as Linha), atualizado_em: carimbo() };
        tabelas[tabela] = [...tabelas[tabela].filter((x) => x[chave] !== nova[chave]), nova];
        linhas = () => [nova];
      }
      return linhas().filter((l) => filtros.every((f) => f(l))).map((l) => structuredClone(l));
    },
    maybeSingle: async () => ({ data: q.executar()[0] ?? null, error: null }),
    single: async () => ({ data: q.executar()[0], error: null }),
    then: (ok: (r: unknown) => void) => ok({ data: q.executar(), error: null }),
  };
  return q;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: consulta,
    rpc: async (nome: string) => (nome === 'ca_proximo_numero' ? { data: `CA-20261124-${String(++seq).padStart(4, '0')}`, error: null }
      : nome === 'ca_checklist_aberto' ? { data: [{ vistoria_id: 'v1', frota: '412', data: '2026-11-24T08:10:00Z', km: 100000, item: 'Pneus', resposta: 'Não', acao: 'NAO_UTILIZAR', detalhe: 'careca', situacao: 'aguardando', data_programada: null }], error: null }
      : { data: [], error: null }),
    auth: {
      signInWithPassword: async ({ password }: { password: string }) => { logado = password === 'certa'; return { error: logado ? null : { message: 'Invalid login credentials' } }; },
      getSession: async () => ({ data: { session: logado ? { access_token: 'tok' } : null } }),
      getUser: async () => ({ data: { user: logado ? { id: 'u1' } : null } }),
      signOut: async () => { logado = false; },
    },
  }),
}));

const memoria = new Map<string, string>();
beforeAll(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://sb.test');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  vi.stubGlobal('localStorage', { getItem: (k: string) => memoria.get(k) ?? null, setItem: (k: string, v: string) => memoria.set(k, v), removeItem: (k: string) => memoria.delete(k) });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('sincronização com o Supabase', async () => {
  it('fluxo completo', async () => {
    const store = await import('./store');
    const nuvem = await import('./nuvem');
    expect(nuvem.NUVEM).toBe(true);

    // Login
    expect(await nuvem.entrar('ana@x', 'errada')).toBe('E-mail ou senha incorretos.');
    expect(await nuvem.entrar('ana@x', 'certa')).toBeNull();
    expect(store.lerBanco().usuario).toEqual({ nome: 'Ana', perfil: 'N1', centro: undefined });
    // Checklist em aberto do app de vistoria chega junto com o login
    expect(store.checklistDaFrota(store.lerBanco(), '412')).toMatchObject([{ origem: 'app', item: 'Pneus', detalhe: 'careca', situacao: 'aguardando' }]);

    // Novo protocolo: número provisório, depois o do banco, e gravação inteira
    const p = store.novoProtocolo({ origem: 'telefone' });
    expect(p.numero.startsWith('TMP-')).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    const meu = store.lerBanco().protocolos.find((x) => x.id === p.id)!;
    expect(meu.numero).toBe('CA-20261124-0001');
    expect(tabelas.ca_protocolos).toHaveLength(1);
    expect(tabelas.ca_protocolos[0].numero).toBe('CA-20261124-0001');

    // Resposta, OS e orientação da IA vão para o banco
    store.atualizar(p.id, { relato: 'barulho no freio', respostas: { 'SEG-01': 'Parado em local seguro' }, orientacoesIA: [{ em: 'x', autor: 'Ana', passo: 'ouvir', momento: 2, fonte: 'claude', dica: 'd', ja_respondidos: [], falta_perguntar: [], falhas: [], queixa_sugerida: null }] });
    await vi.advanceTimersByTimeAsync(2000);
    const noBanco = tabelas.ca_protocolos[0].dados;
    expect(noBanco.relato).toBe('barulho no freio');
    expect(noBanco.orientacoesIA).toHaveLength(1);
    expect(nuvem.lerEstadoSync().pendentes).toBe(0);

    // Outra pessoa (Bruno) muda o protocolo: aparece aqui na próxima conferência
    const l = tabelas.ca_protocolos[0];
    l.dados = { ...l.dados, eventos: [...l.dados.eventos, { em: '2026-11-24T11:00:00Z', autor: 'Bruno', tipo: 'nota', detalhe: 'liguei pro prestador' }] };
    l.atualizado_em = carimbo();
    await vi.advanceTimersByTimeAsync(10500);
    expect(store.lerBanco().protocolos[0].eventos.some((e) => e.autor === 'Bruno')).toBe(true);

    // As duas mexem ao mesmo tempo: Bruno grava no banco, Ana ainda não enviou. Nada se perde.
    l.dados = { ...l.dados, respostas: { ...l.dados.respostas, 'FR-01': 'Sim' }, eventos: [...l.dados.eventos, { em: '2026-11-24T11:05:00Z', autor: 'Bruno', tipo: 'nota', detalhe: 'segunda' }] };
    l.atualizado_em = carimbo();
    store.atualizar(p.id, { respostas: { ...store.lerBanco().protocolos[0].respostas, 'SEG-02': 'Sim' } }, { tipo: 'nota', detalhe: 'da Ana' });
    await vi.advanceTimersByTimeAsync(2000);
    const final = tabelas.ca_protocolos[0].dados;
    expect(final.respostas['FR-01']).toBe('Sim');
    expect(final.respostas['SEG-02']).toBe('Sim');
    expect(final.eventos.map((e: { detalhe: string }) => e.detalhe)).toEqual(expect.arrayContaining(['segunda', 'da Ana']));

    // Planilha alterada vai para ca_cadastros
    store.importarCsv('prestadores', 'id;nome;cidade;uf;especialidades;contato\np1;Oficina X;Bauru;SP;freio;1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(tabelas.ca_cadastros.find((c) => c.tipo === 'prestadores')?.dados).toHaveLength(1);

    // Foto do veículo guardada no protocolo
    store.atualizar(p.id, { frota: '1234', km: '100000' });
    store.registrarFotoVeiculo(p.id, 'direcionado');
    await vi.advanceTimersByTimeAsync(2000);
    expect(tabelas.ca_protocolos[0].dados.fotosVeiculo[0]).toMatchObject({ frota: '1234', momento: 'direcionado', autor: 'Ana' });
    store.atualizar(p.id, { frota: '412' });
    store.registrarFotoVeiculo(p.id, 'passado_adiante');
    expect(store.lerBanco().protocolos[0].fotosVeiculo?.[1].checklist[0]).toMatchObject({ origem: 'app', item: 'Pneus' });

    // Sair apaga a cópia deste navegador
    await nuvem.sair();
    expect(store.lerBanco().protocolos).toHaveLength(0);
    expect(store.lerBanco().usuario).toBeUndefined();
  });
});
