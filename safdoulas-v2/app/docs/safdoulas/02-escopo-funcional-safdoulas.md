# O que o SAFDOULAS precisa ter

**Origem:** lista de requisitos recebida em `Pasted text.txt`, complementada pelos documentos normativos e modelos citados junto aos itens.
**Status:** escopo cruzado com os 13 documentos em 21/10/2026; módulos de produto implementados e inventariados em [01 — Inventário atual](./01-inventario-orbit-atual.md). O fechamento e as decisões de interpretação estão em [03 — Escopo fechado](./03-escopo-fechado.md).
**Uso:** escopo funcional de referência para desenho, priorização e validação. Os parâmetros de demonstração são identificados como tais e não representam aprovação jurídica ou institucional para uso real.

## Finalidade do produto

O SafDoulas é um sistema de solicitação, análise e acreditação institucional de cursos pela FENADOULASBR.
Os cursos, matrizes, equipes, práticas e critérios pedagógicos são objetos e evidências da análise documental.
O produto não oferece aulas, salas virtuais, reprodução de videoaulas, matrícula de estudantes, controle de aprendizagem ou emissão de certificados de conclusão às alunas.
A documentação pode compor um dossiê para encaminhamento externo pelo responsável; o edital recebido, seção 7.1, distingue a acreditação institucional de autorização/reconhecimento estatal.
Não há protocolo eletrônico, integração oficial ou aprovação automática pelo MEC neste escopo.

## Princípios de modelagem

1. O registro central deve ser o **processo de acreditação**, com número, versão das regras, curso/objeto avaliado, participantes, documentos, estado e histórico próprios.
2. Instituições, coletivos, cursos, pessoas, acreditadoras, documentos e acreditações são entidades relacionadas por identificadores; não devem ser armazenados apenas em descrições de cartões.
3. Cada processo mantém snapshots das regras, edital, matriz e documentos aplicáveis na data de abertura, sem alterações retroativas.
4. A análise cegada é uma projeção controlada dos dados originais, com regras explícitas de campos ocultos e preservação das evidências necessárias.
5. A autorização combina RBAC com participação e escopo do processo. Workspace não concede acesso automaticamente a dados ou documentos de acreditação.
6. Uma decisão, parecer ou documento final deve ser versionado e auditável; correções produzem nova versão ou evento, sem sobrescrita silenciosa.
7. Parâmetros institucionais — prazos, quórum, validade, critérios, retenção, assinatura e competência decisória — devem ser configuráveis e aprovados pelos responsáveis antes de uso real.

## Módulos e requisitos

### 1. Identidade, perfis e segurança

- Login, sessões seguras, recuperação de senha, verificação de e-mail e gerenciamento de sessão.
- Perfis e permissões separados para FENADOULASBR, Diretoria, GT, acreditadoras, candidatas a acreditadora, instituições/formadoras, representantes e usuários públicos.
- Controle granular para visualizar, editar, distribuir, avaliar, deliberar, publicar e administrar cada informação e processo.
- Combinar os privilégios globais do RBAC com a participação específica no processo e a situação atual do usuário.
- Revogar imediatamente a autorização de pessoas substituídas, suspensas, desligadas ou removidas do processo.
- Não tratar workspace como papel institucional nem como autorização automática para documentos/processos.

### 2. Cadastro da oferta formativa

