const state = {
  user: null,
  books: [],
  recent: [],
  users: [],
  subjects: [],
  tags: [],
  view: "library",
  selectedBook: null,
  selectedBookIds: new Set(),
  chapter: 0,
  annotations: [],
  readerPanel: "",
  readerSettings: JSON.parse(localStorage.getItem("mybooklib-reader-settings") || "{\"theme\":\"paper\",\"fontSize\":18,\"contentWidth\":980,\"lineHeight\":1.65,\"publisherDefaults\":true,\"verticalScroll\":false,\"columns\":false,\"pdfZoom\":100}"),
  readerSearch: "",
  pendingBulkSubject: "",
  libraryScope: "mine",
  pagination: { page: 1, pageSize: 60, total: 0, totalPages: 1 },
  filters: { q: "", subject: "", tag: "", format: "", shelfTab: "all" },
  theme: localStorage.getItem("mybooklib-theme") || "light"
};

function applyTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.body.classList.toggle("theme-dark", state.theme === "dark");
  localStorage.setItem("mybooklib-theme", state.theme);
}

function bookMatchesShelfTab(book, tab) {
  const status = book.readingStatus || "";
  const percent = Number(book.readingProgress?.percent || 0);
  if (tab === "all") return true;
  if (tab === "favorite") return status === "favorite";
  if (tab === "planned") return status === "planned";
  if (tab === "completed") return status === "completed" || percent >= 100;
  return true;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function coverSrc(book) {
  const base = book.coverUrl || `/covers/${book.id}`;
  const stamp = book.updatedAt || book.lastOpenedAt || "";
  return stamp ? `${base}?v=${encodeURIComponent(stamp)}` : base;
}

function readingMeta(book) {
  const size = formatFileSize(book.fileSize);
  if (book.status !== "ready") return `${book.format.toUpperCase()} · ${escapeHtml(book.status)}`;
  const percent = Math.round(book.readingProgress?.percent || 0);
  const sizePart = size ? `<span class="book-size">${size}</span>` : "";
  return `${book.format.toUpperCase()} · ${sizePart}<span class="book-progress">${percent}% lido</span>`;
}

function recentBooks(limit = 12) {
  return [...state.recent]
    .filter((book) => book.lastOpenedAt)
    .sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt))
    .slice(0, limit);
}

function progressRing(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const angle = (value / 100) * 360;
  return `<span class="progress-ring" style="--progress:${angle}deg" title="${value}% lido"></span>`;
}

function bookDescription(book) {
  return String(book.description || "").trim() || book.metadataError || "Sinopse ainda nao encontrada para este livro.";
}

function bookMetadataRows(book) {
  const rows = [
    ["Publicacao", book.publishedDate],
    ["Idioma", book.language],
    ["Formato", book.format?.toUpperCase()],
    ["Editora", book.publisher],
    ["ISBN", book.isbn],
    ["Paginas", book.pageCount],
    ["Origem", book.metadataSource || book.coverSource]
  ].filter(([, value]) => String(value || "").trim());
  return rows.map(([label, value]) => `
    <div class="preview-meta-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function bookTagsMarkup(book) {
  const tags = (book.tags || []).filter(Boolean).slice(0, 10);
  if (!tags.length) return "";
  return `
    <div class="preview-section-title">Tags</div>
    <div class="preview-tags">${tags.map((tag) => `<button type="button" data-tag-filter="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}</div>
  `;
}

function bookCardTagsMarkup(book) {
  const tags = (book.tags || []).filter(Boolean).slice(0, 3);
  return tags.length ? `<div class="book-tags">${tags.map((tag) => `<button type="button" data-tag-filter="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}</div>` : "";
}

function saveReaderSettings() {
  localStorage.setItem("mybooklib-reader-settings", JSON.stringify(state.readerSettings));
}

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
    search: "M21 21l-4.35-4.35 M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z",
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    edit: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
    trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6",
    send: "M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7Z",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
    close: "M18 6 6 18 M6 6l12 12",
    left: "M15 18l-6-6 6-6",
    right: "M9 18l6-6-6-6",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8 M13.73 21a2 2 0 0 1-3.46 0"
  };
  return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name] || icons.book}"/></svg>`;
}

async function boot() {
  applyTheme(state.theme);
  const { user } = await api("/api/me");
  state.user = user;
  if (!user) return renderLogin();
  await Promise.all([loadBooks(), loadSubjects(), loadTags(), loadRecentBooks()]);
  renderShell();
}

async function loadSubjects() {
  const data = await api("/api/subjects");
  state.subjects = data.subjects || [];
}

function renderLogin() {
  app.innerHTML = `
    <section class="login">
      <form class="login-card" id="loginForm">
        <div class="brand"><span class="brand-mark">${icon("book")}</span><span>MyBookLib</span></div>
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
      await Promise.all([loadBooks(), loadSubjects(), loadTags(), loadRecentBooks()]);
      renderShell();
    } catch (error) {
      $("#loginMessage").textContent = error.message;
      $("#loginMessage").classList.add("error");
    }
  });
}

async function loadBooks() {
  const params = new URLSearchParams({
    page: String(state.pagination.page),
    pageSize: String(state.pagination.pageSize),
    shelfTab: state.filters.shelfTab || "all"
  });
  if (state.user?.role === "admin" && state.libraryScope === "all") params.set("scope", "all");
  if (state.filters.q) params.set("q", state.filters.q);
  if (state.filters.subject) params.set("subject", state.filters.subject);
  if (state.filters.tag) params.set("tag", state.filters.tag);
  if (state.filters.format) params.set("format", state.filters.format);
  const query = `?${params.toString()}`;
  const data = await api(`/api/books${query}`);
  state.books = data.books || [];
  state.pagination = {
    page: Number(data.page || 1),
    pageSize: Number(data.pageSize || state.pagination.pageSize),
    total: Number(data.total || state.books.length),
    totalPages: Number(data.totalPages || 1)
  };
}

async function loadRecentBooks() {
  const query = state.user?.role === "admin" && state.libraryScope === "all" ? "?scope=all&limit=12" : "?limit=12";
  const data = await api(`/api/books/recent${query}`);
  state.recent = data.books || [];
}

async function loadTags() {
  const query = state.user?.role === "admin" && state.libraryScope === "all" ? "?scope=all" : "";
  const data = await api(`/api/tags${query}`);
  state.tags = data.tags || [];
}

async function loadAnnotations(bookId) {
  const data = await api(`/api/books/${bookId}/annotations`);
  state.annotations = data.annotations;
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function renderShell() {
  if (state.view === "reader" && state.selectedBook) return renderReader();
  app.innerHTML = `
    <section class="shell">
      <header class="app-header">
        <div class="brand"><span class="brand-mark">${icon("book")}</span><span>MyBookLib</span></div>
        <nav class="top-nav">
          <button class="${state.view === "library" ? "active" : ""}" data-view="library">${icon("book")} Estante</button>
          <button class="${state.view === "upload" ? "active" : ""}" data-view="upload">${icon("upload")} Enviar livro</button>
          ${state.user.role === "admin" ? `<button class="${state.view === "admin" ? "active" : ""}" data-view="admin">${icon("users")} Administracao</button>` : ""}
        </nav>
        <div class="header-actions">
          <button class="secondary icon" id="themeToggle" title="Alternar tema">${state.theme === "dark" ? "☀" : "☾"}</button>
          <button class="secondary icon" title="Notificacoes">${icon("bell")}</button>
          <div class="avatar" title="${escapeHtml(state.user.name)}">${escapeHtml(initials(state.user.name))}</div>
          ${state.view !== "upload" ? `<button id="headerUpload">${icon("upload")} Upload</button>` : ""}
        </div>
      </header>
      <div class="main-layout">
        <aside class="sidebar">
          <nav class="nav">
            <button class="${state.view === "library" ? "active" : ""}" data-view="library">Todo conteudo <span>${state.pagination.total || state.books.length}</span></button>
            <button data-view="upload">Envio Kindle</button>
            <button class="${state.view === "subjects" ? "active" : ""}" data-view="subjects">Assuntos <span>${state.subjects.length}</span></button>
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
    if (state.view === "subjects") await loadSubjects();
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
  $("#themeToggle")?.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    renderShell();
  });
  renderScreen();
}

