// Planilhas (D-12: os dados vêm de planilha) e cópia de segurança do protótipo.
import { useState } from 'react';
import { alterarPreventiva, apagarProtocolos, carregarExemplos, exportarBackup, importarBackup, importarCsv, incluirPreventiva, removerPreventiva, useBanco } from '../dados/store';
import { emAberto, fmtKm, kmReferencia, situacao } from '../dados/preventivas';
import { fmtDia } from '../ui';
import { IA_ONLINE, reconferirIA, statusIA, avisoIADesligada, type StatusIA } from '../ia/cliente';
import { NUVEM } from '../dados/nuvem';
import { useEffect } from 'react';
import { catalogo, itens, saidas } from '../conteudo';

const PLANILHAS = [
  { tipo: 'veiculos', arquivo: 'veiculos.csv', titulo: 'Veículos', colunas: 'frota; placa; marca; modelo; classe; centro' },
  { tipo: 'historico', arquivo: 'historico.csv', titulo: 'Revisões e manutenções', colunas: 'frota; tipo (revisao ou manutencao); data (AAAA-MM-DD); km; descricao; prestador' },
  { tipo: 'checklist', arquivo: 'checklist_aberto.csv', titulo: 'Itens do checklist em aberto', colunas: 'frota; data; item; resposta' },
  { tipo: 'preventivas', arquivo: 'preventivas.csv', titulo: 'Preventivas programadas', colunas: 'frota; tipo_revisao; km_previsto; observacao (opcional); executada_em e executada_km (opcionais)' },
  { tipo: 'prestadores', arquivo: 'prestadores.csv', titulo: 'Prestadores', colunas: 'id; nome; cidade; uf; especialidades (separadas por |); marcas (| ou Todas); tipo (homologado ou spot); atende_no_local (sim/não); telefone; centros (|)' },
] as const;

