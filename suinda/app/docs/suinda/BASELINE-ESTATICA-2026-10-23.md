# Baseline estático de requisitos do Suindá

Revisão de código em 23/10/2026 sobre os 403 bullets de [ESPECIFICACAO.md](./ESPECIFICACAO.md). A classificação foi feita por inspeção estática da implementação e não comprova que cada fluxo passou em testes, esteja ativo na instância ou tenha credenciais externas configuradas. Itens compostos foram marcados como parciais quando só parte do comportamento existe. O resultado serve para estimar o trabalho restante e priorizar correções; não autoriza declarar o sistema concluído.

**I — implementação localizada:** há código para a capacidade descrita. **P — parcial:** há código, mas parte material do requisito permanece ausente. **D — depende de ativação:** há suporte no Orbit/Suindá, mas é necessária configuração, credencial, dado institucional ou serviço externo. **N — não localizado:** a implementação necessária não foi encontrada, ou o código existente só registra um dado e não executa o comportamento pedido.

## Contagem

| Status | Requisitos | Interpretação para conclusão |
| --- | ---: | --- |
| I | 330 | Implementação localizada; ainda sujeita à validação funcional e de ponta a ponta. |
| P | 31 | Ainda exige implementação para satisfazer o requisito completo. |
| D | 11 | Ainda exige configurar/ativar e verificar a dependência. |
| N | 31 | Exige implementação ou decisão explícita de escopo. |
| **Total** | **403** | Soma conferida com os bullets da especificação original; esta revisão reclassifica gamificação, biblioteca acadêmica, inadimplência, cancelamento financeiro e suporte parcial a unidades institucionais após inspecionar serviços, interfaces e testes. |

Assim, **73 requisitos não estão completos pelo critério estrito**: 31 parciais, 11 dependentes e 31 sem implementação localizada. Os 330 classificados como I são uma leitura estática do código, não 330 testes aprovados.

## Classificação por área

Os números I/P/D/N são contagens dos bullets na ordem da especificação. A revisão conferiu amostras de código, interfaces e testes e reavaliou a área de gamificação. As contagens de outras áreas permanecem preliminares; itens com suporte genérico do Orbit podem exigir uma revisão semântica específica para comprovar o requisito educacional. A classificação usa inspeção estática, com evidências distribuídas principalmente em `apps/api/src/plugins/suinda/suinda.service.ts`, `suinda.plugin.ts`, `suinda.controller.ts`, nos plugins genéricos do Orbit e nas páginas `/suinda`.

| # | Área | I | P | D | N | Total |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Cadastro, acesso e perfis | 7 | 2 | 3 | 0 | 12 |
| 2 | Gestão de cursos | 15 | 0 | 0 | 0 | 15 |
| 3 | Turmas | 12 | 0 | 0 | 0 | 12 |
| 4 | Estrutura pedagógica | 10 | 0 | 0 | 0 | 10 |
| 5 | Conteúdo educacional | 10 | 2 | 0 | 0 | 12 |
| 6 | Aulas ao vivo | 6 | 1 | 0 | 1 | 8 |
| 7 | Aulas presenciais | 7 | 0 | 1 | 0 | 8 |
| 8 | Frequência | 8 | 0 | 0 | 0 | 8 |
| 9 | Reposição e atividades práticas | 10 | 0 | 0 | 0 | 10 |
| 10 | Avaliações | 14 | 0 | 0 | 0 | 14 |
| 11 | Trabalhos e atividades | 7 | 2 | 0 | 0 | 9 |
| 12 | Progresso do aluno | 10 | 0 | 0 | 0 | 10 |
| 13 | Certificados | 14 | 1 | 0 | 0 | 15 |
| 14 | Inscrições | 12 | 0 | 0 | 0 | 12 |
| 15 | Financeiro | 17 | 0 | 0 | 8 | 25 |
| 16 | Bolsas | 12 | 0 | 0 | 0 | 12 |
| 17 | Comunicação | 11 | 0 | 2 | 1 | 14 |
| 18 | Comunidade e interação | 8 | 1 | 0 | 0 | 9 |
| 19 | Professores, tutores e equipe | 11 | 2 | 0 | 1 | 14 |
| 20 | Documentos | 8 | 3 | 0 | 0 | 11 |
| 21 | Calendário | 9 | 1 | 1 | 1 | 12 |
| 22 | Relatórios e indicadores | 20 | 0 | 0 | 0 | 20 |
| 23 | Dashboard administrativo | 11 | 0 | 0 | 0 | 11 |
| 24 | Dashboard do aluno | 11 | 0 | 0 | 0 | 11 |
| 25 | Dashboard do professor | 10 | 0 | 0 | 0 | 10 |
| 26 | Pesquisa e qualidade | 10 | 0 | 0 | 0 | 10 |
| 27 | Gamificação | 8 | 0 | 0 | 0 | 8 |
| 28 | Busca e descoberta | 9 | 1 | 0 | 0 | 10 |
| 29 | Administração e configurações | 8 | 2 | 0 | 3 | 13 |
| 30 | LGPD e segurança | 13 | 1 | 0 | 0 | 14 |
| 31 | Acessibilidade | 3 | 6 | 0 | 0 | 9 |
| 32 | Integrações | 4 | 0 | 4 | 8 | 16 |
| 33 | Recursos mais avançados | 5 | 6 | 0 | 8 | 19 |
| **Total** |  | **330** | **31** | **11** | **31** | **403** |

