# Demonstração de acreditação e perfis

A instância SafDoulas utiliza o workspace **SafDoulas — Acreditação**, em `http://localhost:3002/safdoulas/processes`.
A demonstração trata exclusivamente de acreditação documental de cursos, sem aulas virtuais, matrículas ou reconhecimento pelo MEC.

## Registros de referência

Os treze arquivos fornecidos estão preservados com checksum e versão documental.
Onze documentos compõem o catálogo normativo; os dois processos fictícios são referências de teste, sem criar processos adicionais automaticamente.
Foram preparados matriz de nove dimensões/oitenta critérios, dois formulários, políticas de deliberação e cegamento, regra vigente e modelos de concessão e habilitação.
A governança mantém as referências a editais, artigos/seções, critérios e modelos, por versões; as acreditadoras preenchem avaliações sem alterar as regras.
O conjunto normativo anterior supersedido é somente histórico, não a regra vigente.

## Níveis utilizados

| Nível | Responsabilidade |
|---|---|
| Root | Acesso e administração totais; conta pessoal original preservada. |
| Administração técnica | Usuários, perfis e privilégios; não equivale a root nem a decisão institucional. |
| Governança FENADOULASBR | Editais, referências normativas, políticas, matrizes, formulários, modelos e condução institucional. |
| Diretoria | Votos, deliberação, ratificação e consulta de processos e relatórios autorizados. |
| Grupo de Trabalho | Documentação, triagem, preparação de cegamento e acompanhamento da análise; distribuição/habilitação depende da gestão autorizada. |
| Acreditadora | Avaliação atribuída, com documentos cegados e parecer independente; duas contas permitem testar a dupla. |
| Candidata a acreditadora | Candidatura, comprovantes e termos próprios; ainda não realiza avaliações. |
| Instituição/formadora | Seus cadastros e solicitações, com acompanhamento restrito aos processos compartilhados. |
| Representante institucional | Representação da formadora e complementação de seus processos. |
| Observador | Consulta restrita ao processo expressamente compartilhado, sem alterações ou documentos privados. |
| Usuário público | Sem workspace ou processo interno; somente consulta pública admitida pelo portal. |

Papéis técnicos como o acesso cegado por registro são escopos de autorização, não novos níveis pessoais.
Perfis globais não substituem o compartilhamento de registros privados.
As onze novas contas são fictícias; nenhuma foi promovida a root.
Dados descritivos dos perfis permanecem nas preferências das contas, sem senhas no cofre.

## Três exemplos

1. **Raízes do Cuidado**: processo não iniciado, formulário em rascunho e sem protocolo; o próximo passo é enviar a solicitação e vincular sua versão antes de protocolar.
2. **Caminhos do Nascer**: protocolado, com triagem concluída; está na etapa de avaliação, aguardando preparação e distribuição da análise.
3. **Rede Acolher**: duas avaliações de oitenta critérios, consolidação, votos da governança e diretoria, decisão ratificada, concessão ativa e comunicação de portal simuladas.

Documentos de concessão, comprovantes e recurso gráfico do terceiro caso estão identificados como demonstração, sem assinatura ou selo oficiais e sem envio externo.
Não havia processos antigos fora desse escopo na base revisada; os três exemplos são os únicos processos de acreditação da demonstração.
Os originais normativos e o histórico imutável foram preservados.

## Credenciais e verificação

O relatório completo de nomes, funções, logins e senhas está fora do Git, em `safdoulas-v2/data/reports/safdoulas-demonstracao-acessos.md`, com acesso de arquivo restrito ao proprietário.
O manifesto de retomada e as senhas não pertencem ao código-fonte nem ao cofre.
A evidência de API, sem tokens ou senhas, fica em `safdoulas-v2/data/reports/validacao-demo.json`.
O procedimento reproduzível está em `.orbit/validations/safdoulas/README.md`.

Testes de navegador não foram executados por restrição explícita deste host; as verificações HTTP não comprovam a renderização visual ou os gestos móveis.