- Cadastrar instituições formadoras, incluindo dados cadastrais, CNPJ quando houver, sede, contatos, responsáveis, vínculos e histórico.
- Permitir cadastro e solicitação de coletivos e formadoras independentes sem exigir vínculo com instituição formal de ensino.
- Cadastrar responsáveis institucionais, função, vínculo com curso e autorização para representar a instituição.
- Cadastrar cursos com nome, ano de criação, instituição, ofertas, situação, localidade e histórico.
- Registrar modalidades presencial, híbrida, on-line síncrona, assíncrona e outras autorizadas.
- Cadastrar coordenação pedagógica, integrantes, formação, condição de doula, experiência, atuação e responsabilidades.
- Cadastrar corpo docente, distinguindo doulas e não doulas, com formação, profissão, experiência, componentes ministrados e comprovações.
- Registrar critérios de ingresso, proposta pedagógica, objetivos, metodologia, concepção de ensino, suporte às estudantes e organização da formação.
- Registrar a matriz curricular submetida à análise, com módulos, eixos, disciplinas, conteúdos, cronograma, ementas e cargas horárias.
- Registrar conteúdo programático e confrontá-lo com a matriz e os parâmetros da acreditação.
- Discriminar carga horária teórica, presencial, síncrona, assíncrona, atividades extras, vivências, estudos de caso e práticas.
- Registrar práticas vivenciais e práticas supervisionadas, incluindo horas, supervisores, modalidade, relatórios, evidências e limites éticos.
- Registrar os métodos avaliativos declarados pelo curso e e critérios de certificação, frequência, desempenho, atividades obrigatórias e produtos finais.
- Armazenar e analisar o modelo de certificado do curso e os dados/cargas horárias nele declarados.
- Registrar acessibilidade pedagógica/comunicacional, adaptações, ações afirmativas, bolsas, acesso e permanência.

### 3. Regras curriculares e validação

- Validar automaticamente a soma de horas e apontar diferenças entre formulário, matriz, cronograma, certificado e anexos.
- Parametrizar mínimos de horas, percentuais práticos e proporções presenciais/síncronas, sem fixar regra no código.
- Identificar inconsistências e apresentar cálculo, regra e fonte usados, permitindo revisão humana antes de qualquer conclusão.
- Versionar os parâmetros por edital; preservar no processo a versão aplicada quando ele foi aberto.
- Manter os valores exatos de referência configuráveis: requisitos como 120 horas e percentuais citados na matriz dependem da versão normativa aprovada.

### 4. Documentos, submissão e protocolo

- Receber PPP, matriz, cronograma, certificados, autodeclarações, comprovações docentes e demais documentos exigidos.
- Classificar documento por categoria, responsável, data, versão, processo, validade e situação de validação.
- Preservar o original e todas as substituições, complementações e versões entregues em diligências.
- Registrar aceites do edital, veracidade das informações e responsabilidade institucional.
- Registrar consentimento LGPD com finalidade e histórico de versão, conforme política institucional validada.
- Criar protocolo formal quando a solicitação obrigatória estiver completa e gerar numeração institucional única e configurável, por exemplo `SAF-CAP-2026/001`.
- Registrar autor, instante, versão enviada, documentos, declarações e resumo inviolável da submissão.
- Oferecer triagem documental, lista de requisitos, inconsistências e admissibilidade.
- Permitir correção/complementação preliminar antes de distribuir para avaliação, com motivo, prazo e histórico.

### 5. Processo, estados e prazos

- Manter linha do tempo integral, desde a inscrição até encerramento, renovação, suspensão ou cancelamento.
- Controlar máquina de estados configurada e validada institucionalmente, cobrindo inscrição, triagem, análise, diligência, deliberação, recurso e decisão.
- Impedir transições sem os dados, documentos, autorizações ou assinaturas necessários; registrar quem realizou cada transição.
- Controlar prazo por etapa, alertas, atrasos, justificativas e extensões autorizadas.
- Pausar e retomar prazo quando aguardar resposta institucional, preservando motivo, data e responsável.
- Registrar convocação, participantes, pauta, data, ata e resultado de entrevista/reunião complementar.
- Permitir reapresentação como novo processo relacionado ao anterior, sem apagar ou reescrever a solicitação anterior.

### 6. Seleção e administração de acreditadoras

