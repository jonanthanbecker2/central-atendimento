import { useEffect, useState, useSyncExternalStore } from 'react';
import { definirUsuario, useBanco, type Usuario } from './dados/store';
import { Fila } from './telas/Fila';
import { Atendimento } from './telas/Atendimento';
import { Validacao } from './telas/Validacao';
import { PainelCentro } from './telas/PainelCentro';
import { Dados } from './telas/Dados';
import { retornoPendente } from './ui';
import { NUVEM, assinarEstadoSync, entrar, lerEstadoSync, retomarSessao, sair } from './dados/nuvem';
import { reconferirIA } from './ia/cliente';

/** Site online: login individual (e-mail e senha criados pela gestão no Supabase). */
function EntrarNuvem() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [indo, setIndo] = useState(false);
  const ir = async () => {
    setIndo(true); setErro('');
    const e = await entrar(email, senha);
    reconferirIA();
    setIndo(false);
    if (e) setErro(e);
  };
  return (
    <div className="entrar">
      <h1>Central de Atendimento da Automotiva</h1>
      <p className="suave">Entre com o seu login. Tudo o que você registrar fica gravado com o seu nome.</p>
      <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></label>
      <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ir()} autoComplete="current-password" /></label>
      {erro && <p className="aviso">{erro}</p>}
      <button className="primario" disabled={indo || !email.trim() || !senha} onClick={ir}>{indo ? 'Entrando…' : 'Entrar'}</button>
    </div>
  );
}

function AvisoSync() {
  const st = useSyncExternalStore(assinarEstadoSync, lerEstadoSync);
  if (st.erro) return <span className="sync erro" title={st.erro}>⚠ {st.erro}</span>;
  if (st.pendentes) return <span className="sync">gravando…</span>;
  return <span className="sync ok" title={st.ultimaVez ? `Última conferência: ${new Date(st.ultimaVez).toLocaleTimeString('pt-BR')}` : ''}>gravado</span>;
}

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
  const [pronto, setPronto] = useState(!NUVEM);
  useEffect(() => { if (NUVEM) retomarSessao().finally(() => { reconferirIA(); setPronto(true); }); }, []);

  if (!pronto) return <div className="entrar"><p className="suave">Abrindo a central…</p></div>;
  if (!u) return NUVEM ? <EntrarNuvem /> : <Entrar />;

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
        <span className="usuario">{NUVEM && <AvisoSync />} {u.nome} · {u.perfil}{u.centro ? ` · ${u.centro}` : ''} <button className="link" onClick={() => (NUVEM ? sair().then(reconferirIA) : definirUsuario(undefined))}>sair</button></span>
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
