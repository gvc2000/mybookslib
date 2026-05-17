const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { URL } = require("url");
const https = require("https");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORAGE_DIR = path.join(ROOT, "storage");
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");
const COVER_DIR = path.join(STORAGE_DIR, "covers");
const EPUB_DIR = path.join(STORAGE_DIR, "epubs");
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".xhtml": "application/xhtml+xml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".opf": "application/oebps-package+xml; charset=utf-8",
  ".ncx": "application/x-dtbncx+xml; charset=utf-8"
};

async function ensureDirs() {
  await Promise.all([DATA_DIR, UPLOAD_DIR, COVER_DIR, EPUB_DIR, PUBLIC_DIR].map((dir) => fsp.mkdir(dir, { recursive: true })));
  if (!fs.existsSync(DB_PATH)) {
    const admin = createUser("Administrador", "admin@local", "admin123", "admin");
    await saveDb({ users: [admin], books: [], subjects: [], shelves: [], sessions: [] });
  }
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

async function saveDb(db) {
  await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(hashPassword(password, salt).split(":")[1], "hex"));
}

function createUser(name, email, password, role = "user") {
  const now = new Date().toISOString();
  return {
    id: id("usr"),
    name,
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    role,
    status: "active",
    kindleEmail: "",
    storageLimitMb: 1024,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null
  };
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function sign(value) {
  const secret = process.env.SESSION_SECRET || "dev-secret-change-me";
  const sig = crypto.createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${sig}`;
}

function unsign(signed) {
  if (!signed || !signed.includes(".")) return null;
  const value = signed.slice(0, signed.lastIndexOf("."));
  const expected = sign(value);
  const expectedBuffer = Buffer.from(expected);
  const signedBuffer = Buffer.from(signed);
  if (expectedBuffer.length !== signedBuffer.length) return null;
  return crypto.timingSafeEqual(expectedBuffer, signedBuffer) ? value : null;
}

function currentUser(req) {
  const userId = unsign(parseCookies(req).session);
  if (!userId) return null;
  const db = readDb();
  const user = db.users.find((item) => item.id === userId && item.status === "active");
  return user || null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, body) {
  send(res, status, JSON.stringify(body), { "Content-Type": "application/json; charset=utf-8" });
}

function notFound(res) {
  json(res, 404, { error: "Nao encontrado" });
}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Arquivo muito grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) return {};
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const parts = {};
  const raw = buffer.toString("binary");
  for (const segment of raw.split(boundary).slice(1, -1)) {
    const clean = segment.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const split = clean.indexOf("\r\n\r\n");
    if (split < 0) continue;
    const rawHeaders = clean.slice(0, split);
    const content = clean.slice(split + 4);
    const disposition = /content-disposition:[^\r\n]*\bname="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(rawHeaders);
    if (disposition) {
      parts[disposition[1]] = {
        filename: disposition[2],
        contentType: (/content-type:\s*([^\r\n]+)/i.exec(rawHeaders) || [])[1],
        data: Buffer.from(content, "binary")
      };
    }
  }
  return parts;
}

function safeJoin(base, requested) {
  const resolved = path.resolve(base, requested || "");
  return resolved.startsWith(path.resolve(base)) ? resolved : null;
}

function execPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

async function extractEpub(filePath, bookId) {
  const outDir = path.join(EPUB_DIR, bookId);
  const tempZip = path.join(EPUB_DIR, `${bookId}.zip`);
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.copyFile(filePath, tempZip);
  await execPowerShell(["-Command", `Expand-Archive -LiteralPath '${tempZip.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`]);
  await fsp.rm(tempZip, { force: true });
  return outDir;
}

function attr(xml, name) {
  const match = new RegExp(`${name}=["']([^"']+)["']`, "i").exec(xml);
  return match ? decodeXml(match[1]) : "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function textTag(xml, tag) {
  const match = new RegExp(`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`, "i").exec(xml);
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

async function analyzeEpub(book, filePath) {
  const outDir = await extractEpub(filePath, book.id);
  const containerPath = path.join(outDir, "META-INF", "container.xml");
  const container = await fsp.readFile(containerPath, "utf8");
  const opfRel = attr((container.match(/<rootfile\b[^>]*>/i) || [""])[0], "full-path");
  if (!opfRel) throw new Error("Nao foi possivel localizar o arquivo OPF do EPUB");
  const opfPath = path.join(outDir, opfRel);
  const opfDir = path.dirname(opfPath);
  const opf = await fsp.readFile(opfPath, "utf8");
  book.title = book.title || textTag(opf, "title") || path.parse(book.originalName).name;
  book.author = book.author || textTag(opf, "creator") || "Autor desconhecido";
  book.publisher = textTag(opf, "publisher");
  book.language = textTag(opf, "language");
  const identifier = textTag(opf, "identifier");
  book.isbn = /(?:97[89])?\d[\d -]{8,}\d/.test(identifier) ? identifier.replace(/[^\dXx]/g, "") : "";
  const manifest = {};
  for (const item of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const itemId = attr(tag, "id");
    if (itemId) manifest[itemId] = { href: attr(tag, "href"), type: attr(tag, "media-type"), properties: attr(tag, "properties") };
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => manifest[match[1]])
    .filter(Boolean)
    .map((item) => path.relative(outDir, path.join(opfDir, item.href)).replace(/\\/g, "/"));
  book.epub = { root: opfRel.replace(/\\/g, "/"), spine };
  const coverMeta = (/name=["']cover["'][^>]+content=["']([^"']+)["']/i.exec(opf) || [])[1];
  const coverItem = Object.values(manifest).find((item) => item.properties.includes("cover-image")) || manifest[coverMeta];
  if (coverItem) {
    const coverSource = path.join(opfDir, coverItem.href);
    if (fs.existsSync(coverSource)) {
      const ext = path.extname(coverSource) || ".jpg";
      const coverPath = path.join(COVER_DIR, `${book.id}${ext}`);
      await fsp.copyFile(coverSource, coverPath);
      book.coverPath = coverPath;
    }
  }
  if (!book.coverPath && book.isbn) {
    book.coverUrl = `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`;
  }
}

async function analyzePdf(book) {
  book.title = book.title || path.parse(book.originalName).name;
  book.author = book.author || "Autor desconhecido";
  book.coverSvg = makeCoverSvg(book.title, book.author, "#155e75", "#f8fafc");
}

function makeCoverSvg(title, author, bg = "#334155", fg = "#ffffff") {
  const esc = (v) => String(v || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="620" viewBox="0 0 420 620"><rect width="420" height="620" fill="${bg}"/><rect x="28" y="28" width="364" height="564" fill="none" stroke="${fg}" stroke-opacity=".34" stroke-width="2"/><text x="48" y="230" font-family="Georgia,serif" font-size="34" font-weight="700" fill="${fg}">${esc(title).slice(0, 42)}</text><text x="48" y="287" font-family="Arial,sans-serif" font-size="19" fill="${fg}" opacity=".82">${esc(author).slice(0, 50)}</text><text x="48" y="540" font-family="Arial,sans-serif" font-size="16" fill="${fg}" opacity=".65">PDF</text></svg>`;
}

async function processBook(book, filePath) {
  try {
    book.status = "processing";
    if (book.format === "epub") await analyzeEpub(book, filePath);
    if (book.format === "pdf") await analyzePdf(book);
    book.status = "ready";
  } catch (error) {
    book.status = "needs_review";
    book.processingError = error.message;
    book.title = book.title || path.parse(book.originalName).name;
    book.author = book.author || "Autor desconhecido";
  }
  book.updatedAt = new Date().toISOString();
  const db = readDb();
  const index = db.books.findIndex((item) => item.id === book.id);
  if (index > -1) db.books[index] = book;
  await saveDb(db);
}

function publicUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

function userBooks(db, user) {
  return db.books.filter((book) => user.role === "admin" && new URLSearchParams("").get("all") ? true : book.userId === user.id);
}

function routeApi(req, res, pathname, user) {
  (async () => {
    if (pathname === "/api/me" && req.method === "GET") return json(res, 200, { user: user ? publicUser(user) : null });
    if (pathname === "/api/login" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 1024 * 50)).toString("utf8") || "{}");
      const db = readDb();
      const found = db.users.find((item) => item.email === String(body.email || "").toLowerCase() && item.status === "active");
      if (!found || !verifyPassword(String(body.password || ""), found.passwordHash)) return json(res, 401, { error: "E-mail ou senha invalidos" });
      found.lastLoginAt = new Date().toISOString();
      await saveDb(db);
      send(res, 200, JSON.stringify({ user: publicUser(found) }), {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": `session=${encodeURIComponent(sign(found.id))}; HttpOnly; SameSite=Lax; Path=/`
      });
      return;
    }
    if (pathname === "/api/logout" && req.method === "POST") {
      return send(res, 200, "{}", { "Content-Type": "application/json", "Set-Cookie": "session=; Max-Age=0; Path=/" });
    }
    if (!user) return json(res, 401, { error: "Login necessario" });
    const db = readDb();

    if (pathname === "/api/books" && req.method === "GET") {
      return json(res, 200, { books: db.books.filter((book) => book.userId === user.id) });
    }
    if (pathname === "/api/books" && req.method === "POST") {
      const parts = parseMultipart(await readBody(req), req.headers["content-type"]);
      const file = parts.file;
      if (!file || !file.filename) return json(res, 400, { error: "Arquivo nao enviado" });
      const ext = path.extname(file.filename).toLowerCase();
      if (![".epub", ".pdf"].includes(ext)) return json(res, 400, { error: "Apenas EPUB e PDF sao aceitos" });
      const bookId = id("book");
      const storedName = `${bookId}${ext}`;
      const filePath = path.join(UPLOAD_DIR, storedName);
      await fsp.writeFile(filePath, file.data);
      const now = new Date().toISOString();
      const book = {
        id: bookId,
        userId: user.id,
        title: "",
        author: "",
        publisher: "",
        isbn: "",
        language: "",
        format: ext.slice(1),
        originalName: path.basename(file.filename),
        filePath,
        fileSize: file.data.length,
        coverPath: "",
        coverUrl: "",
        coverSvg: "",
        subjects: String(parts.subjects?.data || "").split(",").map((x) => x.trim()).filter(Boolean),
        tags: String(parts.tags?.data || "").split(",").map((x) => x.trim()).filter(Boolean),
        shelf: String(parts.shelf?.data || "").trim(),
        readingProgress: { position: 0, label: "", percent: 0 },
        status: "uploaded",
        createdAt: now,
        updatedAt: now
      };
      db.books.push(book);
      await saveDb(db);
      processBook(book, filePath);
      return json(res, 201, { book });
    }
    const bookMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
    if (bookMatch && req.method === "PATCH") {
      const book = db.books.find((item) => item.id === bookMatch[1] && item.userId === user.id);
      if (!book) return notFound(res);
      const body = JSON.parse((await readBody(req, 1024 * 100)).toString("utf8") || "{}");
      ["title", "author", "publisher", "isbn", "language", "shelf"].forEach((key) => {
        if (body[key] !== undefined) book[key] = String(body[key]);
      });
      if (Array.isArray(body.subjects)) book.subjects = body.subjects.map(String);
      if (Array.isArray(body.tags)) book.tags = body.tags.map(String);
      if (body.readingProgress) book.readingProgress = body.readingProgress;
      book.updatedAt = new Date().toISOString();
      await saveDb(db);
      return json(res, 200, { book });
    }
    if (bookMatch && req.method === "DELETE") {
      const index = db.books.findIndex((item) => item.id === bookMatch[1] && item.userId === user.id);
      if (index < 0) return notFound(res);
      const [book] = db.books.splice(index, 1);
      await saveDb(db);
      await Promise.allSettled([
        fsp.rm(book.filePath, { force: true }),
        book.coverPath ? fsp.rm(book.coverPath, { force: true }) : null,
        fsp.rm(path.join(EPUB_DIR, book.id), { recursive: true, force: true })
      ]);
      return json(res, 200, { ok: true });
    }
    const kindleMatch = pathname.match(/^\/api\/books\/([^/]+)\/kindle$/);
    if (kindleMatch && req.method === "POST") {
      const book = db.books.find((item) => item.id === kindleMatch[1] && item.userId === user.id);
      if (!book) return notFound(res);
      const body = JSON.parse((await readBody(req, 1024 * 20)).toString("utf8") || "{}");
      const kindleEmail = String(body.kindleEmail || user.kindleEmail || "").trim();
      if (!kindleEmail) return json(res, 400, { error: "Cadastre o e-mail Kindle primeiro" });
      user.kindleEmail = kindleEmail;
      user.updatedAt = new Date().toISOString();
      await saveDb(db);
      return json(res, 200, {
        ok: true,
        message: process.env.SMTP_HOST
          ? "Envio SMTP configurado no ambiente. Integre o provedor em production-mailer.js."
          : "Configuracao salva. Para envio real, configure SMTP_HOST, SMTP_USER e SMTP_PASS no servidor."
      });
    }
    if (pathname === "/api/admin/users" && user.role === "admin" && req.method === "GET") {
      return json(res, 200, { users: db.users.map(publicUser) });
    }
    if (pathname === "/api/admin/users" && user.role === "admin" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 1024 * 50)).toString("utf8") || "{}");
      if (!body.email || !body.password || !body.name) return json(res, 400, { error: "Nome, e-mail e senha sao obrigatorios" });
      if (db.users.some((item) => item.email === String(body.email).toLowerCase())) return json(res, 409, { error: "E-mail ja cadastrado" });
      const created = createUser(String(body.name), String(body.email), String(body.password), body.role === "admin" ? "admin" : "user");
      db.users.push(created);
      await saveDb(db);
      return json(res, 201, { user: publicUser(created) });
    }
    const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && user.role === "admin" && req.method === "PATCH") {
      const target = db.users.find((item) => item.id === userMatch[1]);
      if (!target) return notFound(res);
      const body = JSON.parse((await readBody(req, 1024 * 50)).toString("utf8") || "{}");
      ["name", "email", "role", "status", "kindleEmail"].forEach((key) => {
        if (body[key] !== undefined) target[key] = String(body[key]);
      });
      if (body.password) target.passwordHash = hashPassword(String(body.password));
      target.updatedAt = new Date().toISOString();
      await saveDb(db);
      return json(res, 200, { user: publicUser(target) });
    }
    notFound(res);
  })().catch((error) => json(res, 500, { error: error.message }));
}

async function serveProtectedFile(req, res, pathname, user) {
  if (!/^\/(covers|files|epub)\//.test(pathname)) return false;
  if (!user) return send(res, 302, "", { Location: "/" });
  const db = readDb();
  const cover = pathname.match(/^\/covers\/([^/]+)$/);
  if (cover) {
    const book = db.books.find((item) => item.id === cover[1] && item.userId === user.id);
    if (!book) return notFound(res);
    if (book.coverSvg) return send(res, 200, book.coverSvg, { "Content-Type": "image/svg+xml" });
    if (book.coverPath) return streamFile(res, book.coverPath, req);
    return send(res, 200, makeCoverSvg(book.title, book.author), { "Content-Type": "image/svg+xml" });
  }
  const file = pathname.match(/^\/files\/([^/]+)$/);
  if (file) {
    const book = db.books.find((item) => item.id === file[1] && item.userId === user.id);
    if (!book) return notFound(res);
    return streamFile(res, book.filePath, req);
  }
  const epub = pathname.match(/^\/epub\/([^/]+)\/(.+)$/);
  if (epub) {
    const book = db.books.find((item) => item.id === epub[1] && item.userId === user.id);
    if (!book) return notFound(res);
    const filePath = safeJoin(path.join(EPUB_DIR, book.id), decodeURIComponent(epub[2]));
    if (!filePath || !fs.existsSync(filePath)) return notFound(res);
    return streamFile(res, filePath, req);
  }
  return false;
}

function streamFile(res, filePath, req) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const range = req?.headers?.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    res.writeHead(206, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function servePublic(req, res, pathname) {
  const route = pathname === "/" ? "/index.html" : pathname;
  const filePath = safeJoin(PUBLIC_DIR, decodeURIComponent(route.slice(1)));
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return notFound(res);
  streamFile(res, filePath, req);
}

async function main() {
  await ensureDirs();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const user = currentUser(req);
    if (url.pathname.startsWith("/api/")) return routeApi(req, res, url.pathname, user);
    const protectedServed = await serveProtectedFile(req, res, url.pathname, user);
    if (protectedServed !== false) return;
    return servePublic(req, res, url.pathname);
  });
  server.listen(PORT, () => {
    console.log(`Biblioteca Digital em http://localhost:${PORT}`);
    console.log("Login inicial: admin@local / admin123");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