- Receber candidaturas, anexos e declarações para seleção de acreditadoras; acompanhar requisitos, formação/alinhamento e resultado.
- Validar formação, tempo de atuação, associação, experiência institucional/formativa e demais requisitos vigentes no edital correspondente.
- Homologar ou reprovar candidatas; emitir certificado numerado, data e validade para as aprovadas.
- Manter cadastro interno com UF/região, vínculos, áreas de experiência, disponibilidade, capacidade, situação e validade.
- Controlar situações ativa, temporariamente inativa, suspensa, desligada e em renovação.
- Registrar disponibilidade e capacidade para receber processos.
- Manter declarações permanentes e periódicas de instituições, cursos, consultorias, docência, relações comerciais e demais vínculos.
- Recolher termo ético, sigilo e imparcialidade; registrar impedimento, suspeição, causa e decisão sobre a declaração.
- Comparar vínculos declarados com instituição, curso, coordenação e participantes antes de distribuir, sinalizando conflito para revisão humana.
- Distribuir pelo menos duas acreditadoras habilitadas por curso, observadas as regras vigentes.
- Sugerir distribuição por disponibilidade, rodízio, regionalidade, diversidade, experiência e conflitos; evitar concentração por pessoa, associação, região ou grupo.
- Registrar aceite, recusa, impedimento, suspeição, justificativa e substituição, revogando o acesso anterior quando necessário.
- Registrar histórico de atuação, processos recebidos/concluídos/recusados, atrasos, substituições e situações disciplinares.
- Gerir atualização e renovação de habilitação, alinhamento, termos, inatividade, ocorrências, manifestação, advertência, suspensão e desligamento.

### 7. Cegamento e avaliação independente

- Criar cópia/projeção cegada própria para análise, sem alterar os dados originais submetidos.
- Definir e testar quais campos, metadados, nomes, CNPJ, contatos, identidade visual e propriedades dos arquivos são removidos ou mantidos.
- Preservar formação, profissão, experiência e evidências que a matriz exija, sem expor identidade institucional indevida.
- Guardar autor, regras e versão do cegamento, com acesso restrito à versão identificável.
- Oferecer área de avaliação individual; cada acreditadora preenche sua matriz e parecer sem visualizar a avaliação da outra antes do momento previsto.
- Implementar matriz versionada com estados A, AP, NA, NSA e D, cada qual acompanhado de justificativa, observação e evidência conforme a regra aprovada.
- Avaliar dimensões: coordenação; corpo docente; proposta pedagógica; organização curricular; formato/carga horária; ingresso/avaliação/certificação; práticas supervisionadas; dimensão ético-política; acessibilidade e democratização.
- Associar evidência e documento a cada critério; produzir síntese por dimensão, pontos fortes, fragilidades, inconsistências e itens para diligência.
- Emitir parecer preliminar individual fundamentado.
- Consolidar a dupla, comparar critérios e pareceres e destacar divergências relevantes.
- Encaminhar divergência substancial para terceira avaliação conforme parâmetro institucional versionado.
- Gerar parecer técnico padronizado com documentos analisados, síntese, pontos fortes, fragilidades, diligências e conclusão.
- Registrar responsáveis, datas, assinaturas e versão final do parecer, preservando todas as versões.

### 8. Diligências e comunicação com a instituição

- Criar diligência formal com itens, justificativas, documentos/esclarecimentos solicitados, responsável, prazo e estado.
- Permitir resposta institucional, anexos, correções e histórico de envio/recebimento.
- Suportar múltiplos ciclos de diligência e análise sem descartar pareceres, documentos ou respostas anteriores.
- Suspender automaticamente o prazo aplicável enquanto aguarda resposta, segundo regra aprovada, e retomá-lo após o evento configurado.
- Enviar e registrar comunicações institucionais com destinatário, conteúdo, horário, entrega e ciência quando disponível.
- Reunir mensagens relacionadas ao processo numa central de comunicações consultável por participantes autorizados.

### 9. Deliberação, decisão, devolutiva e recurso

- Restringir deliberação institucional a instâncias e pessoas autorizadas; consolidar pareceres, votação/quórum e decisão oficial.
- Suportar deferimento, deferimento com recomendações/condicionantes, diligência e indeferimento, de acordo com o edital aplicável.
- Registrar fundamento, votos, responsáveis, data, condicionantes, prazo, motivo de indeferimento e evidências consideradas.
- Emitir devolutiva pedagógica para diligências e indeferimentos, apoiando adequação e reapresentação sem alterar decisões anteriores.
- Comunicar oficialmente o resultado e guardar prova de envio/ciência.
- Publicar somente informações autorizadas; separar a decisão interna da projeção pública.
- Receber recurso com fundamento, anexos, protocolo e prazo; validar admissibilidade antes da análise.
- Registrar decisão recursal de manutenção, reforma ou ajuste, com fundamentação, responsáveis, comunicação e vínculo à decisão original.

### 10. Acreditação, selo e consulta pública

