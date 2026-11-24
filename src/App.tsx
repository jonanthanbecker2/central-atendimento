import { useEffect, useState } from 'react';
import { definirUsuario, useBanco, type Usuario } from './dados/store';
import { Fila } from './telas/Fila';
import { Atendimento } from './telas/Atendimento';
import { Validacao } from './telas/Validacao';
import { PainelCentro } from './telas/PainelCentro';
import { Dados } from './telas/Dados';
import { retornoPendente } from './ui';

function useRota() {
  const [h, setH] = useState(window.location.hash || '#/fila');
  useEffect(() => {
    const f = () => setH(window.location.hash || '#/fila');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h.slice(1).split('/').filter(Boolean);
}

function Entrar() {
  const [nome, setNome] = useState('');
  const [perfil, setPerfil] = useState<Usuario['perfil']>('N1');
  const [centro, setCentro] = useState('');
  return (
    <div className="entrar">
      <h1>Central de Atendimento da Automotiva</h1>
      <p className="suave">Protótipo — os dados ficam só neste computador.</p>
      <label>Seu nome<input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus /></label>
      <label>Perfil
        <select value={perfil} onChange={(e) => setPerfil(e.target.value as Usuario['perfil'])}>
          <option value="N1">Assistente (N1)</option>
          <option value="N2">Analista (N2)</option>
          <option value="N3">Consultor técnico (N3)</option>
          <option value="gestao">Gestão</option>
          <option value="centro">Centro de coleta (só painel)</option>
        </select>
      </label>
      {perfil === 'centro' && <label>Centro de coleta<input value={centro} onChange={(e) => setCentro(e.target.value)} placeholder="ex.: Lençóis Paulista-SP" /></label>}
      <button className="primario" disabled={!nome.trim()} onClick={() => definirUsuario({ nome: nome.trim(), perfil, centro: centro.trim() || undefined })}>Entrar</button>
    </div>
  );
}

export default function App() {
  const banco = useBanco();
  const rota = useRota();
  const u = banco.usuario;
  const [, tique] = useState(0);
  useEffect(() => { const t = setInterval(() => tique((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  if (!u) return <Entrar />;

  const atrasados = banco.protocolos.filter((p) => {
    const r = retornoPendente(p);
    return r && new Date(r.combinadoPara).getTime() - Date.now() < 10 * 60000;
  }).length;

  const so = u.perfil === 'centro';
  const tela = so ? 'centro' : rota[0] ?? 'fila';
  const menu: [string, string][] = so
    ? [['centro', 'Painel do centro']]
    : [['fila', 'Fila'], ['validacao', 'Validação'], ['centro', 'Painel do centro'], ['dados', 'Planilhas e dados']];

  return (
    <div className="app">
      <header className="topo">
        <strong>Central de Atendimento</strong>
        <nav>
          {menu.map(([k, t]) => (
            <a key={k} href={`#/${k}`} className={tela === k ? 'ativo' : ''}>{t}{k === 'fila' && atrasados > 0 && <span className="bolha">{atrasados}</span>}</a>
          ))}
        </nav>
        <span className="usuario">{u.nome} · {u.perfil}{u.centro ? ` · ${u.centro}` : ''} <button className="link" onClick={() => definirUsuario(undefined)}>sair</button></span>
      </header>
      <main>
        {tela === 'fila' && <Fila />}
        {tela === 'atendimento' && rota[1] && <Atendimento id={rota[1]} />}
        {tela === 'validacao' && <Validacao />}
        {tela === 'centro' && <PainelCentro />}
        {tela === 'dados' && <Dados />}
      </main>
    </div>
  );
}
