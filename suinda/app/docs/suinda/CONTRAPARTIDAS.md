# Acompanhamento de contrapartidas de bolsas

O Suindá acompanha as contrapartidas textuais configuradas pela instituição em um programa de bolsas. A gestão pode registrar até 50 exigências, cada uma com até 2.000 caracteres. Ao enviar uma candidatura, o sistema fixa as exigências da revisão do programa junto aos termos aceitos. Quando a candidatura chega ao estado aprovado, cria uma tarefa para cada exigência fixada, ligada à candidatura, à matrícula, ao titular e à revisão exata do programa.

O estudante titular acompanha suas tarefas em **Contrapartidas**, envia um relato e/ou comprovantes PDF, PNG ou JPEG, e consulta o parecer da coordenação. O pacote vigente aceita até dez arquivos e 8 MB no total. Ao complementar, os anexos anteriores são preservados e os novos são acrescentados ao pacote, sem exceder esses limites. Os anexos passam pelo scanner configurado e ficam privados, acessíveis ao titular e à gestão acadêmica autorizada no workspace ou com a permissão global de gestão. A interface permite reenviar após um pedido de complemento.

Cada envio e parecer cria uma revisão auditável. A gestão acadêmica consulta as tarefas no painel Suindá, baixa os anexos e escolhe **Aceitar evidências** ou **Solicitar complemento**. Solicitar complemento exige orientação textual. O fluxo de estados é `pendente → enviada para revisão → aceita` ou `pendente → enviada para revisão → complemento solicitado → enviada para revisão`. Uma tarefa aceita é terminal; para corrigir uma decisão, a instituição deve usar seu processo administrativo fora deste fluxo.

As rotas de leitura e envio são vinculadas à conta autenticada e o serviço confirma novamente o titular da tarefa. A rota de revisão exige `plugin.suinda-learning.manage` e o serviço valida também o workspace da tarefa. A autorização de anexos reutiliza a política de leitura do registro. Revisões concorrentes usam a revisão esperada e falham com conflito se outro envio ou parecer tiver sido salvo primeiro.

## Limites atuais

- A plataforma registra o texto definido pela instituição e as evidências enviadas; não cria rubricas socioeconômicas, critérios de classificação nem pontuação para contrapartidas.
- O aceite registra a revisão da evidência por pessoa com permissão de gestão; não determina automaticamente elegibilidade, cumprimento legal ou concessão de benefício adicional.
- O fluxo não configura prazos, lembretes, penalidades, escalonamentos ou chamadas automáticas de lista de espera.
- Candidaturas já aprovadas antes deste recurso não são reconstruídas retroativamente. Não se inferem exigências históricas; elas devem estar presentes no snapshot da candidatura para gerar tarefas.
- Programa sem exigências textuais configuradas não gera tarefas de contrapartida.
- As regras de elegibilidade e eventual pontuação de candidatura existentes continuam sendo decisões da instituição e não são modificadas por este acompanhamento.
- A lista de gestão mostra até 500 registros elegíveis por consulta; a consulta fica restrita aos workspaces que o usuário pode administrar e aos titulares/matrículas vinculados às candidaturas aprovadas.
- O acompanhamento não retroage para candidaturas que não tenham o snapshot de exigências. O texto histórico não muda quando a instituição edita uma revisão posterior do programa.
