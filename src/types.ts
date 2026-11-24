// Tipos do domínio da Central de Atendimento (ver PRD.md, seção 12)

export type Prioridade = 'P0' | 'P1' | 'P2';
export type Nivel = 'N1' | 'N2' | 'N3';
export type Perfil = 'N1' | 'N2' | 'N3' | 'gestao' | 'centro';
export type Origem = 'checklist' | 'whatsapp' | 'telefone';
export type StatusConteudo = 'rascunho' | 'em_validacao' | 'validado';

export interface Queixa {
  id: string;
  nome: string;
  diz: string;
  piloto: boolean;
}

export interface Falha {
  id: string; // F-001
  queixa: string;
  sintoma: string;
  modos: string;
  sistema: string;
  vmrs: string;
  criticidade: 'Alta' | 'Média' | 'Baixa';
  p0: boolean;
  orientacao: string;
  especialidade: string;
  status: StatusConteudo;
}

/** Informação a obter na conversa. queixa '*' = bloco comum a todas as queixas. */
export interface ItemArvore {
  id: string;
  queixa: string;
  momento: number; // 1..6
  info: string;
  tipo: 'opcao' | 'texto';
  opcoes: string[];
  obrigatoria: 'trava' | 'sim' | 'nao';
  perguntas: string[];
  frases: string;
  cuidado: string;
  indica: string;
  naConversa?: boolean; // false = nunca vira pergunta ao motorista (sai do relato)
  status: StatusConteudo;
}

export type Condicao =
  | { item: string; in: string[] }
  | { any: Condicao[] }
  | { all: Condicao[] }
  | { not: Condicao };

export interface Saida {
  id: string;
  queixa: string;
  quando: string;
  condicao: Condicao;
  falhas: string[];
  prioridade: Prioridade;
  nivel: Nivel;
  especialidade: string;
  local: boolean; // atendimento no local
  orientacao: string;
  fechamento: string;
  status: StatusConteudo;
}

export type Respostas = Record<string, string>;

export type Estado =
  | 'na_fila'
  | 'em_triagem'
  | 'com_analista'
  | 'direcionado'
  | 'aguarda_orcamento'
  | 'em_validacao'
  | 'encerrado';

export interface Veiculo {
  frota: string;
  placa?: string;
  marca?: string;
  modelo?: string;
  classe?: string;
  centro?: string;
}

export interface Historico {
  frota: string;
  tipo: 'revisao' | 'manutencao';
  data: string; // AAAA-MM-DD
  km?: string;
  descricao: string;
  prestador?: string;
}

/** Preventiva programada (cadastro): o que precisa ser feito em cada frota e em que km. */
export interface Preventiva {
  id: string;
  frota: string;
  tipo: string; // tipo de revisão, ex.: "Revisão de 200.000 km", "Troca de óleo da caixa"
  kmPrevisto: number; // km em que precisa ser executada
  observacao?: string;
  executadaEm?: string; // AAAA-MM-DD; vazia = em aberto
  executadaKm?: number;
}

export interface ChecklistAberto {
  frota: string;
  data: string;
  item: string;
  resposta: string;
}

export interface Prestador {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  especialidades: string[];
  marcas: string[];
  tipo: 'homologado' | 'spot';
  atendeNoLocal: boolean;
  telefone: string;
  centros: string[]; // centros de coleta que atende
}

export interface Evento {
  em: string; // ISO
  autor: string;
  tipo: string;
  detalhe: string;
}

export interface SugestaoIA {
  em: string;
  tipo: 'ja_respondido' | 'falta' | 'falha' | 'queixa' | 'dica';
  codigo: string;
  valor?: string;
  texto: string;
  resposta?: 'aceita' | 'recusada';
}

export interface Retorno {
  combinadoPara: string; // ISO
  feitoEm?: string;
  resultado?: string;
}

export interface Validacao {
  diagnosticoPrestador: string;
  causaConfirmada: string; // F-xxx ou NOVA
  causaNova?: string;
  decisao: 'aprovado' | 'devolvido' | 'escalado';
  validadoPor: string;
  em: string;
}

/** Serviço a verificar na ordem de serviço. 'triagem' = veio das falhas prováveis; 'checklist' = item do checklist em aberto; 'atendente' = incluído à mão. */
export interface ServicoOS {
  texto: string;
  origem: 'triagem' | 'checklist' | 'preventiva' | 'atendente';
  codigo?: string; // F-xxx, quando vem da triagem
  checklist?: string; // chave do item do checklist (data|item), quando vem do checklist
  preventiva?: string; // id da preventiva programada, quando vem do cadastro de preventivas
}

/** Tipo da ordem de serviço. Uma parada pode ter várias OS de tipos diferentes (ex.: corretiva + preventiva). */
export type TipoOS = 'Corretiva' | 'Preventiva' | 'Preditiva' | 'Reforma' | 'Sinistro';

/** Rascunho de uma OS enquanto o atendente edita (fica no protocolo). */
export interface RascunhoOS {
  seq: number; // 1, 2, 3… dentro do protocolo
  tipo: TipoOS;
  servicos: ServicoOS[];
  observacoes: string;
  incluirContato: boolean; // nome e telefone do motorista no documento (LGPD: só quando o prestador precisa)
  prestadorSpot?: string; // nome e telefone quando o prestador é spot
}

/** Ordem de serviço para avaliação mecânica, emitida ao prestador. Cada emissão gera uma versão. */
export interface OrdemServico extends RascunhoOS {
  numero: string; // OS-CA-AAAAMMDD-####-v1
  versao: number;
  geradaEm: string; // ISO
  geradaPor: string;
  prestadorId: string;
  prestadorNome: string;
}

export interface Protocolo {
  id: string;
  numero: string;
  origem: Origem;
  abertoEm: string; // gerado pelo sistema
  frota: string;
  km: string;
  motoristaNome: string;
  motoristaTelefone: string;
  localInformado: string;
  queixa: string;
  estado: Estado;
  operador: string;
  relato: string;
  respostas: Respostas;
  palpite: string;
  saidaId?: string;
  prioridade?: Prioridade;
  nivel?: Nivel;
  nivelOperador?: Nivel; // complexidade classificada pelo atendente (nunca abaixo do que as regras indicam)
  nivelMotivo?: string;
  falhas?: string[];
  especialidade?: string;
  local?: boolean;
  prestadorId?: string;
  osSap?: string;
  previsaoLiberacao?: string; // ISO (D-13)
  retornos: Retorno[];
  validacoes: Validacao[];
  sugestoes: SugestaoIA[];
  eventos: Evento[];
  versaoRegras: string;
  liberadoEm?: string; // veículo liberado (some do painel do centro)
  osRascunho?: Omit<RascunhoOS, 'seq' | 'tipo'>; // formato antigo (uma OS só), convertido ao abrir
  osRascunhos?: RascunhoOS[]; // ordens de serviço em edição, uma por tipo de serviço da parada
  ordens?: OrdemServico[]; // ordens de serviço emitidas (todas as versões de todas as OS)
  passos?: Record<string, boolean>; // marcos do roteiro (acolheu, ouviu, pulou item...)
}
