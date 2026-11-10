# Jornada Selenium do cofre

Valida a criação de um texto cifrado por categoria no cofre, sem card associado, a persistência após recarregar e a cópia independente para um card com descrição em Markdown. O texto original permanece no cofre.

```bash
ORBIT_SELENIUM_BASE_URL=http://localhost:3001 node .orbit/validations/vault-journey/vault-journey.selenium.mjs
```

Requer uma instância Orbit já em execução, Chrome e as variáveis de `apps/api/.env`. O script cria e remove seu próprio quadro, card e texto de teste.