## Lacunas de maior impacto identificadas

- **Financeiro:** os meios boleto e gateway têm, no máximo, registro/manual; geração de cobrança, liquidação automática, negociação e renegociação ainda não estão implementadas. PIX/cartão também precisam de fluxo de gateway e confirmação automática. Os descontos/convênios da especificação não têm cobertura suficiente.
- **Aulas ao vivo:** Google Meet, Microsoft Teams e Zoom foram ligados ao fluxo docente. O caminho Zoom agora consulta participantes de reuniões encerradas com `meeting:read`, confere título/janela/ID e faz match por e-mail exato com matrícula ativa na revisão da turma; chamadas existentes são preservadas e casos sem match único ficam pendentes de revisão. A API exige plano Pro ou superior e pode omitir e-mail de convidados externos. A captura Meet/Teams ainda depende dos novos escopos OAuth; gestão de gravações segue manual. Falha ambígua na criação da reunião não repete automaticamente; o docente reconcilia o ID remoto por consulta somente leitura.
- **Aulas presenciais:** não foi localizado bloqueio completo de conflito de horário para a mesma sala.
- **Comunicação e integrações:** WhatsApp, Drive, CRM/ERP e provedores de pagamento/certificação não têm conectores educacionais implementados. Zoom, e-mail, push, Google Calendar e SSO precisam de credenciais/configuração e verificação por instância.
- **Certificados e documentos:** há assinatura eletrônica auditável baseada em declaração do signatário, mas não assinatura criptográfica qualificada/externa. Contratos, regulamentos e termos usam estruturas comuns, sem todos os fluxos especializados da especificação.
- **Gamificação:** pontos, níveis, badges, sequência, metas, ranking opcional e desafios estão presentes no serviço e na interface. Certificados intermediários agora usam marcos explícitos por revisão de curso, emissão idempotente e a mesma validação/PDF dos demais certificados. A métrica de pontos/badges/streak ainda merece cobertura funcional dedicada.
- **Administração avançada:** branding por instituição e domínio operacional seguem ausentes. Há suporte parcial a unidades institucionais: registros versionados de unidade podem ser associados a cursos e turmas, novas matrículas recebem o vínculo versionado, transferências o atualizam mantendo o histórico e unidades publicadas aparecem no catálogo/seletor público. Atualização de 24/10: relatórios agregados filtrados por unidade e gestão de equipe por gestores do workspace foram implementados. As funções fixas de gestor/leitor são grants restritos ao registro da unidade, com concessão/remoção transacional e revogação de sessão. Continua pendente filtrar todas as operações acadêmicas por unidade; multiunidade permanece parcial. Marketplace, afiliados e planos/assinatura seguem ausentes.
- **Acessibilidade:** existem recursos semânticos e responsivos em várias telas, mas falta auditoria integral de teclado/leitor de tela/contraste e verificação em tecnologias assistivas. Não foi executada validação de navegador nesta revisão.
- **Privacidade:** o fluxo de eliminação depende de mapeamentos e decisões por instituição, configuração segura e ledger/restauração; os backfills de cifra não foram executados.

## Correções de classificação aplicadas

Na área financeira, controle e relatório de inadimplência agora são classificados como I: o painel e os relatórios calculam atraso por parcela vencida e saldo descoberto, usando a revisão do curso, a data de inscrição e as baixas registradas; não dependem de um estado `overdue` gravado manualmente. A fila identificada permanece restrita aos gestores autorizados; os relatórios expõem agregados por curso/turma.
O reembolso manual também deixa de ser restrito a matrículas importadas: qualquer matrícula cancelada/desistente pode receber lançamento de devolução vinculado ao pagamento original, sempre limitado ao valor ainda não reembolsado. O cancelamento do saldo pendente de matrícula cancelada também foi implementado como isenção auditada, com justificativa obrigatória e sem contabilização de receita.


