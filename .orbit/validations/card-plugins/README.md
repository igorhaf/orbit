# Layouts de plugins

Execute na raiz do projeto DEV:

```sh
ORBIT_SELENIUM_DB_HOST=172.22.0.3 node .orbit/validations/card-plugins/card-plugins.selenium.mjs
```

Cria quadro/cartão temporários via API e limpa no final. Valida layout básico, seleção de desenvolvimento com IA automática, remoção de dependentes, persistência, comentários sem IA, bloqueio de rotas e disponibilidade de projetos, por toque em 320/375/768/1440 px. Desativa IA brevemente e restaura o estado original no `finally`. Não executa prompts.

As dependências, ciclos, campos declarativos e retenção de dados têm testes unitários em `apps/api/src/plugins/card-layouts.spec.ts`.
