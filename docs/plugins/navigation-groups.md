# Navegação agrupada de plugins

Cada contribuição navigation declara id, label e href internos, com group, section, order e permission opcionais. Os grupos e seções são definidos exclusivamente nos plugins; o header não conhece produtos ou rotas de clientes. Plugins sem group mantêm links independentes.

O host agrupa contribuições habilitadas, filtra permission pelo RBAC, elimina destinos repetidos e rejeita URLs externas. Grupos vazios desaparecem. Desativação de dependências e alterações de plugins atualizam o mesmo catálogo por socket autenticado no desktop e no celular.

No desktop, um botão abre as seções em um painel com rolagem limitado à viewport; Escape fecha e retorna o foco ao botão, clique externo fecha e Tab percorre links normalmente. No celular, os mesmos grupos aparecem como seções dentro da navegação rolável. Links têm área de toque mínima de 44px.

Validação sem navegador: npx tsx --test apps/web/lib/plugin-navigation.spec.ts e testes de contrato da API, lint e build.
