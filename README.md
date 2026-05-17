# Meus Livros

Sistema web multiusuario para armazenar, organizar, ler e administrar bibliotecas locais de livros em EPUB/PDF.

O projeto segue como um MVP local: sem banco externo, sem dependencias de frontend e com persistencia em arquivos. Ele foi evoluido para suportar uma pasta central de livros, importacao em lote, busca de capas online, leitura online, anotacoes por usuario, administracao de usuarios e fluxo preparado para envio ao Kindle.

## Como iniciar

```powershell
npm start
```

Acesse:

```text
http://localhost:3000
```

Login inicial:

- E-mail: `admin@local`
- Senha: `admin123`

## Estrutura de armazenamento

- `data/db.json`: usuarios, livros, progresso de leitura e anotacoes.
- `storage/my-books/`: pasta centralizada dos arquivos EPUB/PDF enviados.
- `storage/covers/`: capas baixadas, extraidas ou geradas.
- `storage/epubs/`: EPUBs extraidos para leitura por capitulos.

Arquivos antigos em `storage/uploads/` sao migrados automaticamente para `storage/my-books/` na inicializacao.

## Funcionalidades implementadas

### Autenticacao e usuarios

- Login com sessao protegida por cookie assinado.
- Usuario administrador inicial.
- Painel administrativo para cadastrar, bloquear e ativar usuarios.
- Validacao de e-mail e prevencao de e-mails duplicados.
- Limite de armazenamento por usuario.

### Biblioteca

- Interface principal em portugues com o nome **Meus Livros**.
- Grade de livros com busca, filtro por assunto e filtro por formato.
- Visual inspirado em biblioteca digital limpa, sem secoes de series, destaques ou reviews.
- Visualizacao de dono do livro quando o administrador acessa o acervo completo.
- Selecao individual ou em lote de livros.
- Exclusao de livros selecionados.
- Edicao de metadados, assuntos, tags e estante.
- Download protegido do arquivo original do livro.

### Upload e importacao

- Upload de EPUB e PDF.
- Upload de varios arquivos de uma vez.
- Selecao de pasta pelo navegador para importar varios livros.
- Preservacao do caminho relativo de origem quando enviado por pasta.
- Deteccao de duplicados antes de adicionar o livro:
  - hash SHA-256 do arquivo;
  - fallback por nome normalizado + formato + tamanho para livros antigos.
- Correcao de nomes com acentos e cedilha vindos do upload multipart.

### Capas

A estrategia de capas segue esta ordem:

1. Google Books API, buscando por titulo e autor.
2. Open Library, priorizando ISBN/OLID e depois busca por titulo.
3. bookcover-api, buscando por titulo e autor.
4. Primeira capa/imagem encontrada no EPUB.
5. Primeira pagina do PDF, quando ImageMagick esta disponivel.
6. Capa SVG generica como ultimo fallback.

O botao de atualizar capa no cartao do livro usa a mesma estrategia e informa ao usuario a origem da capa quando consegue atualizar.

### Leitura online

- Leitor PDF usando o visualizador nativo do navegador.
- Leitor EPUB por capitulos, com EPUB extraido localmente.
- Progresso de leitura salvo por livro.

### Anotacoes

- Painel lateral de anotacoes dentro do leitor.
- Anotacoes vinculadas ao usuario, livro e capitulo.
- Captura de trecho selecionado em EPUB quando possivel.
- Campo de nota manual e cor de destaque.
- Exclusao de anotacoes.

### Kindle

- Cadastro do e-mail Kindle do usuario.
- Endpoint preparado para envio.
- Mensagem orientando configuracao SMTP para envio real.

## APIs externas usadas para capas

- Google Books API: `https://www.googleapis.com/books/v1/volumes`
- Open Library Covers/Search: `https://covers.openlibrary.org/` e `https://openlibrary.org/search.json`
- bookcover-api: `https://bookcover.longitood.com/bookcover`

## Observacoes tecnicas

Esta versao usa apenas Node.js nativo no backend e HTML/CSS/JavaScript no frontend. Para producao, recomenda-se:

- trocar `data/db.json` por PostgreSQL;
- trocar `storage/` por S3 ou MinIO;
- configurar `SESSION_SECRET` no ambiente;
- integrar SMTP real para Kindle;
- adicionar fila de processamento para uploads grandes;
- adicionar testes automatizados para rotas criticas.

## Validacao feita

- Checagem de sintaxe de `server.js` com `node --check`.
- Checagem de sintaxe de `public/app.js` com `node --check`.
- Testes manuais de login, listagem de livros, atualizacao de capa e leitura basica em servidor local temporario.
