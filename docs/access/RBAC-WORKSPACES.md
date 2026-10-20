# RBAC e compartilhamento

## Interfaces

- `/access`: Usuários, Perfis e permissões, Grupos, Privilégios, Exceções individuais e Auditoria.
- `/workspaces`: compartilhamento de quadros, itens do cofre, cadernos e projetos.
- Plugins → Workspaces → Configurar abre a gestão dos compartilhamentos.

## RBAC é core

O catálogo reúne os privilégios do core e os declarados por todos os plugins registrados, inclusive os desativados. O privilégio e o estado de instalação do plugin são controles distintos. O catálogo oferece ativação individual e **Desligar todos do core**. Desligar privilégios não encerra a autenticação, não apaga recursos e não remove o acesso ROOT.

Perfis e grupos concedem privilégios. A pessoa pode participar de vários grupos. Uma exceção individual **Permitir** acrescenta acesso, **Negar** prevalece sobre perfis/grupos, e **Herdar** remove a exceção. Um privilégio desligado globalmente continua bloqueado mesmo com uma concessão individual. As ações registradas dos plugins revalidam os privilégios declarados ao executar.

- **ROOT:** identidade original do desenvolvedor; acesso e administração integral, atuais e futuros, inclusive recursos de outros proprietários. Nenhum administrador comum pode suspender, rebaixar ou atribuir ROOT.
- **Administrador:** administra usuários, perfis, grupos e privilégios. Os privilégios do perfil são editáveis; não implicam compartilhamento de dados privados de outros proprietários.
- **Usuário:** visualiza as funções de leitura, exceto a administração de acessos e as configurações do sistema. As concessões iniciais são visíveis e editáveis no perfil, sem reatribuição automática depois de uma edição.

O cadastro público está fechado. Contas são criadas na interface RBAC. Senhas são hashes bcrypt na tabela de usuários; **usuários e senhas de login não são cadastrados no cofre**. Os registros de teste anteriormente criados no cofre e o seed que dependia deles foram removidos. Suspensão, alteração de senha, perfis/grupos e exceções revogam as sessões afetadas.

## Compartilhamento é outra responsabilidade

Workspaces não atribuem perfis ou privilégios. Seu plugin mantém participantes, administradores do compartilhamento e vínculos com recursos. O core consome providers genéricos de escopo e acesso; o motor RBAC não importa o serviço concreto Workspaces.

Para usar um recurso são necessárias duas condições independentes:

1. O RBAC permite a função solicitada.
2. O recurso pertence à pessoa ou foi compartilhado com ela.

Cofre, cadernos e projetos podem ser compartilhados somente para leitura ou com edição. A edição exige também o privilégio de edição da pessoa; não fornece privilégios por si. A remoção do participante/compartilhamento revoga o acesso ao recurso. ROOT é a exceção explícita. Perfis administrativos não viram membros automaticamente.

A autorização mantém a identidade real para auditoria, inclusive quando um recurso compartilhado exige resolver seu proprietário. Não compartilhar constantes de integração ou recursos privados automaticamente.

## Implantação e validação

Esta implementação está em DEV. Outras instâncias não foram alteradas nesta revisão. Aplicar as migrations versionadas antes de incorporar o código em outra instância. Não editar checksums de migrations já aplicadas.

`npm run build` e `npm run test:unit` verificam compilação, lint e regras. As jornadas HTTP e Selenium estão em `.orbit/validations/rbac-workspaces`. Os scripts Selenium permanecem apenas como referência e não estão autorizados neste host. A suíte mobile compartilhada fica em `.orbit/validations/mobile-responsiveness`.

Os perfis exclusivos de clientes foram retirados; políticas e papéis de um produto devem ser declarados por suas extensões, preservando o motor genérico de autorização.
