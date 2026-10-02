# Calendar Workspace e providers

O Calendar Workspace é uma capacidade do Orbit, não uma tela específica de provider. Ele agrega `CalendarItem` normalizado através do `CalendarSourceRegistry`. O provider interno `orbit_cards` expõe Cards com `schedule`; os plugins `google_calendar` e `outlook_calendar` implementam o mesmo contrato. Views de mês, semana, dia, agenda e timeline consultam o mesmo endpoint e o mesmo mirror.

## Modelo

- `integration_connections`: contas de providers e credenciais cifradas no backend.
- `calendar_sources`: calendários descobertos e suas preferências de seleção, visibilidade e default.
- `calendar_items`: mirror normalizado de eventos; a UI não consulta Google ao renderizar.
- `external_resources`: vínculo genérico entre um recurso externo e uma entidade Orbit.
- `calendar_sync_states`: cursor incremental por fonte.
- `calendar_watch_channels`: canal, resource ID, segredo cifrado e expiração.
- `calendar_source_settings`: regras opcionais de espelho evento → Card.

Campos de workflow continuam sob autoridade do Orbit. Agenda, recorrência, convidados, local e conferência continuam sob autoridade do provider. Título e descrição só são propagados quando a configuração explícita da fonte permite. `operation_id`, `etag`, timestamps e o cursor incremental evitam loops e trabalho repetido.

## Google Calendar

Configure `ORBIT_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` e `API_PUBLIC_URL`. Para notificações push, `GOOGLE_CALENDAR_WEBHOOK_URL` deve ser uma URL HTTPS pública para `POST /calendar/google/webhook`.

O OAuth usa state de uso único com expiração e solicita acesso offline. Access e refresh tokens ficam cifrados no banco e nunca são retornados pela API. Cada autorização cria ou atualiza uma connection; não há limite fixo de connections ou calendários.

Após OAuth, o plugin usa CalendarList, cria fontes normalizadas e sincroniza as selecionadas. O primeiro sync pagina eventos e guarda `nextSyncToken`; os seguintes usam o cursor. Uma resposta 410 apaga somente o cursor da fonte e executa full sync controlado. CalendarList também usa cursor e a mesma recuperação. O webhook apenas valida o canal e agenda o sync incremental. Canais são renovados antes de expirar e o anterior é interrompido quando possível.

## Cards e integração com cartões

Cards possuem agenda opcional independente de início/vencimento. Eventos podem criar Cards ou vincular Cards existentes via `ExternalResource`. Auto-mirror é desligado por padrão e configurado por calendário, incluindo Board/List, atualização, cancelamento e estratégia de recorrência.

O plugin publica actions normalizadas no manifest. Eventos sincronizados são convertidos para `CalendarItem`; o payload bruto do Google não é exposto à interface.

## Microsoft 365

Outlook Calendar é outro provider do mesmo registry e compartilha uma conexão Microsoft com Teams e Outlook Mail. A UI e o Card não conhecem IDs ou payloads do Graph. Consulte [Microsoft 365](integrations/microsoft.md) para configuração, delta sync, subscriptions, disponibilidade e Teams.
