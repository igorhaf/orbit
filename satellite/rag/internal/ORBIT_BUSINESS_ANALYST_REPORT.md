# ORBIT - Relatorio Funcional para Analista de Negocios

**Data:** Fevereiro 2026
**Versao:** 2.1

---

## 1. Visao Geral do Sistema

O ORBIT e uma plataforma de gestao de projetos de software potencializada por inteligencia artificial. Seu proposito central e transformar uma base de codigo existente em um backlog completo e estruturado, passando por analise automatica, entrevistas guiadas e geracao hierarquica de itens de trabalho.

O sistema nao gera codigo do zero. Ele parte de um projeto ja existente, compreende sua estrutura, conduz uma conversa com o usuario para entender o contexto de negocio, e entao produz um roadmap completo com epicos, historias, tarefas e subtarefas.

---

## 2. Conceitos Fundamentais

### 2.1 Projeto

Um projeto no ORBIT representa uma base de codigo existente. O usuario aponta para uma pasta do sistema de arquivos contendo o codigo-fonte. A partir desse momento, o ORBIT analisa o conteudo, identifica tecnologias, padroes e regras de negocio embutidas no codigo.

### 2.2 Contexto do Projeto

Cada projeto possui um contexto imutavel, definido por meio de uma entrevista com IA. Esse contexto funciona como uma "constituicao" do projeto: uma vez definido e travado, nao pode ser alterado. Todas as geracoes futuras (epicos, historias, tarefas) respeitam esse contexto, garantindo consistencia ao longo de todo o ciclo de vida.

### 2.3 Hierarquia de Itens de Trabalho

O ORBIT organiza o trabalho em quatro niveis:

| Nivel | Descricao | Quantidade Tipica |
|-------|-----------|-------------------|
| **Epico** | Modulo ou funcionalidade macro do sistema | 8-20 por projeto |
| **Historia** | Funcionalidade ou cenario dentro de um epico | 15-20 por epico |
| **Tarefa** | Unidade de trabalho tecnica | 5-8 por historia |
| **Subtarefa** | Passo atomico de implementacao | 3-5 por tarefa |

Cada nivel e gerado automaticamente pela IA quando o nivel superior e aprovado pelo usuario.

### 2.4 Base de Conhecimento

O sistema mantem uma base de conhecimento associada a cada projeto, composta por:
- Regras de negocio extraidas do codigo-fonte
- Respostas das entrevistas com o usuario
- Documentos adicionados manualmente
- Especificacoes de frameworks detectados

Essa base e consultada pela IA sempre que gera novos itens, garantindo que o conteudo produzido respeite o que ja existe no projeto.

---

## 3. Fluxo Principal do Usuario

### 3.1 Criacao do Projeto

O usuario inicia criando um projeto e apontando para uma pasta com codigo existente. Ele escolhe um nivel de profundidade de analise:

- **Rapida**: analisa 30 arquivos, resultado em poucos minutos
- **Normal**: analisa 100 arquivos, equilibrio entre velocidade e profundidade
- **Completa**: analisa todos os arquivos, mais demorada

O sistema entao executa uma analise automatica em segundo plano que:
- Identifica as tecnologias utilizadas (linguagens, frameworks, banco de dados)
- Extrai regras de negocio presentes no codigo
- Detecta padroes arquiteturais
- Sugere um nome para o projeto baseado no que encontrou

O usuario pode navegar para outras telas enquanto a analise acontece. O sistema notifica quando concluir.

### 3.2 Entrevista de Contexto

Apos a analise, o sistema conduz uma entrevista guiada para compreender o contexto de negocio do projeto. Essa entrevista possui duas partes:

**Perguntas fixas (obrigatorias):**
1. Qual o proposito principal do projeto?
2. Quais as tecnologias e frameworks utilizados?
3. Quais os modulos ou funcionalidades principais?

**Perguntas contextuais (geradas pela IA):**
A IA formula perguntas adicionais baseadas nas respostas anteriores e na analise do codigo. O usuario decide quando possui informacao suficiente e encerra a entrevista.

Para cada pergunta, o usuario pode selecionar entre opcoes sugeridas ou digitar uma resposta personalizada.

Ao final, o sistema gera um resumo do contexto e apresenta de 8 a 20 sugestoes de epicos (modulos macro). O usuario revisa e confirma. A partir desse momento, o contexto e travado e nao pode mais ser alterado.

### 3.3 Gestao do Backlog

Os epicos sugeridos aparecem no backlog como rascunhos. Para cada um, o usuario pode:

- **Aprovar**: o sistema gera o conteudo completo do epico e automaticamente cria de 15 a 20 historias como rascunho
- **Rejeitar**: o epico sugerido e removido

O mesmo processo se repete em cascata:
- Aprovar uma historia gera de 5 a 8 tarefas
- Aprovar uma tarefa gera de 3 a 5 subtarefas
- Aprovar uma subtarefa gera seu conteudo final (nivel folha)

