-- =====================================================================
-- Central de Atendimento — 002: checklist em aberto vindo do app de vistoria (Vistoria por Voz).
-- Rodar no SQL Editor DEPOIS do 001 desta central e dos scripts 001 a 004 do app de vistoria
-- (mesmo projeto do Supabase). Pode rodar de novo sem estragar nada.
--
-- O que entra como "em aberto" para a central:
--   1. itens de vistoria que subiram para o painel da vistoria e ainda não foram atendidos;
--   2. itens atendidos com manutenção PROGRAMADA que ainda não foi confirmada como executada.
-- Só leitura: a central não altera nada do app de vistoria. O nome do motorista não vem (LGPD).
-- =====================================================================

create or replace function public.ca_checklist_aberto()
returns table (
  vistoria_id     text,
  frota           text,
  data            timestamptz,
  km              integer,
  item_id         text,
  item            text,
  resposta        text,
  nivel           text,
  acao            text,
  detalhe         text,
  situacao        text,   -- 'aguardando' (sem atendimento) ou 'programada'
  data_programada date
)
language sql stable security definer set search_path = public as $$
  select c.vistoria_id, c.frota, c.hora_fim, c.quilometragem,
         i->>'item_id', i->>'item', i->>'resposta', i->>'nivel', i->>'acao', i->>'detalhe',
         case when a.id is null then 'aguardando' else 'programada' end,
         a.data_programada
  from public.vistorias_central c
  left join public.atendimentos a on a.vistoria_id = c.vistoria_id
  cross join lateral jsonb_array_elements(c.itens) i
  where public.ca_eh_equipe()
    and c.frota is not null
    and (a.id is null
         or (a.situacao = 'programada'
             and not exists (select 1 from public.conclusoes_programadas k where k.atendimento_id = a.id)))
  order by c.frota, c.hora_fim desc;
$$;

revoke all on function public.ca_checklist_aberto() from public, anon;
grant execute on function public.ca_checklist_aberto() to authenticated;
