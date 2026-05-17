# Biblioteca Digital

Sistema web multiusuario para armazenar, organizar e ler livros em EPUB/PDF, com painel administrativo e preparacao para envio ao Kindle.

## Como iniciar

```powershell
npm start
```

Acesse `http://localhost:3000`.

Login inicial:

- E-mail: `admin@local`
- Senha: `admin123`

## O que esta implementado

- Login com sessao protegida.
- Usuario administrador inicial.
- Cadastro, bloqueio e ativacao de usuarios pelo painel administrativo.
- Upload de arquivos EPUB e PDF.
- Extracao de metadados e capa embutida de EPUB quando disponivel.
- Capa gerada automaticamente para PDF.
- Busca de capa pela Open Library quando o EPUB possui ISBN e nao traz capa embutida.
- Biblioteca em grade com busca, filtro por assunto e filtro por formato.
- Edicao de metadados, assuntos, tags e estante.
- Leitor PDF usando o visualizador nativo do navegador.
- Leitor EPUB por capitulos, com progresso salvo.
- Exclusao de livros.
- Cadastro do e-mail Kindle e endpoint preparado para envio.

## Observacoes

Os dados ficam em `data/db.json`, e os arquivos enviados ficam em `storage/`. Esta versao foi feita como MVP local. Para producao, recomenda-se trocar o armazenamento para S3/MinIO, usar PostgreSQL e integrar um provedor SMTP real para o envio ao Kindle.
