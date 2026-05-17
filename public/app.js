const state = {
  user: null,
  books: [],
  users: [],
  view: "library",
  selectedBook: null,
  chapter: 0,
  filters: { q: "", subject: "", format: "" }
};

const $ = (selector, root = document) => root.querySelector(selector);
const app = $("#app");

async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const res = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Algo nao saiu como esperado");
  return data;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function icon(name) {
  const icons = {
    book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z",
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    edit: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
    trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6",
    send: "M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7Z",
    close: "M18 6 6 18 M6 6l12 12",
    left: "M15 18l-6-6 6-6",
    right: "M9 18l6-6-6-6"
  };
  return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name] || icons.book}"/></svg>`;
}

async function boot() {
  const { user } = await api("/api/me");
  state.user = user;
  if (!user) return renderLogin();
  await loadBooks();
  renderShell();
}

function renderLogin() {
  app.innerHTML = `
    <section class="login">
      <form class="login-card" id="loginForm">
        <div class="brand"><span class="brand-mark">${icon("book")}</span><span>Biblioteca Digital</span></div>
        <h1>Entrar</h1>
        <p class="muted">Acesso inicial: admin@local / admin123</p>
        <label>E-mail <input name="email" type="email" autocomplete="email" required value="admin@local"></label>
        <label>Senha <input name="password" type="password" autocomplete="current-password" required value="admin123"></label>
        <button type="submit">Entrar</button>
        <div class="message" id="loginMessage"></div>
      </form>
    </section>
  `;
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const { user } = await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      state.user = user;
      await loadBooks();
      renderShell();
    } catch (error) {
      $("#loginMessage").textContent = error.message;
      $("#loginMessage").classList.add("error");
    }
  });
}

async function loadBooks() {
  const data = await api("/api/books");
  state.books = data.books;
}

function renderShell() {
  if (state.view === "reader" && state.selectedBook) return renderReader();
  app.innerHTML = `
    <section class="shell">
      <header class="app-header">
        <div class="brand"><span class="brand-mark">${icon("book")}</span><span>Biblioteca Digital</span></div>
        <nav class="top-nav">
          <button class="${state.view === "library" ? "active" : ""}" data-view="library">${icon("book")} Biblioteca</button>
          <button class="${state.view === "upload" ? "active" : ""}" data-view="upload">${icon("upload")} Enviar livro</button>
          ${state.user.role === "admin" ? `<button class="${state.view === "admin" ? "active" : ""}" data-view="admin">${icon("users")} Administracao</button>` : ""}
        </nav>
        <div class="header-actions">
          <button class="secondary icon" title="Notificacoes">●</button>
          <div class="avatar" title="${escapeHtml(state.user.name)}">⌄</div>
          <button id="headerUpload">${icon("upload")} Upload</button>
        </div>
      </header>
      <div class="main-layout">
        <aside class="sidebar">
          <div class="reading-card">
            <small>Tempo de leitura</small>
            <div class="reading-time"><strong>${readingHours()}</strong><span>H</span><strong>${state.books.length}</strong><span>M</span></div>
          </div>
          <nav class="nav">
            <button class="active">Todo conteudo</button>
            <button>Series <span>${countBy("shelf")}</span></button>
            <button>Destaques <span>0</span></button>
            <button>Reviews <span>0</span></button>
            <button data-view="upload">Send to Kindle</button>
          </nav>
          <div class="user-box">
            <strong>${escapeHtml(state.user.name)}</strong>
            <span>${escapeHtml(state.user.email)}</span>
            <button class="secondary" id="logout">Sair</button>
          </div>
        </aside>
        <div class="content" id="screen"></div>
      </div>
    </section>
  `;
  app.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", async () => {
    state.view = button.dataset.view;
    if (state.view === "admin") await loadUsers();
    renderShell();
  }));
  $("#logout")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    renderLogin();
  });
  $("#headerUpload")?.addEventListener("click", () => {
    state.view = "upload";
    renderShell();
  });
  renderScreen();
}

function readingHours() {
  return Math.max(0, Math.round(state.books.length * 2.5));
}

function countBy(key) {
  return new Set(state.books.map((book) => book[key]).filter(Boolean)).size;
}

function renderScreen() {
  if (state.view === "upload") return renderUpload();
  if (state.view === "admin") return renderAdmin();
  renderLibrary();
}

