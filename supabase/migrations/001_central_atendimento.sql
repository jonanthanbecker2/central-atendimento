-- Central de Atendimento da Automotiva — banco no Supabase (piloto)
-- Rode este arquivo INTEIRO uma vez no Supabase: SQL Editor → New query → colar → Run.
-- Todas as tabelas começam com "ca_" para não se misturar com as do checklist no mesmo projeto.
-- Pode rodar de novo sem perder dados (só cria o que falta e recria as regras de acesso).

-- ---------------------------------------------------------------------------
-- 1. Quem usa a central. Cada pessoa tem um login (Authentication → Users) e uma linha aqui.
-- ---------------------------------------------------------------------------
create table if not exists public.ca_perfis (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  nome      text not null,
  perfil    text not null check (perfil in ('N1', 'N2', 'N3', 'gestao', 'centro')),
  centro    text,                                   -- só para o perfil "centro"
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Perfil de quem está logado (usado pelas regras de acesso). Sem linha ou inativo = sem acesso.
create or replace function public.ca_meu_perfil() returns text
language sql stable security definer set search_path = public as $$
  select perfil from public.ca_perfis where user_id = auth.uid() and ativo
$$;

create or replace function public.ca_eh_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ca_meu_perfil() in ('N1', 'N2', 'N3', 'gestao'), false)
$$;

-- ---------------------------------------------------------------------------
-- 2. Protocolos: o atendimento inteiro (conversa, respostas, decisões, ordens de serviço,
--    histórico do veículo visto na decisão, sugestões da IA aceitas ou recusadas, eventos).
--    As colunas soltas servem para filtrar e para o painel do centro; "dados" guarda tudo.
-- ---------------------------------------------------------------------------
create sequence if not exists public.ca_protocolo_seq;

create table if not exists public.ca_protocolos (
  id              uuid primary key,
  numero          text unique not null,
  estado          text not null,
  frota           text,
  centro          text,
  queixa          text,
  prioridade      text,
  prestador_nome  text,
  previsao_liberacao timestamptz,
  liberado_em     timestamptz,
  aberto_em       timestamptz not null,
  dados           jsonb not null,
  criado_por      uuid default auth.uid() references auth.users (id),
  atualizado_por  uuid default auth.uid() references auth.users (id),
  atualizado_em   timestamptz not null default now()
);
create index if not exists ca_protocolos_atualizado on public.ca_protocolos (atualizado_em);
create index if not exists ca_protocolos_frota on public.ca_protocolos (frota);

-- Toda gravação marca quem e quando (não depende do navegador).
create or replace function public.ca_carimbo() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists ca_protocolos_carimbo on public.ca_protocolos;
create trigger ca_protocolos_carimbo before insert or update on public.ca_protocolos
  for each row execute function public.ca_carimbo();

-- Número do protocolo: CA-AAAAMMDD-0001, sem repetir entre atendentes.
create or replace function public.ca_proximo_numero() returns text
language sql volatile security definer set search_path = public as $$
  select 'CA-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.ca_protocolo_seq')::text, 4, '0')
  where public.ca_eh_equipe()
$$;

-- Cópia de cada versão gravada (nada se perde, mesmo que alguém sobrescreva depois).
create table if not exists public.ca_protocolos_historico (
  id            bigserial primary key,
  protocolo_id  uuid not null,
  gravado_em    timestamptz not null default now(),
  gravado_por   uuid,
  dados         jsonb not null
);
create index if not exists ca_hist_protocolo on public.ca_protocolos_historico (protocolo_id, gravado_em);

create or replace function public.ca_guardar_versao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ca_protocolos_historico (protocolo_id, gravado_por, dados)
  values (new.id, auth.uid(), new.dados);
  return new;
end $$;
drop trigger if exists ca_protocolos_versao on public.ca_protocolos;
create trigger ca_protocolos_versao after insert or update on public.ca_protocolos
  for each row execute function public.ca_guardar_versao();

-- ---------------------------------------------------------------------------
-- 3. Planilhas da central: veículos, revisões e manutenções, checklist em aberto,
--    preventivas programadas e prestadores. Uma linha por planilha.
-- ---------------------------------------------------------------------------
create table if not exists public.ca_cadastros (
  tipo           text primary key check (tipo in ('veiculos', 'historico', 'checklist', 'preventivas', 'prestadores')),
  dados          jsonb not null,
  atualizado_por uuid default auth.uid() references auth.users (id),
  atualizado_em  timestamptz not null default now()
);
drop trigger if exists ca_cadastros_carimbo on public.ca_cadastros;
create trigger ca_cadastros_carimbo before insert or update on public.ca_cadastros
  for each row execute function public.ca_carimbo();

-- ---------------------------------------------------------------------------
-- 4. Cada orientação da IA mostrada na tela: o que foi pedido (passo, relato, respostas)
--    e o que o Claude respondeu. Só a função da IA grava; a equipe só lê.
-- ---------------------------------------------------------------------------
create table if not exists public.ca_ia_orientacoes (
  id            bigserial primary key,
  protocolo_id  uuid,
  em            timestamptz not null default now(),
  usuario       uuid,
  passo         text,
  momento       int,
  item          text,
  modelo        text,
  ms            int,
  status        int,
  pedido        jsonb,
  resposta      jsonb
);
create index if not exists ca_ia_protocolo on public.ca_ia_orientacoes (protocolo_id, em);