Na área 15, “Boleto bancário” foi contado como P porque o sistema registra o método, mas não gera a cobrança; “Integração com gateway de pagamento” foi contado como N porque não foi encontrado adaptador/fluxo de gateway. Um campo de método de pagamento não comprova integração financeira.

Na área 7, o controle de conflitos de sala é I: o validador de sessão usa a chave `suinda-room-schedule:<room-id>` e o serviço genérico de registros adquire um advisory transaction lock antes da leitura, serializando as reservas concorrentes. A geolocalização continua como D porque depende de coordenadas/raio configurados para a sala.

Na área 3, o trancamento é I: a matrícula permite a transição `enrolled/active → paused → active`, o aluno pode pausar e retomar a própria matrícula e os registros pausados continuam reservando vaga e aparecem nos indicadores acadêmicos pertinentes. A operação é versionada e auditada pelo fluxo transacional de matrícula.

Na área 33, foram contados os 19 bullets; o último, “Transcrição e indexação de vídeos”, está como N porque não foi encontrada transcrição/indexação automática.

Antes da conclusão do produto, revisar cada item parcial/dependente/não implementado, vincular evidência funcional e teste de aceitação e repetir a auditoria sobre o estado atual do código.


### Atualização financeira — 23/10/2026

O cancelamento financeiro agora pode ser registrado para matrícula já cancelada/desistente. A coordenação precisa informar a justificativa; o servidor calcula o saldo pendente dentro da transação, grava um lançamento imutável `waiver`, atualiza a situação financeira da matrícula para `waived` e audita a operação. Matrículas ativas não podem usar esse fluxo. A baixa não é recebimento nem reembolso e fica fora das somas de receita; o motivo aparece no histórico do aluno. Isso fecha o requisito de cancelamento financeiro da área 15. A implementação tem teste de serviço e segue sujeita à validação do conjunto completo.


### Atualização incremental — 24/10/2026

A gestão de equipe por unidade foi adicionada na tela de relatórios e nas rotas do plugin Suindá. Gestores do workspace atribuem ou removem membros ativos em funções de gestor ou leitor de relatórios, sem conceder membership ou acesso global. As alterações de grant e versão de sessão são transacionais. Leitores recebem somente relatórios agregados do registro autorizado. Esta atualização não reclassifica os 403 itens da tabela: a contagem acima continua sendo o snapshot auditado em 23/10; a revisão item a item da especificação permanece necessária.

## Atualização incremental — 24/10/2026

A alteração posterior à contagem disponibiliza na área da aprendizagem o link de gravação previamente informado para encontros online concluídos da turma/revisão vinculada à matrícula regular. O link é validado pela interface, e o link da sala não é exposto após a conclusão. O comportamento foi coberto pelo teste de área do aluno. Isso reduz a lacuna de disponibilização manual de gravações, mas não implementa gravação, importação ou publicação automática; a contagem global de 23/10 ainda não foi recalculada.

A aplicação de benefícios financeiros também passou a distinguir promoção, convênio institucional e desconto para associado. Convênio/associação exige parceiro configurado, e o envio da inscrição fixa o tipo e o parceiro junto ao código e aos valores do desconto. A qualificação do beneficiário ainda depende da distribuição controlada do código pela instituição; não existe verificação externa de vínculo com a empresa/associação. A contagem global do baseline não foi recalculada.

O checkout online foi adicionado depois deste snapshot: há criação idempotente de preferências Mercado Pago em BRL, webhook com assinatura HMAC seguida de consulta server-to-server, baixa financeira somente após validação, tela de configuração por workspace no cofre de integrações, checkout na jornada do aluno e uma fila de pagamentos em revisão. A mesma matrícula é serializada contra novas preferências e baixas manuais enquanto o checkout está ativo; a preferência expira em quatro dias. As notificações são deduplicadas por pagamento e estado, permitindo processar a transição de pendente para aprovado. A contagem não foi recalculada. Credenciais, HTTPS público e migração 169 ainda precisam ser aplicados por instância; fluxo real com conta Mercado Pago não foi validado. A fila de revisão informa os pagamentos, mas ainda não oferece reconciliação ou devolução pelo painel Suindá; estornos e chargebacks não são automaticamente espelhados no ledger.