function renderScreen() {
  if (state.view === "upload") return renderUpload();
  if (state.view === "admin") return renderAdmin();
  if (state.view === "subjects") return renderSubjects();
  renderLibrary();
}

function normalizeSubjectLabel(value) {
  return String(value || "").trim();
}

function subjectKey(value) {
  return normalizeSubjectLabel(value).toLocaleLowerCase("pt-BR");
}

function catalogSubjects() {
  const merged = new Map();
  state.books.forEach((book) => {
    (book.subjects || []).forEach((item) => {
      const label = normalizeSubjectLabel(item);
      if (label) merged.set(subjectKey(label), label);
    });
  });
  (state.subjects || []).forEach((item) => {
    const label = normalizeSubjectLabel(item);
    if (label && !merged.has(subjectKey(label))) merged.set(subjectKey(label), label);
  });
  return [...merged.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function catalogTags() {
  return [...new Set(state.tags || [])].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function bookMatchesSubject(book, filterSubject) {
  const needle = subjectKey(filterSubject);
  if (!needle) return true;
  return (book.subjects || []).some((item) => subjectKey(item) === needle);
}

function bookMatchesTag(book, filterTag) {
  const needle = subjectKey(filterTag);
  if (!needle) return true;
  return (book.tags || []).some((item) => subjectKey(item) === needle);
}

function filteredBooks() {
  return state.books;
}

let librarySearchTimer = null;

async function reloadLibrary({ resetPage = false, refreshRecent = false } = {}) {
  if (resetPage) state.pagination.page = 1;
  await Promise.all([
    loadBooks(),
    loadTags(),
    refreshRecent ? loadRecentBooks() : Promise.resolve()
  ]);
  if (state.view === "library") renderLibrary();
}

function shelfTabsMarkup() {
  const tabs = [
    { id: "all", label: "Todos" },
    { id: "favorite", label: "Favoritos" },
    { id: "planned", label: "Planejados" },
    { id: "completed", label: "Concluidos" }
  ];
  return `<div class="shelf-tabs">${tabs.map((tab) => `
    <button type="button" class="${state.filters.shelfTab === tab.id ? "active" : ""}" data-shelf-tab="${tab.id}">${tab.label}</button>
  `).join("")}</div>`;
}

function renderRecentlyOpened() {
  const recent = recentBooks();
  if (!recent.length) return "";
  return `
    <section class="recent-section">
      <div class="section-head">
        <h2>Abertos recentemente</h2>
        <span class="muted">${recent.length}</span>
      </div>
      <div class="recent-track">${recent.map(recentBookCard).join("")}</div>
    </section>
  `;
}

function renderPagination() {
  const { page, pageSize, total, totalPages } = state.pagination;
  if (!total) return "";
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return `
    <div class="pagination-bar">
      <span>Mostrando ${first}-${last} de ${total}</span>
      <div class="pagination-actions">
        <button class="secondary" id="prevPage" ${page <= 1 ? "disabled" : ""}>Anterior</button>
        <strong>Pagina ${page} de ${totalPages}</strong>
        <button class="secondary" id="nextPage" ${page >= totalPages ? "disabled" : ""}>Proxima</button>
        <select id="pageSize" class="filter-select" title="Livros por pagina">
          ${[30, 60, 90, 120].map((size) => `<option value="${size}" ${pageSize === size ? "selected" : ""}>${size} por pagina</option>`).join("")}
        </select>
      </div>
    </div>
  `;
}

function recentBookCard(book) {
  const percent = Math.round(book.readingProgress?.percent || 0);
  return `
    <article class="recent-card">
      <img class="recent-cover" src="${coverSrc(book)}" alt="">
      <div class="recent-body">
        <div class="recent-author">${escapeHtml(book.author || "Autor desconhecido")}</div>
        <div class="recent-title">${escapeHtml(book.title || book.originalName)}</div>
        <div class="recent-footer">
          <span class="recent-meta">${formatFileSize(book.fileSize)}</span>
          <button class="recent-continue" data-read="${book.id}">
            ${progressRing(percent)}
            <span>Continuar</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function decodeFilterValue(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value);
  }
}

function renderLibrary() {
  const subjects = catalogSubjects();
  const tags = catalogTags();
  const books = filteredBooks();
  const totalBooks = state.pagination.total || books.length;
  $("#screen").innerHTML = `
    <header class="topbar topbar-compact">
      <div>
        <h1>${state.libraryScope === "all" ? "Acervo completo" : "Minha estante"}</h1>
        <div class="muted">${totalBooks} livro(s) - ${books.length} nesta pagina</div>
      </div>
      <div class="topbar-actions">
        <button class="secondary subtle" id="dedupeBooks" title="Remover duplicados">${icon("book")}</button>
        <button class="danger subtle" id="deleteSelected" title="Excluir selecionados" ${state.selectedBookIds.size ? "" : "disabled"}>${icon("trash")}</button>
      </div>
    </header>
    ${renderRecentlyOpened()}
    <div class="library-panel">
      <div class="shelf-bar">
        <h2 class="shelf-heading">Minha estante</h2>
        ${shelfTabsMarkup()}
      </div>
      <div class="filter-bar toolbar">
      <label class="select-all"><input type="checkbox" id="selectAllBooks" ${books.length && books.every((book) => state.selectedBookIds.has(book.id)) ? "checked" : ""}> Todos</label>
      ${state.user.role === "admin" ? `
        <select id="scopeFilter" class="filter-select" title="Escopo">
          <option value="mine" ${state.libraryScope === "mine" ? "selected" : ""}>Meus livros</option>
          <option value="all" ${state.libraryScope === "all" ? "selected" : ""}>Todos</option>
        </select>` : ""}
      <select id="subjectFilter" class="filter-select">
        <option value="">Assunto</option>
        ${subjects.map((subject) => {
          const selected = subjectKey(subject) === subjectKey(state.filters.subject);
          return `<option value="${encodeURIComponent(subject)}" ${selected ? "selected" : ""}>${escapeHtml(subject)}</option>`;
        }).join("")}
      </select>
      <select id="tagFilter" class="filter-select">
        <option value="">Tag</option>
        ${tags.map((tag) => {
          const selected = subjectKey(tag) === subjectKey(state.filters.tag);
          return `<option value="${encodeURIComponent(tag)}" ${selected ? "selected" : ""}>${escapeHtml(tag)}</option>`;
        }).join("")}
      </select>
      <div class="search-wrap">${icon("book")} <input id="search" placeholder="Buscar livro..." value="${escapeHtml(state.filters.q)}"></div>
      <select id="formatFilter" class="filter-select">
        <option value="">Formato</option>
        <option value="epub" ${state.filters.format === "epub" ? "selected" : ""}>EPUB</option>
        <option value="pdf" ${state.filters.format === "pdf" ? "selected" : ""}>PDF</option>
      </select>
      <button class="secondary icon" id="clearFilters" title="Limpar filtros">x</button>
    </div>
    <div class="bulk-subject-bar">
      <strong>${state.selectedBookIds.size} selecionado(s)</strong>
      <input id="bulkSubjectInput" list="bulkSubjectOptions" placeholder="Assunto para aplicar em lote" value="${escapeHtml(state.pendingBulkSubject)}">
      <datalist id="bulkSubjectOptions">
        ${subjects.map((subject) => `<option value="${escapeHtml(subject)}"></option>`).join("")}
      </datalist>
      <button id="applyBulkSubject" ${state.selectedBookIds.size ? "" : "disabled"}>Aplicar assunto</button>
      <button class="secondary" id="clearBookSelection" ${state.selectedBookIds.size ? "" : "disabled"}>Limpar selecao</button>
      <span class="message" id="bulkSubjectMessage"></span>
    </div>
    <div class="content-head">
      <h3>Todo o conteudo <span class="muted">${totalBooks}</span></h3>
      ${normalizeSubjectLabel(state.filters.subject) ? `<span class="filter-pill">Assunto: ${escapeHtml(normalizeSubjectLabel(state.filters.subject))}</span>` : ""}
      ${normalizeSubjectLabel(state.filters.tag) ? `<span class="filter-pill">Tag: ${escapeHtml(normalizeSubjectLabel(state.filters.tag))}</span>` : ""}
    </div>
    ${books.length ? `<section class="card-grid card-grid-compact">${books.map(bookCard).join("")}</section>` : `<div class="empty compact">Nenhum livro encontrado com os filtros atuais.</div>`}
    ${renderPagination()}
    </div>
  `;
  $("#dedupeBooks").onclick = deduplicateBooks;
  app.querySelectorAll("[data-shelf-tab]").forEach((button) => button.onclick = async () => {
    state.filters.shelfTab = button.dataset.shelfTab;
    await reloadLibrary({ resetPage: true });
  });
  $("#deleteSelected").onclick = deleteSelectedBooks;
  $("#selectAllBooks")?.addEventListener("change", (event) => {
    if (event.target.checked) books.forEach((book) => state.selectedBookIds.add(book.id));
    else books.forEach((book) => state.selectedBookIds.delete(book.id));
    renderLibrary();
  });
  $("#scopeFilter")?.addEventListener("change", async (event) => {
    state.libraryScope = event.target.value;
    await reloadLibrary({ resetPage: true, refreshRecent: true });
  });
  $("#search").oninput = (event) => {
    state.filters.q = event.target.value;
    clearTimeout(librarySearchTimer);
    librarySearchTimer = setTimeout(() => reloadLibrary({ resetPage: true }), 250);
  };
  $("#subjectFilter").onchange = async (event) => {
    state.filters.subject = normalizeSubjectLabel(decodeFilterValue(event.target.value));
    await reloadLibrary({ resetPage: true });
  };
  $("#tagFilter").onchange = async (event) => {
    state.filters.tag = normalizeSubjectLabel(decodeFilterValue(event.target.value));
    await reloadLibrary({ resetPage: true });
  };
  $("#formatFilter").onchange = async (event) => {
    state.filters.format = event.target.value;
    await reloadLibrary({ resetPage: true });
  };
  $("#clearFilters").onclick = async () => {
    state.filters = { q: "", subject: "", tag: "", format: "", shelfTab: state.filters.shelfTab };
    await reloadLibrary({ resetPage: true });
  };
  $("#prevPage")?.addEventListener("click", async () => {
    state.pagination.page = Math.max(1, state.pagination.page - 1);
    await reloadLibrary();
  });
  $("#nextPage")?.addEventListener("click", async () => {
    state.pagination.page = Math.min(state.pagination.totalPages, state.pagination.page + 1);
    await reloadLibrary();
  });
  $("#pageSize")?.addEventListener("change", async (event) => {
    state.pagination.pageSize = Number(event.target.value);
    await reloadLibrary({ resetPage: true });
  });
  $("#applyBulkSubject").onclick = applyBulkSubject;
  $("#clearBookSelection").onclick = () => {
    state.selectedBookIds.clear();
    renderLibrary();
  };
  bindBookActions();
}

function bookCard(book) {
  const owner = state.libraryScope === "all" && book.ownerName ? `<div class="book-owner">${escapeHtml(book.ownerName)}</div>` : "";
  const checked = state.selectedBookIds.has(book.id) ? "checked" : "";
  const isFavorite = book.readingStatus === "favorite";
  const processing = book.status && book.status !== "ready";
  const previewMeta = bookMetadataRows(book);
  return `
    <article class="book-card book-card-compact ${processing ? "is-processing" : ""}">
      <label class="book-select" title="Selecionar livro"><input type="checkbox" data-select-book="${book.id}" ${checked}></label>
      <button type="button" class="book-favorite ${isFavorite ? "active" : ""}" data-favorite="${book.id}" title="Favorito">${isFavorite ? "★" : "☆"}</button>
      <img class="cover ${processing ? "cover-skeleton" : ""}" src="${coverSrc(book)}" alt="Capa de ${escapeHtml(book.title || book.originalName)}">
      <aside class="book-preview" aria-hidden="true">
        <button type="button" class="preview-close" tabindex="-1">x</button>
        <img class="preview-cover" src="${coverSrc(book)}" alt="">
        <div class="preview-body">
          <div class="preview-author">${escapeHtml(book.author || "Autor desconhecido")}</div>
          <h3>${escapeHtml(book.title || book.originalName)}</h3>
          <div class="preview-section-title">Sinopse</div>
          <p class="preview-description">${escapeHtml(bookDescription(book))}</p>
          ${bookTagsMarkup(book)}
          ${previewMeta ? `<div class="preview-meta">${previewMeta}</div>` : ""}
        </div>
      </aside>
      <div class="book-info">
        <div class="book-author">${escapeHtml(book.author || "Autor desconhecido")}</div>
        <div class="book-title">${escapeHtml(book.title || book.originalName)}</div>
        ${owner}
        <div class="book-meta">${readingMeta(book)}</div>
        ${bookCardTagsMarkup(book)}
        <div class="actions">
          <button data-read="${book.id}">Ler</button>
          <a class="button secondary icon" title="Download" href="/files/${book.id}?download=1" download>${icon("download")}</a>
          <button class="secondary icon" title="Buscar metadados online" data-cover="${book.id}">${icon("book")}</button>
          <button class="secondary icon" title="Editar" data-edit="${book.id}">${icon("edit")}</button>
          <button class="secondary icon" title="Kindle" data-kindle="${book.id}">${icon("send")}</button>
        </div>
      </div>
    </article>
  `;
}

function positionBookPreview(card, event) {
  const preview = $(".book-preview", card);
  if (!preview || window.matchMedia("(max-width: 820px)").matches) return;
  const width = Math.min(520, window.innerWidth - 32);
  const height = Math.min(460, window.innerHeight - 32);
  const rect = card.getBoundingClientRect();
  const openLeft = rect.left > window.innerWidth / 2;
  const desiredX = openLeft ? rect.left - width - 18 : rect.right + 18;
  const x = Math.min(Math.max(16, desiredX), window.innerWidth - width - 16);
  const y = Math.min(Math.max(16, rect.top - 10), window.innerHeight - height - 16);
  preview.style.setProperty("--preview-x", `${Math.max(16, x)}px`);
  preview.style.setProperty("--preview-y", `${Math.max(16, y)}px`);
}

async function applyBulkSubject() {
  const msg = $("#bulkSubjectMessage");
  const subject = normalizeSubjectLabel($("#bulkSubjectInput")?.value);
  const bookIds = [...state.selectedBookIds];
  msg.textContent = "";
  msg.classList.remove("error");
  if (!subject) {
    msg.textContent = "Informe um assunto.";
    msg.classList.add("error");
    return;
  }
  if (!bookIds.length) {
    msg.textContent = "Selecione livros antes de aplicar.";
    msg.classList.add("error");
    return;
  }
  try {
    const result = await api("/api/books/subjects", { method: "PATCH", body: JSON.stringify({ subject, bookIds }) });
    state.filters.subject = subject;
    state.pagination.page = 1;
    await Promise.all([loadBooks(), loadSubjects(), loadTags()]);
    state.pendingBulkSubject = "";
    state.selectedBookIds.clear();
    renderLibrary();
    const nextMsg = $("#bulkSubjectMessage");
    if (nextMsg) nextMsg.textContent = `${result.updated} livro(s) atualizado(s).`;
  } catch (error) {
    msg.textContent = error.message;
    msg.classList.add("error");
  }
}

async function openBook(bookId) {
  const book = state.books.find((item) => item.id === bookId) || state.recent.find((item) => item.id === bookId);
  if (!book) return;
  try {
    const data = await api(`/api/books/${bookId}/open`, { method: "POST" });
    book.lastOpenedAt = data.book?.lastOpenedAt || new Date().toISOString();
  } catch {
    book.lastOpenedAt = new Date().toISOString();
  }
  state.selectedBook = book;
  state.chapter = Number(book.readingProgress?.position || 0);
  await loadAnnotations(book.id);
  state.view = "reader";
  renderShell();
}

async function deduplicateBooks() {
  if (!confirm("Verificar duplicados e manter apenas uma copia de cada livro?")) return;
  try {
    const result = await api("/api/books/deduplicate", { method: "POST" });
    await Promise.all([loadBooks(), loadTags(), loadRecentBooks()]);
    renderLibrary();
    if (result.removed) {
      const lines = (result.duplicates || []).slice(0, 8).map((item) => `• Mantido: ${item.keptTitle}\n  Removido: ${item.removedTitle}`);
      alert(`${result.removed} duplicado(s) removido(s).\n\n${lines.join("\n")}${result.duplicates?.length > 8 ? "\n..." : ""}`);
    } else {
      alert("Nenhum livro duplicado encontrado.");
    }
  } catch (error) {
    alert(error.message);
  }
}

function renderSubjects() {
  $("#screen").innerHTML = `
    <header class="topbar">
      <div>
        <h1>Assuntos</h1>
        <div class="muted">Cadastre assuntos para usar ao editar os metadados dos livros.</div>
      </div>
    </header>
    <form class="panel form-grid" id="subjectForm">
      <label class="wide">Novo assunto <input name="name" placeholder="Tecnologia, Romance, Negocios..." required></label>
      <button type="submit">Cadastrar assunto</button>
      <div class="message" id="subjectMessage"></div>
    </form>
    <div class="panel subject-list">
      ${state.subjects.length
    ? state.subjects.map((subject) => `
          <div class="subject-row">
            <span>${escapeHtml(subject)}</span>
            <button class="secondary" data-use-subject="${encodeURIComponent(subject)}">Usar na estante</button>
            <button class="secondary icon" data-delete-subject="${encodeURIComponent(subject)}" title="Excluir assunto">${icon("trash")}</button>
          </div>`).join("")
    : `<div class="empty compact">Nenhum assunto cadastrado ainda.</div>`}
    </div>
  `;
  $("#subjectForm").onsubmit = async (event) => {
    event.preventDefault();
    const msg = $("#subjectMessage");
    const name = String(new FormData(event.currentTarget).get("name") || "").trim();
    try {
      const data = await api("/api/subjects", { method: "POST", body: JSON.stringify({ name }) });
      state.subjects = data.subjects || [];
      renderSubjects();
    } catch (error) {
      msg.textContent = error.message;
      msg.classList.add("error");
    }
  };
  app.querySelectorAll("[data-delete-subject]").forEach((button) => button.onclick = async () => {
    if (!confirm("Excluir este assunto do catalogo?")) return;
    await api(`/api/subjects/${button.dataset.deleteSubject}`, { method: "DELETE" });
    await loadSubjects();
    renderSubjects();
  });
  app.querySelectorAll("[data-use-subject]").forEach((button) => button.onclick = async () => {
    state.pendingBulkSubject = decodeFilterValue(button.dataset.useSubject);
    state.filters.subject = "";
    state.filters.tag = "";
    state.filters.q = "";
    state.filters.format = "";
    state.pagination.page = 1;
    await reloadLibrary({ resetPage: true });
    state.view = "library";
    renderShell();
  });
}

function bindBookActions() {
  app.querySelectorAll(".book-card").forEach((card) => {
    card.addEventListener("mouseenter", (event) => positionBookPreview(card, event));
    card.addEventListener("mousemove", (event) => positionBookPreview(card, event));
  });
  app.querySelectorAll("[data-tag-filter]").forEach((button) => button.onclick = async () => {
    state.filters.tag = button.dataset.tagFilter;
    await reloadLibrary({ resetPage: true });
  });
  app.querySelectorAll("[data-select-book]").forEach((checkbox) => checkbox.onchange = () => {
    if (checkbox.checked) state.selectedBookIds.add(checkbox.dataset.selectBook);
    else state.selectedBookIds.delete(checkbox.dataset.selectBook);
    renderLibrary();
  });
  app.querySelectorAll("[data-read]").forEach((button) => button.onclick = () => openBook(button.dataset.read));
  app.querySelectorAll("[data-edit]").forEach((button) => button.onclick = () => showBookModal(button.dataset.edit));
  app.querySelectorAll("[data-kindle]").forEach((button) => button.onclick = () => showKindleModal(button.dataset.kindle));
  app.querySelectorAll("[data-cover]").forEach((button) => button.onclick = () => refreshCover(button.dataset.cover, button));
  app.querySelectorAll("[data-favorite]").forEach((button) => button.onclick = async () => {
    const book = state.books.find((item) => item.id === button.dataset.favorite);
    if (!book) return;
    const next = book.readingStatus === "favorite" ? "" : "favorite";
    await api(`/api/books/${book.id}`, { method: "PATCH", body: JSON.stringify({ readingStatus: next }) });
    book.readingStatus = next;
    renderLibrary();
  });
}

async function refreshCover(bookId, button) {
  button.disabled = true;
  try {
    const result = await api(`/api/books/${bookId}/cover`, { method: "POST" });
    await Promise.all([loadBooks(), loadTags()]);
    renderLibrary();
    alert(`Metadados atualizados com sucesso.\nOrigem: ${result.source || "online"}.`);
  } catch (error) {
    alert(`${error.message}\n\nVerifique tambem se o servidor tem acesso a internet.`);
    button.disabled = false;
  }
}

function processingKey(bookIds) {
  return bookIds.map((id) => {
    const book = state.books.find((item) => item.id === id);
    if (!book) return `${id}:missing`;
    return [book.id, book.status, book.updatedAt, book.coverUrl, book.coverSource, book.metadataSource, book.description, (book.tags || []).join("|")].join(":");
  }).join(";");
}

async function monitorImportedBooks(bookIds) {
  const ids = [...new Set((bookIds || []).filter(Boolean))];
  if (!ids.length) return;
  let previousKey = processingKey(ids);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const pending = state.books.some((book) => ids.includes(book.id) && ["uploaded", "processing"].includes(book.status));
    if (!pending && attempt > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await loadBooks();
    const nextKey = processingKey(ids);
    if (state.view === "library" && nextKey !== previousKey) {
      previousKey = nextKey;
      renderLibrary();
    }
  }
}

function renderUpload() {
  $("#screen").innerHTML = `
    <header class="topbar">
      <div>
        <h1>Enviar livros</h1>
        <div class="muted">Selecione arquivos EPUB/PDF ou uma pasta inteira para importar ao MyBookLib.</div>
      </div>
    </header>
    <form class="panel form-grid" id="uploadForm">
      <label class="wide">Arquivos ou pasta <input id="fileInput" name="file" type="file" accept=".epub,.pdf,application/pdf,application/epub+zip" multiple required></label>
      <div class="wide upload-actions">
        <button type="button" class="secondary" id="chooseFiles">${icon("upload")} Selecionar arquivos</button>
        <button type="button" class="secondary" id="chooseFolder">${icon("book")} Selecionar pasta</button>
        <span class="muted" id="fileCount">Nenhum arquivo selecionado</span>
      </div>
      <label>Assuntos <input name="subjects" placeholder="Tecnologia, Romance"></label>
      <label>Estante <input name="shelf" placeholder="MyBookLib"></label>
      <label class="wide">Tags <input name="tags" placeholder="faculdade, consulta, favorito"></label>
      <button type="submit">${icon("upload")} Enviar</button>
      <div class="message" id="uploadMessage"></div>
    </form>
  `;
  const fileInput = $("#fileInput");
  $("#chooseFiles").onclick = () => {
    fileInput.removeAttribute("webkitdirectory");
    fileInput.removeAttribute("directory");
    fileInput.click();
  };
  $("#chooseFolder").onclick = () => {
    fileInput.setAttribute("webkitdirectory", "");
    fileInput.setAttribute("directory", "");
    fileInput.click();
  };
  fileInput.onchange = () => {
    const valid = [...fileInput.files].filter((file) => /\.(epub|pdf)$/i.test(file.name));
    $("#fileCount").textContent = `${valid.length} livro(s) selecionado(s)`;
  };
  $("#uploadForm").onsubmit = async (event) => {
    event.preventDefault();
    const msg = $("#uploadMessage");
    const files = [...fileInput.files].filter((file) => /\.(epub|pdf)$/i.test(file.name));
    if (!files.length) {
      msg.textContent = "Selecione pelo menos um EPUB ou PDF.";
      msg.classList.add("error");
      return;
    }
    msg.textContent = "Enviando e processando livros...";
    msg.classList.remove("error");
    try {
      const baseForm = new FormData(event.currentTarget);
      baseForm.delete("file");
      const imported = [];
      const errors = [];
      const batchSize = 20;
      for (let start = 0; start < files.length; start += batchSize) {
        const batch = files.slice(start, start + batchSize);
        const form = new FormData();
        for (const [key, value] of baseForm.entries()) form.append(key, value);
        batch.forEach((file) => form.append("file", file, file.webkitRelativePath || file.name));
        msg.textContent = `Enviando lote ${Math.floor(start / batchSize) + 1} de ${Math.ceil(files.length / batchSize)} (${Math.min(start + batch.length, files.length)}/${files.length})...`;
        const result = await api("/api/books", { method: "POST", body: form });
        imported.push(...(result.books || [result.book]).filter(Boolean));
        errors.push(...(result.errors || []));
      }
      state.pagination.page = 1;
      await Promise.all([loadBooks(), loadTags(), loadRecentBooks()]);
      state.view = "library";
      renderShell();
      monitorImportedBooks(imported.map((book) => book?.id));
      if (errors.length) alert(errors.join("\n"));
    } catch (error) {
      msg.textContent = error.message;
      msg.classList.add("error");
    }
  };
}

function showBookModal(bookId) {
  const book = state.books.find((item) => item.id === bookId);
  const selectedSubjects = [...(book.subjects || [])];
  const subjectOptions = catalogSubjects();
  const modal = document.createElement("div");
  modal.className = "modal";
  const renderSubjectChips = () => {
    const box = $("#subjectChips", modal);
    if (!box) return;
    box.innerHTML = selectedSubjects.length
      ? selectedSubjects.map((subject, index) => `
          <span class="chip removable">
            ${escapeHtml(subject)}
            <button type="button" data-remove-subject="${index}" aria-label="Remover assunto">x</button>
          </span>`).join("")
      : `<span class="muted">Nenhum assunto selecionado.</span>`;
    box.querySelectorAll("[data-remove-subject]").forEach((button) => {
      button.onclick = () => {
        selectedSubjects.splice(Number(button.dataset.removeSubject), 1);
        renderSubjectChips();
      };
    });
  };
  modal.innerHTML = `
    <form class="modal-body form-grid" id="bookForm">
      <h2 class="wide">Editar livro</h2>
      <label>Titulo <input name="title" value="${escapeHtml(book.title)}"></label>
      <label>Autor <input name="author" value="${escapeHtml(book.author)}"></label>
      <label>Editora <input name="publisher" value="${escapeHtml(book.publisher)}"></label>
      <label>ISBN <input name="isbn" value="${escapeHtml(book.isbn)}"></label>
      <label>Idioma <input name="language" value="${escapeHtml(book.language)}"></label>
      <label>Publicacao <input name="publishedDate" value="${escapeHtml(book.publishedDate)}"></label>
      <label>Paginas <input name="pageCount" inputmode="numeric" value="${escapeHtml(book.pageCount)}"></label>
      <label>Estante <input name="shelf" value="${escapeHtml(book.shelf)}"></label>
      <label class="wide">Sinopse <textarea name="description" rows="5">${escapeHtml(book.description)}</textarea></label>
      <label class="wide">Assunto
        <input id="subjectPicker" list="subjectOptions" placeholder="Escolha ou digite um assunto">
        <datalist id="subjectOptions">
          ${subjectOptions.map((subject) => `<option value="${escapeHtml(subject)}"></option>`).join("")}
        </datalist>
      </label>
      <div class="wide subject-picker-actions">
        <button type="button" class="secondary" id="addSubjectToBook">Adicionar assunto</button>
        <button type="button" class="secondary" id="goSubjectsFromModal">Gerenciar assuntos</button>
      </div>
      <div class="wide chips" id="subjectChips"></div>
      <label class="wide">Status de leitura
        <select name="readingStatus">
          <option value="" ${!book.readingStatus ? "selected" : ""}>Em leitura</option>
          <option value="favorite" ${book.readingStatus === "favorite" ? "selected" : ""}>Favorito</option>
          <option value="planned" ${book.readingStatus === "planned" ? "selected" : ""}>Planejado</option>
          <option value="completed" ${book.readingStatus === "completed" ? "selected" : ""}>Concluido</option>
        </select>
      </label>
      <label class="wide">Tags <input name="tags" value="${escapeHtml((book.tags || []).join(", "))}"></label>
      <button type="submit">Salvar</button>
      <button type="button" class="danger" id="deleteBook">${icon("trash")} Excluir</button>
      <button type="button" class="secondary" id="closeModal">Cancelar</button>
    </form>
  `;
  document.body.appendChild(modal);
  renderSubjectChips();
  const addSelectedSubject = () => {
    const value = $("#subjectPicker", modal).value.trim();
    if (!value) return false;
    if (!selectedSubjects.includes(value)) selectedSubjects.push(value);
    $("#subjectPicker", modal).value = "";
    renderSubjectChips();
    return true;
  };
  $("#addSubjectToBook", modal).onclick = addSelectedSubject;
  $("#goSubjectsFromModal", modal).onclick = () => {
    modal.remove();
    state.view = "subjects";
    renderShell();
  };
  $("#closeModal", modal).onclick = () => modal.remove();
  $("#deleteBook", modal).onclick = async () => {
    if (!confirm("Excluir este livro da biblioteca?")) return;
    await api(`/api/books/${book.id}`, { method: "DELETE" });
    await Promise.all([loadBooks(), loadTags(), loadRecentBooks()]);
    modal.remove();
    renderShell();
  };
  $("#bookForm", modal).onsubmit = async (event) => {
    event.preventDefault();
    addSelectedSubject();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.subjects = selectedSubjects;
    data.tags = String(data.tags || "").split(",").map((x) => x.trim()).filter(Boolean);
    await api(`/api/books/${book.id}`, { method: "PATCH", body: JSON.stringify(data) });
    await Promise.all([loadBooks(), loadSubjects(), loadTags()]);
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
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const data = await api(`/api/books/${bookId}/kindle`, { method: "POST", body: JSON.stringify(form) });
      state.user.kindleEmail = form.kindleEmail;
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
  if (state.readerSettings.contentWidth < 900) state.readerSettings.contentWidth = 980;
  const max = Math.max(0, (book.epub?.spine?.length || 1) - 1);
  const percent = Math.round(book.readingProgress?.percent ?? (max ? (state.chapter / max) * 100 : 0));
  const panelOpen = state.readerPanel ? "panel-open" : "";
  app.innerHTML = `
    <section class="reader reader-${state.readerSettings.theme} ${panelOpen}" style="--reader-font:${state.readerSettings.fontSize}px;--reader-width:${state.readerSettings.contentWidth}px;--reader-line:${state.readerSettings.lineHeight};--pdf-zoom:${state.readerSettings.pdfZoom / 100}">
      <header class="reader-topbar">
        <div class="reader-left">
          <button class="reader-icon" id="backToLibrary" title="Voltar">${icon("left")}</button>
          <button class="reader-icon ${state.readerPanel === "search" ? "active" : ""}" data-reader-panel="search" title="Buscar">${icon("search")}</button>
        </div>
        <div class="reader-title">${escapeHtml(book.title || book.originalName)}</div>
        <div class="reader-tools">
          <button class="reader-icon ${state.readerPanel === "notes" ? "active" : ""}" data-reader-panel="notes" title="Anotacoes">${icon("bell")}</button>
          <button class="reader-icon ${state.readerPanel === "contents" ? "active" : ""}" data-reader-panel="contents" title="Conteudo">${icon("book")}</button>
          <button class="reader-icon ${state.readerPanel === "appearance" ? "active" : ""}" data-reader-panel="appearance" title="Aparencia">A</button>
          <button class="reader-icon" id="readerFullscreen" title="Tela cheia">⛶</button>
        </div>
      </header>
      <div class="reader-stage">
        ${state.readerPanel ? readerSidePanel(book) : ""}
        <button class="page-turn page-prev" id="prevChapter" title="Anterior" ${isEpub ? "" : "disabled"}>${icon("left")}</button>
        <main class="reader-page">
          ${isEpub ? epubReader(book) : `<div class="pdf-shell"><iframe class="pdf-frame" src="/files/${book.id}"></iframe></div>`}
        </main>
        <button class="page-turn page-next" id="nextChapter" title="Proximo" ${isEpub ? "" : "disabled"}>${icon("right")}</button>
      </div>
      <footer class="reader-progressbar">
        <button class="reader-play" id="readerPlay" title="Continuar">▶</button>
        <button class="reader-more" title="Mais">...</button>
        <div class="reader-progress-track">
          <input id="readerProgress" type="range" min="0" max="${max}" value="${state.chapter}" ${isEpub ? "" : "disabled"}>
          <div class="reader-progress-label">${escapeHtml(book.readingProgress?.label || (isEpub ? `Capitulo ${state.chapter + 1}` : "PDF"))}</div>
        </div>
        ${isEpub ? `<div class="reader-nav-buttons"><button id="readerPrevBottom">Anterior</button><button id="readerNextBottom">Proximo</button></div>` : ""}
        <div class="reader-progress-percent">${isEpub ? `${percent}%` : book.format.toUpperCase()}</div>
      </footer>
    </section>
  `;
  $("#backToLibrary").onclick = async () => {
    state.view = "library";
    state.selectedBook = null;
    state.annotations = [];
    await Promise.all([loadBooks(), loadRecentBooks()]);
    renderShell();
  };
  app.querySelectorAll("[data-reader-panel]").forEach((button) => button.onclick = () => {
    state.readerPanel = state.readerPanel === button.dataset.readerPanel ? "" : button.dataset.readerPanel;
    renderReader();
  });
  $("#readerFullscreen").onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  if (isEpub) bindEpubReader(book);
  bindAnnotations(book);
  bindReaderPanels(book);
  const onReaderKeydown = (event) => {
    if (!isEpub || event.target.closest("textarea, input, select")) return;
    if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      $("#prevChapter")?.click();
    }
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      $("#nextChapter")?.click();
    }
    if (event.key === "Home") {
      event.preventDefault();
      state.chapter = 0;
      saveReaderProgress(book).then(() => renderReader());
    }
    if (event.key === "End") {
      event.preventDefault();
      state.chapter = max;
      saveReaderProgress(book).then(() => renderReader());
    }
    if (event.key === "Escape") $("#backToLibrary")?.click();
  };
  document.addEventListener("keydown", onReaderKeydown);
  $("#backToLibrary").addEventListener("click", () => document.removeEventListener("keydown", onReaderKeydown), { once: true });
}

async function deleteSelectedBooks() {
  const ids = [...state.selectedBookIds];
  if (!ids.length) return;
  if (!confirm(`Excluir ${ids.length} livro(s) selecionado(s)?`)) return;
  for (const id of ids) {
    await api(`/api/books/${id}`, { method: "DELETE" });
  }
  state.selectedBookIds.clear();
  await Promise.all([loadBooks(), loadTags(), loadRecentBooks()]);
  renderLibrary();
}

function annotationPanel(book) {
  return `
    <aside class="annotation-panel">
      <h2>Anotacoes</h2>
      <form id="annotationForm" class="annotation-form">
        <label>Trecho selecionado <textarea name="quote" id="annotationQuote" rows="4" placeholder="Selecione um trecho no EPUB ou escreva aqui"></textarea></label>
        <label>Nota <textarea name="note" rows="4" placeholder="Escreva sua anotacao"></textarea></label>
        <label>Cor <select name="color"><option value="#fff2a8">Amarelo</option><option value="#c7f9cc">Verde</option><option value="#bfdbfe">Azul</option><option value="#fecdd3">Rosa</option></select></label>
        <button type="submit">Salvar anotacao</button>
        <div class="message" id="annotationMessage"></div>
      </form>
      <div class="annotation-list">
        ${state.annotations.length ? state.annotations.map(annotationItem).join("") : `<div class="empty compact">Nenhuma anotacao neste livro.</div>`}
      </div>
    </aside>
  `;
}

function readerSidePanel(book) {
  if (state.readerPanel === "search") return `
    <aside class="reader-panel search-panel">
      <div class="reader-panel-head"><button class="reader-icon" data-close-reader-panel>${icon("left")}</button><h2>Buscar</h2></div>
      <label class="reader-search">${icon("search")}<input id="readerSearchInput" placeholder="Buscar no titulo, anotacoes e capitulos" value="${escapeHtml(state.readerSearch)}"></label>
      <div class="reader-panel-list">${readerSearchResults(book)}</div>
    </aside>
  `;
  if (state.readerPanel === "contents") return `
    <aside class="reader-panel">
      <div class="reader-tabs"><button class="active">Conteudo</button><button>Marcadores</button></div>
      <div class="reader-panel-list">${readerContents(book)}</div>
    </aside>
  `;
  if (state.readerPanel === "notes") return `
    <aside class="reader-panel notes-panel">
      <div class="reader-panel-head"><h2>Destaques</h2><button class="reader-icon" data-close-reader-panel>${icon("close")}</button></div>
      <div class="reader-note-filters"><button>Meus destaques</button><button>Tags</button></div>
      ${annotationPanel(book)}
    </aside>
  `;
  if (state.readerPanel === "appearance") return `
    <aside class="reader-panel appearance-panel">
      <select id="readerThemeSelect">
        <option value="paper" ${state.readerSettings.theme === "paper" ? "selected" : ""}>Padrao</option>
        <option value="sepia" ${state.readerSettings.theme === "sepia" ? "selected" : ""}>Sepia</option>
        <option value="dark" ${state.readerSettings.theme === "dark" ? "selected" : ""}>Escuro</option>
      </select>
      <div class="theme-swatches">
        ${["paper", "sepia", "dark", "contrast", "gray"].map((theme) => `<button class="${state.readerSettings.theme === theme ? "active" : ""} swatch-${theme}" data-reader-theme="${theme}">Aa</button>`).join("")}
      </div>
      ${readerSettingControl("Tamanho", "fontSize", 14, 28, state.readerSettings.fontSize)}
      ${readerSettingControl("Largura", "contentWidth", 760, 1280, state.readerSettings.contentWidth)}
      ${readerSettingControl("Altura da linha", "lineHeight", 1.2, 2.2, state.readerSettings.lineHeight, 0.1)}
      ${readerSettingControl("Zoom PDF", "pdfZoom", 70, 160, state.readerSettings.pdfZoom)}
      <label class="reader-toggle"><span>Padrao da editora</span><input id="publisherDefaults" type="checkbox" ${state.readerSettings.publisherDefaults ? "checked" : ""}></label>
      <label class="reader-toggle"><span>Rolagem vertical</span><input id="verticalScroll" type="checkbox" ${state.readerSettings.verticalScroll ? "checked" : ""}></label>
      <label class="reader-toggle"><span>Duas colunas</span><input id="readerColumns" type="checkbox" ${state.readerSettings.columns ? "checked" : ""}></label>
    </aside>
  `;
  return "";
}

function readerSettingControl(label, key, min, max, value, step = 1) {
  return `
    <label class="reader-control">
      <span>${label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-reader-setting="${key}">
    </label>
  `;
}

function readerContents(book) {
  const spine = book.epub?.spine || [];
  if (!spine.length) return `<div class="empty compact">Sem sumario extraido.</div>`;
  return spine.map((chapter, index) => {
    const label = pathLabel(chapter, index);
    return `<button class="contents-row ${index === state.chapter ? "active" : ""}" data-chapter="${index}">${escapeHtml(label)}</button>`;
  }).join("");
}

function pathLabel(pathValue, index) {
  const file = String(pathValue || "").split(/[\\/]/).pop() || `Capitulo ${index + 1}`;
  return file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function readerSearchResults(book) {
  const q = state.readerSearch.trim().toLowerCase();
  if (!q) return `<div class="empty compact">Digite para buscar.</div>`;
  const rows = [];
  if ((book.title || "").toLowerCase().includes(q)) rows.push(`<button class="contents-row" data-chapter="${state.chapter}">${escapeHtml(book.title)}</button>`);
  for (const item of state.annotations) {
    const text = `${item.quote || ""} ${item.note || ""}`.toLowerCase();
    if (text.includes(q)) rows.push(`<button class="contents-row" data-chapter="${Number(item.chapter || 0)}">${escapeHtml(item.quote || item.note || "Anotacao")}</button>`);
  }
  return rows.length ? rows.join("") : `<div class="empty compact">Nada encontrado.</div>`;
}

function bindReaderPanels(book) {
  app.querySelectorAll("[data-close-reader-panel]").forEach((button) => button.onclick = () => {
    state.readerPanel = "";
    renderReader();
  });
  $("#readerSearchInput")?.addEventListener("input", (event) => {
    state.readerSearch = event.target.value;
    $(".reader-panel-list").innerHTML = readerSearchResults(book);
    bindReaderPanelChapterButtons(book);
  });
  bindReaderPanelChapterButtons(book);
  app.querySelectorAll("[data-reader-theme]").forEach((button) => button.onclick = () => {
    state.readerSettings.theme = button.dataset.readerTheme;
    saveReaderSettings();
    renderReader();
  });
  $("#readerThemeSelect")?.addEventListener("change", (event) => {
    state.readerSettings.theme = event.target.value;
    saveReaderSettings();
    renderReader();
  });
  app.querySelectorAll("[data-reader-setting]").forEach((input) => input.oninput = () => {
    state.readerSettings[input.dataset.readerSetting] = Number(input.value);
    saveReaderSettings();
    renderReader();
  });
  $("#publisherDefaults")?.addEventListener("change", (event) => { state.readerSettings.publisherDefaults = event.target.checked; saveReaderSettings(); });
  $("#verticalScroll")?.addEventListener("change", (event) => { state.readerSettings.verticalScroll = event.target.checked; saveReaderSettings(); renderReader(); });
  $("#readerColumns")?.addEventListener("change", (event) => { state.readerSettings.columns = event.target.checked; saveReaderSettings(); renderReader(); });
}

function bindReaderPanelChapterButtons(book) {
  app.querySelectorAll(".contents-row[data-chapter]").forEach((button) => button.onclick = async () => {
    state.chapter = Number(button.dataset.chapter);
    await saveReaderProgress(book);
    renderReader();
  });
}

function annotationItem(item) {
  return `
    <article class="annotation-item" style="border-left-color:${escapeHtml(item.color)}">
      ${item.quote ? `<blockquote>${escapeHtml(item.quote)}</blockquote>` : ""}
      ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
      <small>Capitulo ${Number(item.chapter || 0) + 1}</small>
      <button class="secondary icon" title="Excluir anotacao" data-delete-annotation="${item.id}">${icon("trash")}</button>
    </article>
  `;
}

function selectedReaderText() {
  const frame = $(".reader-frame");
  try {
    return frame?.contentWindow?.getSelection()?.toString().trim() || "";
  } catch {
    return "";
  }
}

function bindAnnotations(book) {
  const quote = $("#annotationQuote");
  $(".reader-frame")?.addEventListener("load", () => {
    const doc = $(".reader-frame")?.contentDocument;
    doc?.addEventListener("selectionchange", () => {
      const selected = selectedReaderText();
      if (selected && quote) quote.value = selected;
    });
  });
  const form = $("#annotationForm");
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const msg = $("#annotationMessage");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.chapter = state.chapter;
    try {
      await api(`/api/books/${book.id}/annotations`, { method: "POST", body: JSON.stringify(data) });
      await loadAnnotations(book.id);
      renderReader();
    } catch (error) {
      msg.textContent = error.message;
      msg.classList.add("error");
    }
  };
  app.querySelectorAll("[data-delete-annotation]").forEach((button) => button.onclick = async () => {
    await api(`/api/books/${book.id}/annotations/${button.dataset.deleteAnnotation}`, { method: "DELETE" });
    await loadAnnotations(book.id);
    renderReader();
  });
}

function epubReader(book) {
  const spine = book.epub?.spine || [];
  const src = spine[state.chapter] ? `/epub/${book.id}/${encodeURIComponent(spine[state.chapter]).replaceAll("%2F", "/")}` : "";
  return `
    <div class="epub-pane ${state.readerSettings.verticalScroll ? "is-scroll" : ""} ${state.readerSettings.columns ? "is-columns" : ""}">
      ${src ? `<iframe class="reader-frame" src="${src}"></iframe>` : `<div class="empty">Este EPUB ainda esta sendo preparado.</div>`}
    </div>
  `;
}

async function saveReaderProgress(book) {
  const max = (book.epub?.spine?.length || 1) - 1;
  const percent = max > 0 ? Math.round((state.chapter / max) * 100) : 100;
  book.readingProgress = { position: state.chapter, label: `Capitulo ${state.chapter + 1}`, percent };
  await api(`/api/books/${book.id}`, {
    method: "PATCH",
    body: JSON.stringify({ readingProgress: book.readingProgress })
  });
}

function bindEpubReader(book) {
  const max = (book.epub?.spine?.length || 1) - 1;
  $(".reader-frame")?.addEventListener("load", applyReaderFrameStyles);
  app.querySelectorAll("[data-chapter]").forEach((button) => button.onclick = async () => {
    state.chapter = Number(button.dataset.chapter);
    await saveReaderProgress(book);
    renderReader();
  });
  $("#prevChapter").onclick = async () => {
    state.chapter = Math.max(0, state.chapter - 1);
    await saveReaderProgress(book);
    renderReader();
  };
  $("#nextChapter").onclick = async () => {
    state.chapter = Math.min(max, state.chapter + 1);
    await saveReaderProgress(book);
    renderReader();
  };
  $("#readerPrevBottom")?.addEventListener("click", () => $("#prevChapter")?.click());
  $("#readerNextBottom")?.addEventListener("click", () => $("#nextChapter")?.click());
  $("#readerPlay")?.addEventListener("click", () => $("#nextChapter")?.click());
  $("#readerProgress")?.addEventListener("input", async (event) => {
    state.chapter = Number(event.target.value);
    await saveReaderProgress(book);
    renderReader();
  });
}

function applyReaderFrameStyles() {
  const frame = $(".reader-frame");
  const doc = frame?.contentDocument;
  if (!doc) return;
  const style = doc.createElement("style");
  style.textContent = `
    html, body {
      background: transparent !important;
      color: inherit !important;
      font-size: ${state.readerSettings.fontSize}px !important;
      line-height: ${state.readerSettings.lineHeight} !important;
      width: auto !important;
      min-width: 0 !important;
      max-width: ${state.readerSettings.contentWidth}px !important;
      margin: 0 auto !important;
      padding: 42px 64px 96px !important;
      box-sizing: border-box !important;
      overflow-wrap: normal !important;
      word-break: normal !important;
      hyphens: auto !important;
    }
    body { font-family: Georgia, "Times New Roman", serif !important; }
    p, div, li { max-width: none !important; }
    p { margin: 0 0 1em !important; text-align: left !important; }
    h1, h2, h3 { line-height: 1.18 !important; }
    img { max-width: 100% !important; height: auto !important; }
    ${state.readerSettings.columns ? `body { column-count: 2; column-gap: 54px; max-width: ${Math.max(980, state.readerSettings.contentWidth)}px !important; }` : ""}
  `;
  doc.head.appendChild(style);
}

boot().catch((error) => {
  app.innerHTML = `<section class="login"><div class="login-card"><h1>Erro</h1><p>${escapeHtml(error.message)}</p></div></section>`;
});