-- ---------------------------------------------------------------------------
-- 5. Painel do centro de coleta: só frota, queixa, fase, prestador e previsão.
--    O centro NÃO lê o relato, o motorista nem o orçamento (PRD RF-92).
-- ---------------------------------------------------------------------------
create or replace function public.ca_painel_centro()
returns table (id uuid, numero text, frota text, centro text, queixa text, estado text, prioridade text,
               prestador_nome text, previsao_liberacao timestamptz, aberto_em timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.numero, p.frota, p.centro, p.queixa, p.estado, p.prioridade,
         p.prestador_nome, p.previsao_liberacao, p.aberto_em
  from public.ca_protocolos p
  where p.liberado_em is null and p.frota is not null
    and (public.ca_eh_equipe()
         or (public.ca_meu_perfil() = 'centro'
             and p.centro = (select centro from public.ca_perfis where user_id = auth.uid())))
$$;

-- ---------------------------------------------------------------------------
-- 6. Regras de acesso (Row Level Security). Sem login e sem perfil, nada é lido nem gravado.
-- ---------------------------------------------------------------------------
alter table public.ca_perfis enable row level security;
alter table public.ca_protocolos enable row level security;
alter table public.ca_protocolos_historico enable row level security;
alter table public.ca_cadastros enable row level security;
alter table public.ca_ia_orientacoes enable row level security;

drop policy if exists ca_perfis_ler on public.ca_perfis;
create policy ca_perfis_ler on public.ca_perfis for select to authenticated
  using (user_id = auth.uid() or public.ca_eh_equipe());
drop policy if exists ca_perfis_gestao on public.ca_perfis;
create policy ca_perfis_gestao on public.ca_perfis for all to authenticated
  using (public.ca_meu_perfil() = 'gestao') with check (public.ca_meu_perfil() = 'gestao');

drop policy if exists ca_protocolos_equipe on public.ca_protocolos;
create policy ca_protocolos_equipe on public.ca_protocolos for select to authenticated using (public.ca_eh_equipe());
drop policy if exists ca_protocolos_incluir on public.ca_protocolos;
create policy ca_protocolos_incluir on public.ca_protocolos for insert to authenticated with check (public.ca_eh_equipe());
drop policy if exists ca_protocolos_alterar on public.ca_protocolos;
create policy ca_protocolos_alterar on public.ca_protocolos for update to authenticated
  using (public.ca_eh_equipe()) with check (public.ca_eh_equipe());
drop policy if exists ca_protocolos_apagar on public.ca_protocolos;
create policy ca_protocolos_apagar on public.ca_protocolos for delete to authenticated using (public.ca_meu_perfil() = 'gestao');

drop policy if exists ca_hist_ler on public.ca_protocolos_historico;
create policy ca_hist_ler on public.ca_protocolos_historico for select to authenticated using (public.ca_eh_equipe());

drop policy if exists ca_cadastros_ler on public.ca_cadastros;
create policy ca_cadastros_ler on public.ca_cadastros for select to authenticated using (public.ca_eh_equipe());
drop policy if exists ca_cadastros_gravar on public.ca_cadastros;
create policy ca_cadastros_gravar on public.ca_cadastros for insert to authenticated with check (public.ca_eh_equipe());
drop policy if exists ca_cadastros_alterar on public.ca_cadastros;
create policy ca_cadastros_alterar on public.ca_cadastros for update to authenticated
  using (public.ca_eh_equipe()) with check (public.ca_eh_equipe());

drop policy if exists ca_ia_ler on public.ca_ia_orientacoes;
create policy ca_ia_ler on public.ca_ia_orientacoes for select to authenticated using (public.ca_eh_equipe());
-- (sem regra de gravação: só a função da IA, com a chave de serviço, grava aqui)

grant usage on sequence public.ca_protocolo_seq to authenticated;
grant execute on function public.ca_proximo_numero() to authenticated;
grant execute on function public.ca_painel_centro() to authenticated;
revoke execute on function public.ca_proximo_numero() from public, anon;
revoke execute on function public.ca_painel_centro() from public, anon;
grant execute on function public.ca_proximo_numero() to authenticated;
grant execute on function public.ca_painel_centro() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Liberar uma pessoa (rode depois de criar o login dela em Authentication → Users).
--    Troque o e-mail, o nome e o perfil (N1, N2, N3, gestao ou centro):
--
-- insert into public.ca_perfis (user_id, nome, perfil, centro)
-- select id, 'Jonanthan', 'gestao', null from auth.users where email = 'seu-email@empresa.com'
-- on conflict (user_id) do update set nome = excluded.nome, perfil = excluded.perfil, centro = excluded.centro;
-- ---------------------------------------------------------------------------