Cada item gerado contem: titulo, descricao detalhada, criterios de aceitacao, estimativa de esforco e um mapa de referencias semanticas que garante consistencia entre todos os niveis.

### 3.4 Entrevistas por Item

Alem da entrevista de contexto, o usuario pode conduzir entrevistas focadas em qualquer item do backlog. A IA faz perguntas especificas sobre aquele item e, ao concluir, atualiza automaticamente a descricao e os criterios de aceitacao com base nas respostas obtidas.

### 3.5 Quadro Kanban

O usuario acompanha o progresso do trabalho atraves de um quadro visual com seis colunas:

| Coluna | Significado |
|--------|-------------|
| Bloqueado | Itens que dependem de aprovacao ou outro item |
| Backlog | Itens prontos para serem priorizados |
| A Fazer | Itens priorizados para execucao |
| Em Progresso | Itens em andamento |
| Revisao | Itens aguardando revisao |
| Concluido | Itens finalizados |

Os itens podem ser movidos entre colunas por arraste. Clicar em qualquer item abre um painel lateral com todas as informacoes detalhadas.

### 3.6 Criacao Manual

Embora o sistema gere itens automaticamente, o usuario pode a qualquer momento criar itens manualmente em qualquer nivel da hierarquia, diretamente no backlog.

---

## 4. Funcionalidades de Suporte

### 4.1 Fila de Execucao

O sistema possui uma fila de processamento que organiza a ordem em que os itens serao gerados pela IA. O usuario pode:

- Definir a estrategia de ordenacao (por prioridade, por hierarquia, por dependencias ou balanceada)
- Reordenar manualmente os itens na fila
- Pular itens especificos
- Definir quantos itens podem ser processados simultaneamente

### 4.2 Especificacoes de Frameworks

O ORBIT mantem uma biblioteca de especificacoes tecnicas dos frameworks detectados no projeto (como Laravel, Next.js, PostgreSQL). Essas especificacoes sao usadas para que a IA gere conteudo mais preciso e consistente com o ecossistema do projeto. O usuario pode adicionar, editar ou remover especificacoes.

### 4.3 Regras de Negocio

O sistema extrai automaticamente regras de negocio do codigo-fonte (validacoes, fluxos de trabalho, permissoes, calculos) e as armazena na base de conhecimento. O usuario tambem pode adicionar regras manualmente, categorizadas por tipo:
- Validacao (verificacoes de dados)
- Fluxo de trabalho (processos e aprovacoes)
- Calculo (logica matematica)
- Permissao (controle de acesso)
- Integracao (sistemas externos)

### 4.4 Documentos de Referencia

O usuario pode fazer upload de documentos (Markdown, texto) que serao indexados na base de conhecimento. A IA consulta esses documentos ao gerar novos itens.

### 4.5 Criterios de Aceitacao

Cada item de trabalho pode conter criterios de aceitacao editaveis. O usuario pode adicionar, editar e remover criterios individualmente, diretamente no painel de detalhes do item.

---

## 5. Modelos de IA e Orquestracao

### 5.1 Multiplos Provedores

O ORBIT nao depende de um unico provedor de IA. O sistema suporta simultaneamente:
- Anthropic (Claude)
- OpenAI (GPT)
- Google (Gemini)
- Ollama (modelos locais)
- Cohere

O usuario configura quais modelos estao disponiveis e atribui cada modelo a um tipo de operacao.

### 5.2 Tipos de Operacao

Cada atividade do sistema utiliza um modelo de IA especifico, configuravel pelo usuario:

| Operacao | O que faz |
|----------|-----------|
| Entrevista | Conduz conversas com o usuario sobre o projeto |
| Geracao de Prompts | Transforma respostas de entrevistas em itens de trabalho |
| Execucao de Tarefas | Gera conteudo detalhado para cada item |
| Geracao de Commits | Cria mensagens de commit para alteracoes no codigo |
| Descoberta de Padroes | Analisa o codigo para identificar padroes e convencoes |
| Varredura de Memoria | Analisa profundamente a base de codigo |
| Geral (Reserva) | Modelo padrao usado quando nenhum especifico esta definido |

### 5.3 Cadeia de Fallback

O usuario pode configurar visualmente uma cadeia de substituicao para cada operacao. Por exemplo:

> Para "Entrevista": tentar Claude primeiro. Se falhar, tentar GPT-4. Se falhar, tentar Gemini.

Essa configuracao e feita em uma interface visual estilo diagrama de fluxo, onde cada modelo aparece como um no. O sistema exibe metricas em tempo real de cada modelo (taxa de sucesso, tempo de resposta, custo).

### 5.4 Controle de Custos

O sistema permite configurar para cada modelo:
- Limite de requisicoes por minuto (evita gastos excessivos)
- Tempo maximo de espera por resposta
- Numero maximo de requisicoes simultaneas

