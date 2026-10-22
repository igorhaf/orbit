# Inventário atual do Orbit e do SafDoulas

Revisado em 21/10/2026 após inspeção do código e validação de integração.
O inventário inicial antecedia a implementação; sua afirmação de ausência dos módulos ficou desatualizada.

## Infraestrutura compartilhada do Orbit

RBAC e root, workspaces, registros versionados, documentos e arquivos, referências, parâmetros, termos e aceites, matrizes de avaliação, formulários, processos, prazos, auditoria, notificações e backups continuam genéricos.
Os dados e as regras institucionais da FENADOULASBR ficam exclusivamente na instância/branch SafDoulas.
Permissões de criação e de transição declaradas pelos plugins são verificadas pelo motor de registros.
Formulários publicados podem ser consultados sem tornar públicas suas respostas.
Originais e cópias documentais exigem autorização individual; publicar uma cópia cegada continua exigindo revisão independente.
Estados finais preservam o conteúdo e admitem somente transições de ciclo de vida declaradas pelo plugin, como retirada de publicação ou substituição de norma.

## Plugins de produto implementados

| Plugin | Responsabilidade |
|---|---|
| safdoulas-governance | Fontes normativas preservadas, editais, regras, parâmetros, políticas e modelos versionados. |
| safdoulas-registry | Dados documentais da formadora, curso avaliado, ofertas abrangidas, equipe, matriz curricular e práticas declaradas. |
| safdoulas-processes | Protocolo e fluxo com snapshots de formulário, curso, currículo, documentos e regras. |
| safdoulas-triage | Admissibilidade por requisito e evidência, incluindo complementação preliminar. |
| safdoulas-accreditors | Candidaturas, homologação, alinhamento comprovado, habilitação, termos, conflitos, validade e disponibilidade. |
| safdoulas-blinding | Relação entre original, cópia cegada e revisão independente segundo a política fixada. |
| safdoulas-assessments | Dupla independente, matriz, evidências, pareceres, comparação e terceira avaliação. |
| safdoulas-diligences | Pedidos e respostas em ciclos, comunicações e integração com prazos. |
| safdoulas-decisions | Votos individuais, decisão colegiada, recurso e resultado recursal sem substituir a decisão original. |
| safdoulas-accreditation | Concessão, minuta PDF, documento assinado, selo oficial, consulta, acompanhamento e renovação. |
| safdoulas-reporting | Painéis por acesso, pesquisa e exportação de indicadores. |
| safdoulas-data-protection | Retenção parametrizada, preservação legal, destinação documentada e incidentes. |
| safdoulas-public-portal | Editais, orientações e consulta pública mediante publicação autorizada. |
| safdoulas-casework | Central da jornada, pasta do processo, conferência dos requisitos e dossiê exportável. |

## Limites de validação

A jornada de integração usa banco descartável, os 13 originais fornecidos, duas acreditadoras sem root e documentos fictícios para simular a concessão.
O teste demonstra o funcionamento do percurso e de seus controles de acesso; não representa concessão real, assinatura válida, homologação institucional ou aprovação do MEC.
A validação visual em navegador não foi executada, respeitando a proibição de Selenium neste host.
Assinatura e ciência externas dependem dos documentos/comprovantes enviados; entrega SMTP e abertura de página não são tratadas como assinatura institucional.
