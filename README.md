# Central de Atendimento da Automotiva — protótipo

Protótipo da central de triagem. Roda neste computador (`npm run dev`) ou publicado como site (GitHub Pages) com a IA numa função do Supabase. Depois de validado, vai para a TI avaliar e publicar no servidor da empresa.

## O que já faz (versão 0.1)

- **Fila única** com as três entradas (telefone, WhatsApp, checklist), ordenada por prioridade e hora.
- **Tela de atendimento em três áreas:**
  - direita: a conversa com o motorista em estilo chat, um passo por vez (acolher → local seguro e bem-estar → relato → entender → combinar → nível → fechar);
  - direita embaixo: última revisão, última manutenção, checklist e preventivas em aberto da frota;
  - esquerda: orientação da IA (Claude) para o passo aberto e resultado das regras (prioridade, nível, saída).
- **Ordens de serviço** por tipo (corretiva, preventiva, preditiva, reforma, sinistro), várias por parada, geradas para imprimir, salvar em PDF ou enviar pelo WhatsApp.
- **Cadastro de preventivas programadas** (frota, tipo de revisão, km).
- **Motor de regras** com as travas de segurança e as regras da opinião do motorista (testado).
- **Árvores das 5 queixas do piloto:** freio, luz no painel, superaquecimento, perda de força e não liga — **todas em rascunho, para os analistas validarem**.
- Escolha do prestador, **retorno com hora marcada** (alerta na fila), passagem ao analista com resumo pronto.
- **Segunda avaliação:** orçamento técnico e causa confirmada (obrigatória para encerrar).
- **Painel do centro de coleta:** caminhões parados, fase e previsão de liberação (só leitura).
- **Planilhas:** veículos, revisões e manutenções, checklist em aberto e prestadores, importadas de CSV.

No protótipo, os dados ficam guardados no navegador deste computador. Use “Baixar cópia de segurança” em *Planilhas e dados* para não perder os testes.

## Como abrir (primeira vez)