function uniqueValues(key) {
  const set = new Set();
  state.books.forEach((book) => (book[key] || []).forEach?.((item) => set.add(item)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function filteredBooks() {
  const q = state.filters.q.toLowerCase();
  return state.books.filter((book) => {
    const haystack = [book.title, book.author, book.publisher, book.shelf, ...(book.subjects || []), ...(book.tags || [])].join(" ").toLowerCase();
    return (!q || haystack.includes(q)) &&
      (!state.filters.subject || (book.subjects || []).includes(state.filters.subject)) &&
      (!state.filters.format || book.format === state.filters.format);
  });
}

function renderLibrary() {
  const subjects = uniqueValues("subjects");
  const books = filteredBooks();
  $("#screen").innerHTML = `
    <header class="topbar">
      <div>
        <h1>‹ Minha estante <span class="muted">···</span></h1>
      </div>
      <button id="goUpload">${icon("upload")} Upload</button>
    </header>
    <div class="toolbar">
      <div class="tabs">
        <button class="active">Todos</button>
        <button>Favoritos</button>
        <button>Planejados</button>
        <button>Concluidos</button>
      </div>
      <select id="subjectFilter">
        <option value="">Assunto</option>
        ${subjects.map((subject) => `<option ${subject === state.filters.subject ? "selected" : ""}>${escapeHtml(subject)}</option>`).join("")}
      </select>
      <div class="search-wrap">${icon("book")} <input id="search" placeholder="Buscar livro..." value="${escapeHtml(state.filters.q)}"></div>
      <div class="view-icons">${icon("book")} ${icon("users")}</div>
      <select id="formatFilter">
        <option value="">Formato</option>
        <option value="epub" ${state.filters.format === "epub" ? "selected" : ""}>EPUB</option>
        <option value="pdf" ${state.filters.format === "pdf" ? "selected" : ""}>PDF</option>
      </select>
      <button class="secondary icon" id="clearFilters" title="Limpar filtros">×</button>
    </div>
    ${books.length ? `<section class="card-grid">${books.map(bookCard).join("")}</section>` : `<div class="empty">Sua estante ainda esta vazia ou nenhum livro combina com os filtros.</div>`}
  `;
  $("#goUpload").onclick = () => { state.view = "upload"; renderShell(); };
  $("#search").oninput = (event) => { state.filters.q = event.target.value; renderLibrary(); };
  $("#subjectFilter").onchange = (event) => { state.filters.subject = event.target.value; renderLibrary(); };
  $("#formatFilter").onchange = (event) => { state.filters.format = event.target.value; renderLibrary(); };
  $("#clearFilters").onclick = () => { state.filters = { q: "", subject: "", format: "" }; renderLibrary(); };
  bindBookActions();
}

function bookCard(book) {
  return `
    <article class="book-card">
      <img class="cover" src="${book.coverUrl || `/covers/${book.id}`}" alt="Capa de ${escapeHtml(book.title || book.originalName)}">
      <div class="book-info">
        <div class="book-title">${escapeHtml(book.title || book.originalName)}</div>
        <div class="book-author">${escapeHtml(book.author || "Autor desconhecido")}</div>
        <div class="chips">${(book.subjects || []).slice(0, 3).map((subject) => `<span class="chip">${escapeHtml(subject)}</span>`).join("")}</div>
        <div class="book-meta">${book.format.toUpperCase()} · ${book.status === "ready" ? `${Math.round(book.readingProgress?.percent || 0)}% lido` : escapeHtml(book.status)}</div>
        <div class="actions">
          <button data-read="${book.id}">Ler</button>
          <button class="secondary icon" title="Editar" data-edit="${book.id}">${icon("edit")}</button>
          <button class="secondary icon" title="Kindle" data-kindle="${book.id}">${icon("send")}</button>
        </div>
      </div>
    </article>
  `;
}

function bindBookActions() {
  app.querySelectorAll("[data-read]").forEach((button) => button.onclick = () => {
    const book = state.books.find((item) => item.id === button.dataset.read);
    state.selectedBook = book;
    state.chapter = Number(book.readingProgress?.position || 0);
    state.view = "reader";
    renderShell();
  });
  app.querySelectorAll("[data-edit]").forEach((button) => button.onclick = () => showBookModal(button.dataset.edit));
  app.querySelectorAll("[data-kindle]").forEach((button) => button.onclick = () => showKindleModal(button.dataset.kindle));
}

function renderUpload() {
  $("#screen").innerHTML = `
    <header class="topbar">
      <div>
        <h1>Enviar livro</h1>
        <div class="muted">EPUB e PDF, ate ${Math.round(100)} MB por arquivo</div>
      </div>
    </header>
    <form class="panel form-grid" id="uploadForm">
      <label class="wide">Arquivo <input name="file" type="file" accept=".epub,.pdf,application/pdf,application/epub+zip" required></label>
      <label>Assuntos <input name="subjects" placeholder="Tecnologia, Romance"></label>
      <label>Estante <input name="shelf" placeholder="Ler depois"></label>
      <label class="wide">Tags <input name="tags" placeholder="faculdade, consulta, favorito"></label>
      <button type="submit">${icon("upload")} Enviar</button>
      <div class="message" id="uploadMessage"></div>
    </form>
  `;
  $("#uploadForm").onsubmit = async (event) => {
    event.preventDefault();
    const msg = $("#uploadMessage");
    msg.textContent = "Enviando e processando...";
    msg.classList.remove("error");
    try {
      await api("/api/books", { method: "POST", body: new FormData(event.currentTarget) });
      await loadBooks();
      state.view = "library";
      renderShell();
    } catch (error) {
      msg.textContent = error.message;
      msg.classList.add("error");
    }
  };
}

function showBookModal(bookId) {
  const book = state.books.find((item) => item.id === bookId);
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <form class="modal-body form-grid" id="bookForm">
      <h2 class="wide">Editar livro</h2>
      <label>Titulo <input name="title" value="${escapeHtml(book.title)}"></label>
      <label>Autor <input name="author" value="${escapeHtml(book.author)}"></label>
      <label>Editora <input name="publisher" value="${escapeHtml(book.publisher)}"></label>
      <label>ISBN <input name="isbn" value="${escapeHtml(book.isbn)}"></label>
      <label>Idioma <input name="language" value="${escapeHtml(book.language)}"></label>
      <label>Estante <input name="shelf" value="${escapeHtml(book.shelf)}"></label>
      <label class="wide">Assuntos <input name="subjects" value="${escapeHtml((book.subjects || []).join(", "))}"></label>
      <label class="wide">Tags <input name="tags" value="${escapeHtml((book.tags || []).join(", "))}"></label>
      <button type="submit">Salvar</button>
      <button type="button" class="danger" id="deleteBook">${icon("trash")} Excluir</button>
      <button type="button" class="secondary" id="closeModal">Cancelar</button>
    </form>
  `;
  document.body.appendChild(modal);
  $("#closeModal", modal).onclick = () => modal.remove();
  $("#deleteBook", modal).onclick = async () => {
    if (!confirm("Excluir este livro da biblioteca?")) return;
    await api(`/api/books/${book.id}`, { method: "DELETE" });
    await loadBooks();
    modal.remove();
    renderShell();
  };
  $("#bookForm", modal).onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.subjects = String(data.subjects || "").split(",").map((x) => x.trim()).filter(Boolean);
    data.tags = String(data.tags || "").split(",").map((x) => x.trim()).filter(Boolean);
    await api(`/api/books/${book.id}`, { method: "PATCH", body: JSON.stringify(data) });
    await loadBooks();
    modal.remove();
    renderShell();
  };
}

function showKindleModal(bookId) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <form class="modal-body form-grid" id="kindleForm">
      <h2 class="wide">Enviar para Kindle</h2>
      <p class="wide muted">Informe seu e-mail Kindle. Tambem sera necessario autorizar o remetente do sistema na Amazon.</p>
      <label class="wide">E-mail Kindle <input type="email" name="kindleEmail" value="${escapeHtml(state.user.kindleEmail || "")}" placeholder="nome@kindle.com" required></label>
      <button type="submit">${icon("send")} Preparar envio</button>
      <button type="button" class="secondary" id="closeModal">Cancelar</button>
      <div class="message wide" id="kindleMessage"></div>
    </form>
  `;
  document.body.appendChild(modal);
  $("#closeModal", modal).onclick = () => modal.remove();
  $("#kindleForm", modal).onsubmit = async (event) => {
    event.preventDefault();
    const msg = $("#kindleMessage", modal);
    try {
      const data = await api(`/api/books/${bookId}/kindle`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      msg.textContent = data.message;
    } catch (error) {
      msg.textContent = error.message;
      msg.classList.add("error");
    }
  };
}

async function loadUsers() {
  const data = await api("/api/admin/users");
  state.users = data.users;
}

function renderAdmin() {
  $("#screen").innerHTML = `
    <header class="topbar">
      <div>
        <h1>Administracao</h1>
        <div class="muted">Cadastro e controle de acesso dos usuarios</div>
      </div>
    </header>
    <form class="panel form-grid" id="userForm">
      <label>Nome <input name="name" required></label>
      <label>E-mail <input type="email" name="email" required></label>
      <label>Senha temporaria <input name="password" type="password" required></label>
      <label>Papel <select name="role"><option value="user">Usuario</option><option value="admin">Administrador</option></select></label>
      <button type="submit">Cadastrar usuario</button>
      <div class="message" id="userMessage"></div>
    </form>
    <br>
    <table class="table">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th>Ultimo login</th><th>Acoes</th></tr></thead>
      <tbody>${state.users.map(userRow).join("")}</tbody>
    </table>
  `;
  $("#userForm").onsubmit = async (event) => {
    event.preventDefault();
    const msg = $("#userMessage");
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      await loadUsers();
      renderAdmin();
    } catch (error) {
      msg.textContent = error.message;
      msg.classList.add("error");
    }
  };
  app.querySelectorAll("[data-toggle-user]").forEach((button) => button.onclick = async () => {
    const target = state.users.find((item) => item.id === button.dataset.toggleUser);
    await api(`/api/admin/users/${target.id}`, { method: "PATCH", body: JSON.stringify({ status: target.status === "active" ? "blocked" : "active" }) });
    await loadUsers();
    renderAdmin();
  });
}

function userRow(user) {
  return `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${escapeHtml(user.status)}</td>
      <td>${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("pt-BR") : "-"}</td>
      <td><button class="secondary" data-toggle-user="${user.id}">${user.status === "active" ? "Bloquear" : "Ativar"}</button></td>
    </tr>
  `;
}

function renderReader() {
  const book = state.selectedBook;
  const isEpub = book.format === "epub";
  app.innerHTML = `
    <section class="reader">
      <header class="reader-bar">
        <button class="secondary icon" id="backToLibrary" title="Voltar">${icon("left")}</button>
        <div class="reader-title">${escapeHtml(book.title || book.originalName)}</div>
        <div class="reader-actions">
          ${isEpub ? `<button class="secondary icon" id="prevChapter" title="Anterior">${icon("left")}</button><span>${state.chapter + 1}/${book.epub?.spine?.length || 1}</span><button class="secondary icon" id="nextChapter" title="Proximo">${icon("right")}</button>` : ""}
        </div>
      </header>
      ${isEpub ? epubReader(book) : `<iframe class="pdf-frame" src="/files/${book.id}"></iframe>`}
    </section>
  `;
  $("#backToLibrary").onclick = async () => {
    state.view = "library";
    state.selectedBook = null;
    await loadBooks();
    renderShell();
  };
  if (isEpub) bindEpubReader(book);
}

function epubReader(book) {
  const spine = book.epub?.spine || [];
  const src = spine[state.chapter] ? `/epub/${book.id}/${encodeURIComponent(spine[state.chapter]).replaceAll("%2F", "/")}` : "";
  return `
    <div class="epub-pane">
      <aside class="chapters">${spine.map((chapter, index) => `<button class="${index === state.chapter ? "active" : ""}" data-chapter="${index}">Capitulo ${index + 1}</button>`).join("")}</aside>
      ${src ? `<iframe class="reader-frame" src="${src}"></iframe>` : `<div class="empty">Este EPUB ainda esta sendo preparado.</div>`}
    </div>
  `;
}

function bindEpubReader(book) {
  const max = (book.epub?.spine?.length || 1) - 1;
  const save = async () => {
    const percent = max > 0 ? Math.round((state.chapter / max) * 100) : 100;
    await api(`/api/books/${book.id}`, {
      method: "PATCH",
      body: JSON.stringify({ readingProgress: { position: state.chapter, label: `Capitulo ${state.chapter + 1}`, percent } })
    });
  };
  app.querySelectorAll("[data-chapter]").forEach((button) => button.onclick = async () => {
    state.chapter = Number(button.dataset.chapter);
    await save();
    renderReader();
  });
  $("#prevChapter").onclick = async () => {
    state.chapter = Math.max(0, state.chapter - 1);
    await save();
    renderReader();
  };
  $("#nextChapter").onclick = async () => {
    state.chapter = Math.min(max, state.chapter + 1);
    await save();
    renderReader();
  };
}

boot().catch((error) => {
  app.innerHTML = `<section class="login"><div class="login-card"><h1>Erro</h1><p>${escapeHtml(error.message)}</p></div></section>`;
});
