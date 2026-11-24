// Leitura de planilhas CSV (Excel em português salva com ";"; também aceita ",").
export function lerCsv(texto: string): Record<string, string>[] {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
  const [cab, ...resto] = linhas;
  if (!cab) return [];
  const chaves = cab.map((h) => h.trim().toLowerCase());
  return resto.map((l) => Object.fromEntries(chaves.map((k, i) => [k, (l[i] ?? '').trim()])));
}