1. Instale o **Node.js LTS** (https://nodejs.org) — próximo, próximo, concluir.
2. Abra a pasta `central-atendimento` no VS Code.
3. Abra o terminal do VS Code (**Terminal → Novo Terminal**) e rode:
   ```
   npm install
   ```
4. (Opcional, para ligar a IA) copie `.env.example` para `.env` e cole a chave da API do Claude em `ANTHROPIC_API_KEY`.
5. Rode:
   ```
   npm run dev
   ```
   O navegador abre em `http://localhost:5173`. Para parar: `Ctrl + C` no terminal.

Da segunda vez em diante, só o passo 5.

## Primeiro teste

1. Entre com seu nome e o perfil **Assistente (N1)**.
2. Em **Planilhas e dados**, clique em **Carregar exemplos fictícios**.
3. Na **Fila**, abra um protocolo por telefone e atenda a frota **412**, freio fraco.
4. Abra o **Painel do centro** em outra aba para ver o caminhão parado atualizar sozinho.

## Planilhas

Os modelos estão em `public/modelos/` (dados fictícios). No Excel, salve como **CSV (separado por ponto e vírgula)** e importe em *Planilhas e dados*.

## Para quem programa

- `src/motor/` — motor de triagem puro + testes (`npm test`).
- `src/conteudo/` — catálogo, queixas, árvores e saídas em JSON (conteúdo dos analistas, separado do código).
- `src/telas/` — telas. `src/dados/store.ts` — armazenamento do protótipo (trocar pelo banco na versão do servidor).
- `servidor/nucleo.ts` — núcleo da IA (monta o pedido, chama o Claude, descarta códigos inexistentes). Usado pelo servidor local (`servidor/ia.ts`, chave no `.env`) e pela função online (`supabase/functions/ia/index.ts`, gerada por `npm run funcao`).
- A IA só sugere; prioridade, nível e travas são do motor de regras.

## Publicar online (banco, login e IA)

O site fica no GitHub Pages. O Supabase guarda os dados da equipe, faz o login de cada pessoa e roda a função da IA, que guarda a chave da Anthropic (a chave nunca vai para o site).

**O que fica gravado no banco:** o protocolo inteiro — respostas do motorista bloco a bloco, relato, classificação de nível, ordens de serviço com todas as versões, eventos com autor e hora, orientação que o painel da IA mostrou em cada bloco (`orientacoesIA`) e a foto do histórico do veículo que estava na tela em cada decisão (`fotosVeiculo`: frota informada, direcionamento, passagem ao analista). Cada gravação guarda também uma cópia da versão anterior (`ca_protocolos_historico`), e a função da IA grava cada pedido e resposta do Claude em `ca_ia_orientacoes`.

1. **Banco.** No Supabase: *SQL Editor → New query*, cole todo o `supabase/migrations/001_central_atendimento.sql` e rode (pode rodar de novo sem estragar nada).
   Depois rode também `supabase/migrations/002_checklist_do_app.sql`: ele traz para o histórico do veículo os itens em aberto do app de vistoria (precisa dos scripts 001 a 004 do app de vistoria no mesmo projeto).
2. **Logins.** *Authentication → Users → Add user*, um por pessoa (e-mail e senha). Depois, no *SQL Editor*, libere o perfil de cada uma com o trecho do fim do arquivo SQL (perfis: `N1`, `N2`, `N3`, `gestao` ou `centro`; para `centro`, informe o centro de coleta). Sem perfil liberado, o login não entra.
3. **Função da IA.** *Edge Functions → Deploy a new function → Via Editor*, nome `ia`. Apague o exemplo, cole todo o `supabase/functions/ia/index.ts` e publique. Nos detalhes da função, desligue **Enforce JWT verification**: a própria função confere o login e o perfil de quem pede.
4. **Segredos da função** (*Edge Functions → Secrets*): `ANTHROPIC_API_KEY` (a chave) e `ORIGENS_PERMITIDAS` (o endereço do site, ex.: `https://usuario.github.io`). O `CODIGO_ACESSO` da versão anterior não é mais usado e pode ser apagado.
5. **GitHub.** Em *Settings → Pages*, fonte **GitHub Actions**. Em *Settings → Secrets and variables → Actions → Variables*, crie `VITE_SUPABASE_URL` (endereço do projeto, ex.: `https://xxxx.supabase.co`) e `VITE_SUPABASE_ANON_KEY` (chave pública *anon/publishable*, em *Project Settings → API*). A variável `VITE_IA_URL` deixa de ser necessária.
6. A cada envio para a branch `main`, o site é publicado sozinho (aba *Actions*).

Mudou o núcleo da IA ou o conteúdo (`src/conteudo`)? Rode `npm run funcao` e cole o `index.ts` novo na função.

**Checklist do app de vistoria:** no site online, o quadro "Checklist em aberto" do histórico do veículo mostra, além da planilha, os itens das vistorias que subiram para o painel da vistoria e ainda não foram atendidos, e os atendidos com manutenção programada ainda não confirmada. Atualiza a cada 30 segundos. Os itens podem ser incluídos na OS com um clique e entram na foto do veículo guardada no protocolo. A central só lê: o atendimento do item continua sendo registrado no painel da vistoria. O nome do motorista não vem.

**Como a equipe trabalha junta:** cada mudança vai para o banco em cerca de 1 segundo; a cada 10 segundos a tela busca o que os colegas mudaram. Se duas pessoas mexem no mesmo protocolo, as listas que só crescem (eventos, orientações, OS, fotos do veículo) são somadas e nada se perde. O número do protocolo vem de uma sequência única do banco. O topo da tela mostra "gravado", "gravando…" ou o aviso de falta de conexão. Ao sair, a cópia deste navegador é apagada. O perfil `centro` só vê o painel do seu centro (frota, queixa, fase, prestador e previsão).

## Limites conhecidos desta versão

- No protótipo local (`npm run dev`, sem Supabase), os dados ficam só neste navegador e o nome e o perfil são escolhidos na entrada.
- Online, a sincronização é por consulta a cada 10 segundos (não é instantânea) e precisa de conexão; sem conexão, as mudanças ficam guardadas na tela e vão quando ela voltar (não feche a aba antes).
- Dados reais com a IA só depois da aprovação da TI e do Jurídico (D-06). Nome e telefone do motorista nunca vão para a IA.
- Árvores das 5 queixas em rascunho; as demais queixas vão ao analista.
- Não integra com o app de vistoria, o chatbot nem o SAP (fase 6 do PRD).
- Lançamentos manuais fora do horário: depois que a central estiver pronta (D-09).
