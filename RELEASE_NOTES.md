# SpawnVault 2.4.0

Novo cargo Moderador para criar itens e aceitar/rejeitar pedidos nos grupos existentes. Contas, grupos, edição/eliminação de itens e as restantes funções administrativas continuam reservadas aos administradores.

Os pedidos mostram o username do autor e de quem decidiu. O autor pode eliminar pedidos pendentes. Os pedidos aceites/rejeitados podem ser arquivados e repostos num arquivo pessoal. Na ausência de username no perfil, apresenta-se o nome antes do @ do email. A aprovação cria o item e regista a decisão numa única transação.

As imagens ampliam com um clique na tabela e nos cartões. O subgrupo em consulta fica pré-selecionado ao adicionar um item. Os avisos aparecem à frente das janelas abertas: verde para confirmações e vermelho para erros. Mantidos o logotipo, marca de água, assinatura, contas, dados e atualizações pelo GitHub.

## Instalação

Instalador preparado: SpawnVault-Setup-2.4.0.exe. Aplicar e validar primeiro a migração do Supabase. A aplicação mantém o identificador e a ligação existentes. Esta preparação local ainda não foi publicada como atualização geral.

## Atualização do Supabase

Num projeto com a v2.3 configurada, executar supabase/migration_v24.sql no SQL Editor do projeto existente como proprietário. Não executar schema.sql novamente. A migração é transacional, repetível e não recria contas ou dados. O instalador não executa SQL. Sem a migração, o catálogo permanece acessível e as novas opções dos pedidos mostram uma indicação de configuração em falta.

## Verificação

Testes locais de interface com dados fictícios, permissões em PostgreSQL/PGlite, controlador de atualizações e integridade do pacote. O Supabase de produção não foi alterado nem validado. A instalação/atualização completa no Windows não foi testada. O instalador não tem assinatura digital. Consultar STATUS-v24.md.
