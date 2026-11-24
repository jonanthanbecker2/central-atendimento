// Ponte com o Claude no PROTÓTIPO LOCAL (npm run dev): a chave fica no arquivo .env deste computador
// e NUNCA vai para o navegador. No site online, o mesmo núcleo roda na função do Supabase (supabase/functions/ia).
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { orientar, type Conteudo, type Pedido } from './nucleo.ts';

const ler = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../src/conteudo/${f}`, import.meta.url)), 'utf8'));
const conteudo = (): Conteudo => ({ itens: ler('arvore_itens.json'), catalogo: ler('catalogo.json'), queixas: ler('queixas.json'), roteiro: ler('roteiro.json') });

export function iaPlugin(env: Record<string, string>): Plugin {
  const chave = env.ANTHROPIC_API_KEY || '';
  // A orientação durante a conversa precisa sair em ~1 s: usa o modelo rápido (Haiku).
  const modelo = env.ANTHROPIC_MODEL_RAPIDO || 'claude-haiku-5-5';
  return {
    name: 'central-ia',
    configureServer(server) {
      server.middlewares.use('/api/ia/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ativa: !!chave, modelo }));
      });
      server.middlewares.use('/api/ia', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{}'); return; }
        let corpo = '';
        for await (const parte of req) corpo += parte;
        let p: Pedido;
        try { p = JSON.parse(corpo); } catch { res.statusCode = 400; res.end(JSON.stringify({ erro: 'pedido_invalido' })); return; }
        const r = await orientar(p, chave, modelo, conteudo());
        res.statusCode = r.status;
        res.end(JSON.stringify(r.corpo));
      });
    },
  };
}