- Gerar documento de concessão preenchido, com objeto, escopo, validade e autorização do selo.
- Definir escopo exato por curso, modalidade, turmas/edições e condições aprovadas.
- Controlar validade, início/fim, vigência, suspensão, cancelamento, expiração e renovação.
- Emitir somente selo oficial autorizado; administrar versões para formatos de impressão e uso digital.
- Vincular cada selo ao processo, objeto, escopo e validade.
- Gerar QR Code/código público e consulta oficial com instituição, curso, processo, modalidade, escopo, situação e validade permitidos para divulgação.
- Relacionar turmas/edições autorizadas e registrar materiais, períodos e restrições de uso do selo.
- Registrar suspeita/ocorrência de uso irregular e medidas: advertência, correção, retirada, suspensão, cancelamento ou impedimento, mediante competência e regra aprovadas.

### 11. Pós-acreditação e casos excepcionais

- Receber comunicação de mudança em coordenação, docentes, carga horária, modalidade, matriz ou certificação.
- Analisar se a alteração é atualização cadastral ou exige revisão/reabertura, guardando decisão e justificativa.
- Acompanhar recomendações, prazos e evidências de adequação.
- Abrir renovação vinculada à acreditação anterior, com dados/documentos atualizados e reavaliação.
- Registrar casos omissos, instrução, responsáveis e deliberação institucional.

### 12. Editais, regras e documentos normativos

- Cadastrar editais de acreditação e de seleção, vigência, documentos e responsáveis.
- Versionar regras, parâmetros, matriz, edital, regulamentos e documentos norteadores; cada processo mantém referências imutáveis às versões aplicáveis.
- Administrar parâmetros sem alterar código, mantendo histórico de vigência e autor da mudança.
- Organizar documentos normativos por categoria, versão, publicação e vigência.
- Administrar modelos de parecer, diligência, concessão, certificado, comunicações e resultado.
- Gerar PDFs preenchidos a partir dos dados e modelos aprovados, com versão e trilha de geração.
- Suportar assinatura eletrônica institucional e armazenamento do documento assinado; integrar Gov.br apenas após definir viabilidade e fluxo autorizados.

### 13. Painéis, pesquisa e relatórios

- Dashboard administrativo: inscrições, processos por etapa, diligências, prazos, decisões e acreditações vigentes.
- Dashboard da acreditadora: processos atribuídos, prazos, pendências, matrizes e histórico individual autorizado.
- Dashboard da instituição: solicitações, pendências, diligências, documentos, decisões, recursos, acreditações e renovações.
- Pesquisa e filtros por processo, instituição, curso, estado, modalidade, status, período, acreditadora e outros campos autorizados.
- Relatórios por região, modalidade, resultado, duração, diligências, distribuição e atuação de acreditadoras.
- Indicadores regionais e diversidade sem exposição pessoal desnecessária.
- Exportações autorizadas em PDF/planilha, registrando usuário, escopo e momento da exportação.

### 14. Auditoria, privacidade e continuidade

- Registrar quem visualizou, criou, alterou, distribuiu, avaliou, decidiu, publicou, exportou ou compartilhou dados e documentos.
- Manter decisões, matrizes, pareceres, protocolos e documentos finalizados em histórico append-only, com integridade verificável.
- Autorizar documento sensível por papel, participação e processo; negar acesso por padrão.
- Registrar e investigar incidentes de privacidade, acessos e compartilhamentos indevidos.
- Configurar retenção por categoria e finalidade, incluindo procedimento de bloqueio, descarte e preservação legal, com validação institucional.
- Planejar backup e recuperação de banco, documentos e trilhas; testar restauração e registrar resultado.
- Aplicar controles contra download/compartilhamento indevido quando tecnicamente possível, sem prometer impedir captura externa da tela.
- Permitir estatísticas operacionais com minimização e agregação de dados pessoais.

### 15. Portal e configuração institucional

- Página pública com edital vigente, regras, orientações, documentos, consulta de acreditações e início de solicitação.
- Central de ajuda contextual para cadastro, envio documental, diligências, recursos e consulta de status.
- Configuração da FENADOULASBR: dados, instâncias responsáveis, contatos, identidade visual, assinaturas e textos oficiais.
- Configurar competências de Diretoria, GT e demais instâncias para triagem, avaliação, deliberação, recursos e casos omissos.
- Garantir que todo conteúdo público seja explicitamente autorizado e que dados privados permaneçam fora da página pública.