Todas as chamadas de IA passam por um cache inteligente que evita repetir chamadas identicas ou muito similares, reduzindo custos significativamente.

---

## 6. Monitoramento e Visibilidade

### 6.1 Dashboard

A tela inicial apresenta um panorama geral do sistema:
- Custo total das chamadas de IA
- Distribuicao de custos por provedor
- Distribuicao de custos por tipo de operacao
- Desempenho do cache (economia realizada)

### 6.2 Fila de Trabalho

O usuario visualiza todos os processos em segundo plano:
- Status de cada processo (pendente, executando, concluido, falha)
- Progresso percentual
- Duracao
- Possibilidade de cancelar processos

### 6.3 Console

Um visualizador de logs em tempo real mostra toda a atividade do sistema:
- Chamadas de IA (pergunta enviada, resposta recebida, tempo de resposta)
- Operacoes na base de conhecimento
- Progresso de processos em segundo plano
- Erros e alertas

O usuario pode filtrar por categoria, nivel de severidade e buscar por texto.

### 6.4 Notificacoes

O sistema notifica o usuario atraves de um sino na barra superior sempre que:
- Um processo em segundo plano e concluido
- Novos itens de trabalho sao gerados
- Ocorre uma falha

### 6.5 Contratos

O sistema armazena as regras que governam o comportamento da IA em formato estruturado. O usuario pode visualizar, editar e versionar essas regras. Categorias incluem: regras de negocio, regras de geracao, regras de entrevista, regras de memoria.

---

## 7. Areas do Sistema

| Area | Funcao Principal |
|------|-----------------|
| **Dashboard** | Visao geral de custos e desempenho |
| **Projetos** | Criar, configurar e gerenciar projetos |
| **Prompts** | Historico de todas as chamadas de IA |
| **Modelos de IA** | Cadastro e configuracao dos modelos disponiveis |
| **AI Flow** | Configuracao visual das cadeias de fallback |
| **Contratos** | Regras que governam o comportamento da IA |
| **RAG Analytics** | Estatisticas da base de conhecimento |
| **Fila de Trabalho** | Monitoramento de processos em segundo plano |
| **Console** | Logs em tempo real do sistema |
| **Configuracoes** | Modelo padrao por operacao, fila de execucao, configuracoes avancadas |

---

## 8. Decisoes do Usuario em Cada Etapa

| Etapa | Decisao | Impacto |
|-------|---------|---------|
| Criacao do projeto | Profundidade da analise | Determina o quao bem a IA compreende o codigo existente |
| Entrevista de contexto | Respostas as perguntas | Define a direcao de todos os itens gerados |
| Entrevista de contexto | Quando encerrar | Controla o nivel de detalhe do contexto |
| Epicos sugeridos | Aprovar ou rejeitar | Define quais funcionalidades serao desenvolvidas |
| Cada nivel da hierarquia | Aprovar ou rejeitar | Controla a granularidade do backlog |
| Fila de execucao | Estrategia de ordenacao | Define a prioridade de geracao dos itens |
| Modelos de IA | Modelo por operacao | Equilibra custo, velocidade e qualidade |
| Cadeia de fallback | Ordem dos modelos | Define a resiliencia do sistema |

---

## 9. O que o Sistema Gera Automaticamente

| Gatilho | Resultado | Volume |
|---------|-----------|--------|
| Criacao do projeto | Analise do codigo, regras de negocio, stack tecnologica | Automatico |
| Conclusao da entrevista | Contexto do projeto + epicos sugeridos | 8-20 epicos |
| Aprovacao de epico | Historias detalhadas | 15-20 por epico |
| Aprovacao de historia | Tarefas tecnicas | 5-8 por historia |
| Aprovacao de tarefa | Subtarefas atomicas | 3-5 por tarefa |
| Entrevista por item | Descricao e criterios atualizados | Por item |
| Varredura continua | Novas regras de negocio na base de conhecimento | Incremental |

---

## 10. Proposta de Valor

O ORBIT resolve o problema de transformar uma base de codigo existente em um backlog estruturado e gerenciavel. Em vez de o time gastar semanas mapeando manualmente o que existe e o que precisa ser feito, o sistema:

1. **Compreende o codigo existente** automaticamente, identificando tecnologias, padroes e regras de negocio
2. **Conduz uma entrevista estruturada** para capturar o contexto de negocio que nao esta no codigo
3. **Gera um roadmap hierarquico completo** com epicos, historias, tarefas e subtarefas, cada um com descricao, criterios de aceitacao e estimativas
4. **Mantem consistencia** atraves de um contexto imutavel e referencias semanticas que conectam todos os niveis da hierarquia
5. **Otimiza custos** ao usar multiplos provedores de IA com cache inteligente e cadeias de fallback
6. **Evolui continuamente** a base de conhecimento com novas regras extraidas do codigo a cada ciclo de varredura

O resultado e um backlog completo, consistente e rastreavel, gerado em uma fracao do tempo que levaria se feito manualmente.

---
