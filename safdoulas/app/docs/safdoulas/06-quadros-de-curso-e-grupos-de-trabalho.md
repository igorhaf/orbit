# Quadros de curso, modelos e grupos de trabalho

## Organização implementada

Cada processo de acreditação de curso possui um quadro nativo próprio. O nome vem do curso versionado vinculado ao processo. Criar ou abrir novamente um curso com processo aberto reutiliza o mesmo quadro; não duplica a solicitação.

A opção **Criar → Novo quadro de curso** pede o espaço, o curso ativo e as regras ativas. O cadastro da formadora/curso e o edital continuam nos plugins existentes. Esta opção não reativa a criação livre de projetos ou quadros.

O quadro possui nove fases fixas: preparar solicitação, protocolar, conferir documentação, avaliar, complementar evidências, deliberar, comunicar e conceder, examinar recurso e acompanhar e renovar. Diligências e recursos são condicionais: uma lista vazia não representa uma etapa obrigatória. A posição do cartão principal acompanha o estado formal; mover uma atividade não muda esse estado.

No espaço antes ocupado por Coleções, **Modelos** oferece preparação do dossiê, conferência documental, acompanhamento de avaliações, reunião do GT, diligência, comunicação/concessão, recurso e acompanhamento. Cada uso gera um cartão nativo independente com descrição, checklist, fase e vínculo hierárquico com o cartão principal do curso. No celular, os modelos ficam no próprio cabeçalho do quadro.

Comentários, anexos, responsáveis, datas, calendário e checklist são os recursos existentes do Orbit. As evidências, pareceres, decisões, assinaturas e concessões continuam nos respectivos registros versionados; concluir tarefas não concede acreditação. O cartão principal oferece **Registro e transições** e **Dossiê e registros relacionados**.

As listas e o escopo são administrados pelo plugin. Transferências que misturem cursos e a criação livre de fases ficam bloqueadas também pela API. Os quadros só aparecem para quem pode acessar o processo e a identidade original do curso; acesso a material cegado não autoriza acesso ao quadro identificado.

## Onde o GT está documentado

Referências conferidas nos arquivos originais enviados; páginas do PDF, contando a primeira página como 1.

| Fonte | Localização | O que fundamenta |
| --- | --- | --- |
| Regulamento interno das acreditadoras | p. 2, art. 3º e parágrafos | Participação no GT não substitui a habilitação como acreditadora e não é requisito obrigatório para candidatura. |
| Regulamento interno das acreditadoras | p. 4, art. 5º | Apoio do GT ou instância designada à formação e ao alinhamento. |
| Regulamento interno das acreditadoras | p. 8, art. 10 | Encaminhamento de dúvidas sobre suspeição e impedimento à coordenação do GT ou instância competente. |
| Regulamento interno das acreditadoras | p. 9, art. 13 | Construção de parâmetros pelo GT, com aprovação pelas instâncias competentes. |
| Regulamento interno das acreditadoras | p. 10, art. 14 | Decisão institucional não monocrática; observar pareceres e a forma de deliberação definida pelas instâncias previstas. |
| Regulamento interno das acreditadoras | p. 12, art. 20 | Tratamento de casos omissos pelo GT, Diretoria e demais instâncias competentes. |
| Edital de Acreditação dos Cursos | p. 5, item 10.2 | Acesso restrito de membros autorizados do GT, acreditadoras e instâncias diretamente envolvidas. |
| Edital de Acreditação dos Cursos | p. 8, itens 12.1 e 12.2 | Análise por acreditadoras habilitadas no âmbito do GT, com sigilo e imparcialidade. |
| Edital de Acreditação dos Cursos | p. 12, item 19.3 | Tratamento institucional de casos omissos. |
| Documento norteador 2026 | p. 1 | Identificação do GT de Formação. |

Os documentos fundamentam o **GT institucional**. Não foi encontrada nesses trechos uma determinação de criar vários GTs formais por curso, com composição ou poderes próprios. Essa possibilidade veio da PO como requisito de organização do trabalho.

Para esse uso operacional, um curso pode ter várias atividades do modelo **Reunião de trabalho do GT**, cada uma com responsáveis, pauta, data, ata e encaminhamentos. Isso permite equipes diferentes sem duplicar o curso, sem criar nova autoridade institucional e sem conceder permissões automaticamente. Qualificação, conflitos de interesse, acesso a documentos cegados e poderes de decisão continuam separados no RBAC e nos plugins formais.

## Limites da validação

Verificações de API, testes e builds estão registradas no relatório da execução. Validação visual em navegador permanece pendente: Selenium e outros navegadores automatizados não estão autorizados neste host.
