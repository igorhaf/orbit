# Integrações e conteúdo de demonstração

## Objetivo e limites

Este pacote usa dados sintéticos para exercitar os contratos de integração do Suindá sem contas institucionais, credenciais reais, serviços externos ou gravações no banco do preview. As respostas são fixtures mantidas pelas specs; o pacote não cria credenciais falsas no cofre nem simula uma aprovação institucional.

Executar a partir da raiz `app`:

```sh
npm run test:suinda:demo:list
npm run test:suinda:demo
```

O primeiro comando só valida o mapa dos IDs e lista cenários. O segundo executa as specs unitárias selecionadas, uma por vez. O runner exige correspondência exata entre os 41 IDs `C` da [auditoria de requisitos](./AUDITORIA-BULLETS-2026-10-25.md) e este mapa, verifica que todos os arquivos existem em `apps/api/src`, recusa specs de navegador/integração e inicia o processo com ambiente mínimo, sem herdar credenciais, URLs de banco ou carregar `.env`.

## Matriz sintética

| Requisitos | Cenário e dados de exemplo | Specs locais |
| --- | --- | --- |
| `1.3` | Descoberta OIDC e rotas de callback sob o guard; ainda não há callback completo de IdP fake neste pacote. | `access/access.spec.ts` |
| `1.4–1.6`, `17.6`, `32.10` | Convites, confirmação, recuperação, MFA, modelos e mensagens capturadas por mailer de fixture, incluindo falha de envio. | `access/auth-lifecycle.spec.ts`, `mail/mail.spec.ts`, `plugins/workspace-email-templates.spec.ts` |
| `5.9`, `32.7` | Arquivo Drive/Picker e anexos de aula sintéticos; política de acesso, MIME e integração com mídia são exercitados sem selecionar arquivo real. | `plugins/suinda-google-drive.spec.ts`, `google/backup.spec.ts`, `plugins/suinda/suinda.spec.ts` |
| `6.2`, `32.3` | Evento Google Calendar/Meet com conta e reunião de exemplo; criação repetida verifica idempotência. | `calendar/calendar.spec.ts`, `plugins/suinda/suinda-calendar.provider.spec.ts`, `plugins/suinda/suinda.spec.ts` |
| `6.3`, `32.4` | OAuth, reunião, participantes e reconciliação Zoom usando respostas controladas pelo teste. | `zoom/zoom-meetings.spec.ts` |
| `6.4`, `32.5` | Eventos Outlook/Teams, páginas delta, assinaturas e tokens Graph sintéticos. | `calendar/microsoft-calendar.spec.ts` |
| `6.5` | Relatórios Meet/Teams com registros e participantes de exemplo; identidades ambíguas ou fora do escopo não são associadas. | `google/meet-attendance.spec.ts`, `calendar/microsoft-teams-attendance.spec.ts`, `plugins/suinda/suinda.spec.ts` |
| `12.4` | Saltos, checkpoints, posição assistida e falhas simuladas do player. | `plugins/suinda/suinda.spec.ts` |
| `13.4` | PDF assinado com PKCS#12 e cadeia de teste, incluindo certificado que não pode assinar. | `plugins/suinda-certificate-signing.spec.ts` |
| `15.6–15.10`, `32.11` | Checkout, aprovação/recusa, negociação, assinatura e notificações de pagamento com referências de exemplo. | `plugins/suinda/mercado-pago.spec.ts`, `plugins/suinda/mercado-pago-settlement.spec.ts`, `plugins/suinda/finance.spec.ts`, `plugins/suinda-financial-negotiation.spec.ts`, `plugins/suinda-subscriptions.spec.ts` |
| `17.7`, `32.9` | Consentimento, template permitido/recusado, opt-out e idempotência da entrega WhatsApp. | `plugins/suinda-whatsapp.spec.ts` |
| `17.8` | Chaves VAPID efêmeras e sender interceptado; envio, expiração e ausência de configuração sem push real. | `plugins/notifications.spec.ts` |
| `21.11`, `32.6` | Sincronização de calendário, recorrência, cursor expirado e eventos com datas/zonas de exemplo. | `calendar/calendar.spec.ts`, `calendar/microsoft-calendar.spec.ts`, `plugins/suinda/suinda-calendar.provider.spec.ts` |
| `29.3` | Host e URLs permitidos/rejeitados em configuração; a fixture não representa DNS nem certificado público válidos. | `env-settings.spec.ts`, `workspaces/workspace-branding.spec.ts` |
| `30.6–30.7` | Pedido de privacidade com titular sintético, mapa incompleto e decisão explícita; caminhos não autorizados falham fechados. | `plugins/suinda/suinda-privacy.spec.ts` |
| `32.2` | Payload de webhook assinado, repetição, falha e URL de destino insegura. | `plugins/webhooks.spec.ts`, `plugins/suinda/domain-webhook-events.spec.ts` |
| `32.12` | Arquivo de liquidação de exemplo com tarifas, estornos e chargebacks; linha ambígua não muda saldo. | `plugins/suinda/mercado-pago-settlement.spec.ts`, `plugins/suinda-accounting.spec.ts`, `plugins/financial-reconciliation-csv.spec.ts` |
| `32.13` | Upsert/delete e retirada de consentimento via contrato CRM vendor-neutral. | `plugins/suinda-crm.spec.ts` |
| `32.14` | Contas e lote diário ERP sintéticos; validação de equilíbrio, reenvio e trilha imutável. | `plugins/suinda-accounting.spec.ts` |
| `32.16` | Rotas OIDC, conta Orbit existente e limites de autenticação de fixture; sem tenant SSO real. | `access/access.spec.ts`, `access/auth-lifecycle.spec.ts` |
| `33.15–33.19` | Catálogo elegível, RAG por matrícula, revisão docente, embeddings e transcrição sintéticos. | `plugins/suinda/learning-assistant.spec.ts`, `plugins/ai/knowledge-retrieval.spec.ts`, `plugins/suinda/suinda-transcription.spec.ts` |

As duas specs adicionais do runner cobrem regras do auditor editorial e a emissão Open Badges offline: `plugins/suinda/accessibility-audit.spec.ts` e `plugins/suinda-open-badges.spec.ts`. Elas dão exemplos reproduzíveis para os requisitos parciais `31.9` e `32.15`, mas não transformam esses itens em completos.

## Cobertura que permanece fora da simulação

- `1.3` e `32.16`: discovery e guardas são cobertos; ainda falta uma jornada completa de callback OIDC com provedor local falso, troca de token, `iss`/`aud`, nonce e vinculação da conta.
- `29.3`: testar parsing/allowlist local não comprova propriedade de domínio, DNS, TLS público, cookies nem roteamento externo.
- `31.9`: fixtures editoriais não substituem conteúdo de curso representativo fornecido pela instituição nem revisão assistiva independente.
- `32.15`: assinatura, esquema, JWKS e status list são validados offline; a suíte 1EdTech hosted, URL HTTPS pública, demonstração e aprovação institucional ficam pendentes.
- Nos demais conectores, o resultado prova comportamento do contrato diante de dados sintéticos. Não prova disponibilidade, permissões, limites, entrega ou certificação de Google, Microsoft, Zoom, Meta, gateway, CRM, ERP, SMTP, VAPID ou provedor de IA.

Para conteúdo acadêmico demo persistente e navegável, não execute `npm run db:seed`: ele cria/atualiza uma conta ROOT real do Orbit e não é um seed Suindá. Use o harness de integração, que cria um schema temporário e o remove no fim (`npm run test:integration:suinda`). Nenhum comando deste documento semeia o banco do preview.
