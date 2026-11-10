# RBAC core e Workspaces plugin

Usar somente DEV. As jornadas criam fixtures temporárias e removem apenas os usuários, grupos, workspaces e recursos que criaram. As senhas de teste são geradas em memória, armazenadas somente como hashes e nunca impressas ou colocadas no cofre.

```sh
ORBIT_SELENIUM_DB_HOST=<IP-do-orbit-db-dev> node .orbit/validations/rbac-workspaces/api.mjs
ORBIT_SELENIUM_DB_HOST=<IP-do-orbit-db-dev> node .orbit/validations/rbac-workspaces/rbac-workspaces.selenium.mjs
```

A API verifica catálogo core/plugins, grupos, exceções, desativação global do core, ROOT protegido, administração de usuários, suspensão e compartilhamento independente de cofre/cadernos/projetos. As alterações de privilégios feitas pelo teste são restauradas ao final.

Selenium cria usuário, workspace, participação, quadro, grupo e exceção pela interface. Usa toque real em 320, 375, 768 e 1440 pixels; emula `cz-shortcut-listen` adicionado ao body antes da hidratação e verifica ausência do aviso. Valida login real como usuário comum e ausência dos controles administrativos de compartilhamento.