export function Dados() {
  const b = useBanco();
  const [msg, setMsg] = useState('');
  const contagem = { veiculos: b.veiculos.length, historico: b.historico.length, checklist: b.checklist.length, preventivas: b.preventivas.length, prestadores: b.prestadores.length };

  const ler = (tipo: (typeof PLANILHAS)[number]['tipo'], f?: File) => {
    if (!f) return;
    f.text().then((t) => setMsg(`${importarCsv(tipo, t)} linhas importadas de ${f.name}.`));
  };

  const baixar = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportarBackup()], { type: 'application/json' }));
    a.download = `central-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div className="fila">
      <h2>Planilhas e dados</h2>
      <p className="suave">No Excel, salve cada aba como “CSV (separado por ponto e vírgula)”. Importar substitui os dados daquela planilha.</p>
      {msg && <p className="ok">{msg}</p>}
      <table>
        <thead><tr><th>Planilha</th><th>Colunas</th><th>Linhas</th><th>Modelo</th><th>Importar</th></tr></thead>
        <tbody>
          {PLANILHAS.map((p) => (
            <tr key={p.tipo}>
              <td><b>{p.titulo}</b></td>
              <td className="pequeno">{p.colunas}</td>
              <td>{contagem[p.tipo]}</td>
              <td><a href={`modelos/${p.arquivo}`} download>{p.arquivo}</a></td>
              <td><input type="file" accept=".csv,text/csv" onChange={(e) => ler(p.tipo, e.target.files?.[0])} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="linha">
        <button onClick={() => (!NUVEM || confirm('Isto troca as planilhas de TODA a equipe pelos exemplos fictícios. Continuar?')) && carregarExemplos().then(() => setMsg('Planilhas de exemplo carregadas (dados fictícios).'))}>Carregar exemplos fictícios</button>
        <button onClick={baixar}>Baixar cópia de segurança</button>
        {!NUVEM && <>
          <label className="botao">Restaurar cópia<input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0]?.text().then((t) => { importarBackup(t); setMsg('Cópia restaurada.'); })} /></label>
          <button onClick={() => { if (confirm('Apagar todos os protocolos deste computador?')) { apagarProtocolos(); setMsg('Protocolos apagados.'); } }}>Apagar protocolos de teste</button>
        </>}
      </div>
      <AcessoIA />
      <CadastroPreventivas />
      <h3>Conteúdo da triagem</h3>
      <p>{catalogo.length} falhas no catálogo · {itens.length} informações nas árvores · {saidas.length} saídas. Tudo em <b>rascunho</b> até a validação dos analistas (arquivos em <code>src/conteudo</code>).</p>
    </div>
  );
}

/** Cadastro de preventivas programadas: frota, tipo de revisão e km em que precisa ser executada. */
function CadastroPreventivas() {
  const b = useBanco();
  const [frota, setFrota] = useState('');
  const [tipo, setTipo] = useState('');
  const [km, setKm] = useState('');
  const [obs, setObs] = useState('');
  const [filtro, setFiltro] = useState('');
  const [verExecutadas, setVerExecutadas] = useState(false);
  const kmNum = Number(km.replace(/\D/g, ''));
  const valido = frota.trim() && tipo.trim() && kmNum > 0;
  const salvar = () => {
    if (!valido) return;
    incluirPreventiva({ frota: frota.trim(), tipo: tipo.trim(), kmPrevisto: kmNum, observacao: obs.trim() || undefined });
    setTipo(''); setKm(''); setObs('');
  };
  const frotas = [...new Set(b.preventivas.map((x) => x.frota))].filter((f) => !filtro || f.includes(filtro.trim())).sort((a, c) => a.localeCompare(c, 'pt-BR', { numeric: true }));
  return (
    <>
      <h3>Cadastro de preventivas programadas</h3>
      <p className="suave">O que precisa ser feito em cada frota e em que km. Aparece no histórico do caminhão durante o atendimento e pode entrar na OS preventiva da parada.</p>
      <div className="linha form-prev">
        <label>Frota<input value={frota} onChange={(e) => setFrota(e.target.value)} style={{ width: 80 }} /></label>
        <label className="cresce">Tipo de revisão<input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Ex.: Revisão de 200.000 km (plano do fabricante)" /></label>
        <label>Km para executar<input value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" style={{ width: 120 }} onKeyDown={(e) => e.key === 'Enter' && salvar()} /></label>
        <label className="cresce">Observação (opcional)<input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: inclui troca da correia" /></label>
        <button className="primario" disabled={!valido} onClick={salvar}>Cadastrar</button>
      </div>
      <div className="linha">
        <label>Filtrar frota<input value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 100 }} /></label>
        <label className="check"><input type="checkbox" checked={verExecutadas} onChange={(e) => setVerExecutadas(e.target.checked)} /> mostrar executadas</label>
      </div>
      {frotas.length === 0 ? <p className="suave">Nenhuma preventiva cadastrada.</p> : (
        <table>
          <thead><tr><th>Frota</th><th>Tipo de revisão</th><th>Km previsto</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {frotas.flatMap((f) => {
              const kmAtual = kmReferencia(undefined, b.historico, f);
              const lista = verExecutadas ? b.preventivas.filter((x) => x.frota === f).sort((a, c) => a.kmPrevisto - c.kmPrevisto) : emAberto(b.preventivas, f);
              return lista.map((x) => {
                const st = situacao(x, kmAtual);
                return (
                  <tr key={x.id}>
                    <td>{x.frota}</td>
                    <td>{x.tipo}{x.observacao ? <div className="suave pequeno">{x.observacao}</div> : null}</td>
                    <td>{fmtKm(x.kmPrevisto)}</td>
                    <td className={x.executadaEm ? 'suave' : `preventivas ${st.classe}`}>{x.executadaEm ? `executada em ${fmtDia(x.executadaEm)}${x.executadaKm ? ` · ${fmtKm(x.executadaKm)} km` : ''}` : <span className={st.classe}>{st.rotulo}{kmAtual ? ` (último km: ${fmtKm(kmAtual)})` : ''}</span>}</td>
                    <td className="acoes">
                      {x.executadaEm
                        ? <button className="link pequeno" onClick={() => alterarPreventiva(x.id, { executadaEm: undefined, executadaKm: undefined })}>reabrir</button>
                        : <button className="pequeno" onClick={() => { const k = prompt('Km em que foi executada:', String(kmAtual || '')); if (k !== null) alterarPreventiva(x.id, { executadaEm: new Date().toISOString().slice(0, 10), executadaKm: Number(k.replace(/\D/g, '')) || undefined }); }}>Marcar executada</button>}
                      <button className="link pequeno" onClick={() => confirm(`Remover "${x.tipo}" da frota ${x.frota}?`) && removerPreventiva(x.id)}>remover</button>
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Situação da IA (no site online, a IA usa o login de cada pessoa; não há código para digitar). */
function AcessoIA() {
  const [st, setSt] = useState<StatusIA | null>(null);
  const conferir = () => { setSt(null); reconferirIA(); statusIA().then(setSt); };
  useEffect(conferir, []);
  return (
    <>
      <h3>IA (Claude)</h3>
      <p className="suave">{IA_ONLINE ? 'No site online, a IA responde a quem entrou com login individual e perfil liberado. Cada orientação fica gravada no banco, com o protocolo e o bloco da conversa.' : 'Protótipo local: a IA usa a chave do arquivo .env deste computador.'}</p>
      <div className="linha"><p className={st?.ativa ? 'ok' : 'suave'}>{st === null ? 'Conferindo a IA…' : st.ativa ? `IA ligada (${st.modelo ?? 'Claude'}).` : avisoIADesligada(st)}</p><button onClick={conferir}>Conferir de novo</button></div>
    </>
  );
}
