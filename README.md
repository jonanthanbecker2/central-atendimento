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

## Publicar online com a IA

O site fica no GitHub Pages; a IA fica numa função do Supabase, que guarda a chave da Anthropic. A chave nunca vai para o site.

1. **Função da IA (Supabase).** No painel do projeto: *Edge Functions → Deploy a new function → Via Editor*, nome `ia`. Apague o exemplo, cole todo o conteúdo de `supabase/functions/ia/index.ts` e publique. Nos detalhes da função, desligue **Enforce JWT verification** (o acesso é protegido pelo código de acesso).
2. **Segredos da função** (*Edge Functions → Secrets*): `ANTHROPIC_API_KEY` (a chave), `CODIGO_ACESSO` (um código que só a equipe da central sabe) e `ORIGENS_PERMITIDAS` (o endereço do site, ex.: `https://usuario.github.io`).
3. **Repositório no GitHub** com este projeto (sem `node_modules`, sem `.env`). Em *Settings → Pages*, fonte **GitHub Actions**. Em *Settings → Secrets and variables → Actions → Variables*, crie `VITE_IA_URL` com o endereço da função (ex.: `https://xxxx.supabase.co/functions/v1/ia`).
4. A cada envio para a branch `main`, o site é publicado sozinho (aba *Actions*). No site, cada atendente informa o código de acesso uma vez, em *Planilhas e dados*.

Mudou o núcleo da IA ou o conteúdo (`src/conteudo`)? Rode `npm run funcao` e cole o `index.ts` novo na função.

## Limites conhecidos desta versão

- Dados só no navegador de cada pessoa, também no site publicado (sem banco compartilhado ainda): cada um vê só os protocolos que abriu.
- Sem login real: o nome e o perfil são escolhidos na entrada.
- Árvores das 5 queixas em rascunho; as demais queixas vão ao analista.
- Não integra com o app de vistoria, o chatbot nem o SAP (fase 6 do PRD).
- Lançamentos manuais fora do horário: depois que a central estiver pronta (D-09).