## Sequência recomendada para reduzir risco e facilitar testes

1. **Fundação e governança:** perfis, escopos, segurança por processo, parâmetros versionados e auditoria mínima.
2. **Cadastro e solicitação:** instituição/coletivo, representante, curso, oferta formativa, documentos e protocolo.
3. **Triagem e cegamento:** admissibilidade, correções preliminares, classificação documental e teste de remoção de identificadores.
4. **Acreditadoras:** candidatura, habilitação, termos, conflitos, distribuição, aceite e substituição.
5. **Avaliação:** matriz versionada, duas análises independentes, evidências, consolidação e terceira análise.
6. **Diligência e decisão:** prazos, resposta institucional, ciclos, deliberação, resultado, devolutiva e recurso.
7. **Concessão e consulta:** documento, escopo, validade, selo, QR Code e página de verificação.
8. **Pós-acreditação:** alterações, condicionantes, suspensão/cancelamento, renovação e casos omissos.
9. **Operação institucional:** dashboards, relatórios, notificações, exportações, retenção, incidentes e restauração de backup.
10. **Portal público:** publicar apenas após validar autorização, privacidade, conteúdo e operação das jornadas anteriores.

## Critérios gerais de aceite

- Uma submissão completa gera protocolo único e snapshot reproduzível das regras e documentos submetidos.
- Instituição, representantes, acreditadoras e administração veem somente dados permitidos por perfil e vínculo com o processo.
- A versão de análise cegada não contém identificadores proibidos, inclusive em arquivos e metadados, e não altera o original.
- Duas avaliações são independentes, auditáveis e comparáveis; divergências seguem a regra vigente.
- Diligências mantêm ciclos, prazos, versões e respostas; decisões finais não são sobrescritas.
- Decisão, concessão, selo e consulta pública refletem o escopo e a validade aprovados.
- Relatórios e comunicações respeitam permissões e deixam registro de auditoria.
- Restauração de backup recupera processo, documentos, versões e trilhas conforme política validada.

## Pontos que exigem decisão institucional antes de produção

- Parâmetros de carga horária, percentuais, estados e prazos de cada edital vigente.
- Quórum, forma de assinatura, competências e tratamento de divergência/terceira avaliação.
- Critérios exatos de cegamento, publicação e consulta pública.
- Retenção, descarte, bloqueio legal e tratamento de solicitações de titulares.
- Modelos oficiais, canal de ciência, assinatura eletrônica e integração externa.
- Regras de validade, escopo, renovação, uso e sanções relativas ao selo.

## Fontes de requisitos recebidas

- `6. Fluxo do SAFDOULA.pdf`.
- `SAFDOULA_Processo_Ficticio_001_CEGADO_COMPLETO.docx` e `SAFDOULA_Processo_Ficticio_002_CEGADO_COMPLETO.docx`.
- `2. Regulamento interno das acreditadoras.pdf`.
- `Cópia de 8. Parecer de Acreditadores.docx` e `Cópia de 7. Matriz Avaliativa Cegada .docx`.
- `1. Edital de chamamento para acreditadores Nº 01_2026 – FENADOULASBR.docx.pdf`.
- `3. TERMO DE COMPROMISSO ÉTICO, SIGILO, IMPARCIALIDADE E DECLARAÇÃO DE CONFLITO DE INTERESSES.pdf`.
- `8. Formulário de Solicitação de Acreditação.pdf`.
- `10. MANUAL DE USO DO SELO DE ACREDITAÇÃO FENADOULASBR .pdf`.
- `9. MODELO DE DOCUMENTO DE CONCESSÃO DA ACREDITAÇÃO.pdf`.
- `DOC_NORTEADOR_2026 .pdf` e `4. Edital de Acreditação dos Cursos.pdf`.

Os arquivos listados são fontes normativas e exemplos para validação dos requisitos. A presença deles nesta lista não significa que foram interpretados como autorização para definir políticas ou parâmetros ainda não aprovados.
