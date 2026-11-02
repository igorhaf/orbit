# Integração de aulas ao vivo

## Escopo

O plugin acadêmico mantém o encontro e sua frequência. A coleta autenticada de relatórios fica em adaptadores reutilizáveis do Orbit:

- Google Meet: `apps/api/src/google/meet-attendance.ts`;
- Microsoft Teams: `apps/api/src/calendar/microsoft-teams-attendance.ts`;
- Zoom: `apps/api/src/zoom/zoom-meetings.ts`.

`SuindaLearningService` consome esses adaptadores sem alterar os fluxos comuns de frequência manual, QR Code ou chamada docente. Ao criar uma sala, o registro versionado da sessão mantém o provedor, link, proprietário e conexão que geraram a reunião. A sincronização autenticada usa `POST /extensions/suinda-learning/me/teaching/sessions/{sessionId}/attendance/{google-meet|teams}-sync`; Zoom mantém a rota `/attendance/zoom-sync`.

## Regras de associação

1. A sessão precisa estar encerrada, ser online/híbrida e pertencer à revisão curricular atual da turma.
2. O docente precisa estar atribuído à sessão, turma ou curso, ou ter permissão de escrita/gestão acadêmica no workspace.
3. O relatório deve pertencer à conexão organizadora vinculada, apontar para a reunião exata e coincidir com o horário agendado dentro da tolerância validada pelo adaptador.
4. Só se associa uma pessoa quando o e-mail informado pelo provedor corresponde a uma única matrícula ativa da turma e revisão. Nome, código de reunião e semelhança de texto não servem como prova de identidade.
5. Intervalos são limitados à janela da sessão e somados por matrícula. E-mail ausente/ambíguo ou intervalo inválido não produz presença automática; a resposta e a trilha de auditoria registram quantas identidades precisam de revisão.
6. Uma chamada já registrada nunca é sobrescrita por sincronização. A chave sessão+m matrícula torna a importação idempotente; retentativas preservam a frequência anterior.
7. A ausência de uma pessoa no relatório não cria falta. A chamada docente continua disponível para registrar ou revisar faltas e identidades pendentes.

## Consentimento e configuração do provedor

- **Google Meet:** habilite a Google Meet REST API e reconecte a conta organizadora pela ação **Conceder permissão de presença**, que solicita `https://www.googleapis.com/auth/meetings.space.readonly`. O escopo é aditivo e não é pedido no OAuth padrão do Google Calendar. A conta precisa ter organizado a conferência para que `conferenceRecords.list` a encontre.
- **Microsoft Teams:** reconecte a conta corporativa/escolar pela mesma ação. Além de `OnlineMeetings.ReadWrite`, o OAuth solicita `OnlineMeetingArtifact.Read.All`. A Microsoft pode exigir consentimento de administrador no tenant. Contas Microsoft pessoais não são aceitas.
- **Zoom:** permanece necessária uma conexão OAuth Zoom ativa com os escopos de criação/leitura de reuniões configurados na documentação do produto.

As conexões continuam usando o armazenamento criptografado já mantido pelo Orbit. Falha de escopo, autorização, API, paginação, conferência ambígua ou relatório incompleto interrompe a importação sem alterar frequência. O suporte atual cobre reuniões não canal do Teams criadas pelo organizador vinculado e conferências Meet localizáveis pela conta organizadora. Links informados manualmente sem conexão/organizador associado não são sincronizados.

## Evidências de validação

- Testes unitários dos adaptadores validam paginação, identidade exata, tolerância de horário, escopos e falha segura para relatórios indisponíveis/incompletos.
- Testes do serviço validam vínculo Google Meet à sessão/conexão, associação por e-mail único, idempotência e preservação de chamada docente.
- Testes existentes cobrem Zoom e permissões de rota; o teste do helper comum cobre intervalos múltiplos, identidade ambígua e limitação ao período.
- `npm run build --workspace apps/api` executa lint e TypeScript; `npm run build --workspace apps/web` valida a interface e a geração das páginas.

Os testes usam respostas simuladas. A verificação com contas e tenants reais depende das credenciais OAuth, do consentimento e da habilitação das APIs na instituição.
