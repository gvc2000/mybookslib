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
const LIBRARY_DIR = path.join(STORAGE_DIR, "my-books");
const LEGACY_UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");
const UPLOAD_DIR = LIBRARY_DIR;
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
    await saveDb({ users: [admin], books: [], annotations: [], subjects: [], shelves: [], sessions: [] });
  }
  const db = readDb();
  let migrated = false;
  if (!Array.isArray(db.annotations)) {
    db.annotations = [];
    migrated = true;
  }
  if (!Array.isArray(db.subjects)) {
    db.subjects = [];
    migrated = true;
  }
  const catalogBefore = (db.subjects || []).length;
  ensureSubjectsInCatalog(db, (db.books || []).flatMap((book) => book.subjects || []));
  if ((db.subjects || []).length !== catalogBefore) migrated = true;
  for (const book of db.books || []) {
    ["originalName", "relativeFolder"].forEach((key) => {
      if (book[key]) {
        const repaired = repairMojibake(book[key]);
        if (repaired !== book[key]) {
          book[key] = repaired;
          book.updatedAt = new Date().toISOString();
          migrated = true;
        }
      }
    });
    const currentPath = String(book.filePath || "");
    if (!book.fileHash && currentPath && fs.existsSync(currentPath)) {
      book.fileHash = crypto.createHash("sha256").update(await fsp.readFile(currentPath)).digest("hex");
      book.updatedAt = new Date().toISOString();
      migrated = true;
    }
    if (currentPath && path.resolve(path.dirname(currentPath)) === path.resolve(LEGACY_UPLOAD_DIR) && fs.existsSync(currentPath)) {
      const targetPath = path.join(LIBRARY_DIR, path.basename(currentPath));
      await fsp.rename(currentPath, targetPath).catch(async () => {
        await fsp.copyFile(currentPath, targetPath);
        await fsp.rm(currentPath, { force: true });
      });
      book.filePath = targetPath;
      book.updatedAt = new Date().toISOString();
      migrated = true;
    }
  }
  if (migrated) await saveDb(db);
}

function repairMojibake(value) {
  const text = String(value || "");
  if (!/[ÃÂ]/.test(text)) return text;
  const repaired = Buffer.from(text, "latin1").toString("utf8");
  return repaired.includes("\uFFFD") ? text : repaired;
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
  if (!salt || !hash) return false;
  const storedHash = Buffer.from(hash, "hex");
  const expectedHash = Buffer.from(hashPassword(password, salt).split(":")[1], "hex");
  return storedHash.length === expectedHash.length && crypto.timingSafeEqual(storedHash, expectedHash);
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
  const raw = buffer.toString("latin1");
  for (const segment of raw.split(boundary).slice(1, -1)) {
    const clean = segment.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const split = clean.indexOf("\r\n\r\n");
    if (split < 0) continue;
    const rawHeaders = clean.slice(0, split);
    const content = clean.slice(split + 4);
    const disposition = /content-disposition:[^\r\n]*\bname="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(rawHeaders);
    if (disposition) {
      const part = {
        filename: decodeMultipartText(disposition[2] || ""),
        contentType: (/content-type:\s*([^\r\n]+)/i.exec(rawHeaders) || [])[1],
        data: Buffer.from(content, "latin1")
      };
      if (parts[disposition[1]]) {
        parts[disposition[1]] = Array.isArray(parts[disposition[1]]) ? parts[disposition[1]] : [parts[disposition[1]]];
        parts[disposition[1]].push(part);
      } else {
        parts[disposition[1]] = part;
      }
    }
  }
  return parts;
}

function decodeMultipartText(value) {
  return Buffer.from(String(value || ""), "latin1").toString("utf8");
}

function safeJoin(base, requested) {
  const resolved = path.resolve(base, requested || "");
  const root = path.resolve(base);
  const relative = path.relative(root, resolved);
  return relative && (relative.startsWith("..") || path.isAbsolute(relative)) ? null : resolved;
}

function execPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

function execFilePromise(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : require("http");
    const req = client.get(target, { headers: { "User-Agent": "MyBookLib/0.1" }, timeout: 10000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
        res.resume();
        const next = new URL(res.headers.location, target).toString();
        requestBuffer(next, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers["content-type"] || "" }));
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado ao buscar capa")));
    req.on("error", reject);
  });
}

async function fetchJson(url) {
  const { buffer } = await requestBuffer(url);
  return JSON.parse(buffer.toString("utf8"));
}

function cleanOnlineText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstString(values) {
  return (Array.isArray(values) ? values : [values]).map((item) => String(item || "").trim()).find(Boolean) || "";
}

function looksLikeFilenameTitle(book, value) {
  const title = String(value || "").trim().toLowerCase();
  const filename = path.parse(book.originalName || "").name.trim().toLowerCase();
  return Boolean(title && filename && title === filename);
}

function shouldFillBookField(book, key) {
  const value = book[key];
  if (value === undefined || value === null || String(value).trim() === "") return true;
  if (key === "author") return /^autor desconhecido$/i.test(String(value)) || /^unknown$/i.test(String(value));
  if (key === "title") return looksLikeFilenameTitle(book, value);
  return false;
}

function isbnFromIdentifiers(identifiers = []) {
  const found = identifiers.find((item) => /isbn/i.test(item.type || "") && item.identifier);
  return found ? String(found.identifier).replace(/[^\dXx]/g, "") : "";
}

function normalizeBookMetadata(raw) {
  if (!raw) return null;
  return {
    title: firstString(raw.title),
    author: firstString(raw.author),
    publisher: firstString(raw.publisher),
    isbn: firstString(raw.isbn).replace(/[^\dXx]/g, ""),
    language: firstString(raw.language),
    publishedDate: firstString(raw.publishedDate),
    description: cleanOnlineText(raw.description),
    pageCount: Number(raw.pageCount || 0) || "",
    coverUrl: firstString(raw.coverUrl).replace(/^http:\/\//i, "https://"),
    source: firstString(raw.source)
  };
}

function applyOnlineMetadata(book, raw) {
  const metadata = normalizeBookMetadata(raw);
  if (!metadata) return false;
  let changed = false;
  for (const key of ["title", "author", "publisher", "isbn", "language", "publishedDate", "description", "pageCount"]) {
    if (metadata[key] && shouldFillBookField(book, key)) {
      book[key] = metadata[key];
      changed = true;
    }
  }
  if (changed && metadata.source) book.metadataSource = metadata.source;
  return changed;
}

async function findGoogleBooksMetadata(book, candidates = coverSearchCandidates(book)) {
  const searches = [];
  if (book.isbn) searches.push(`isbn:${book.isbn}`);
  for (const title of candidates) {
    searches.push(hasKnownAuthor(book) ? `intitle:"${title}" inauthor:"${book.author}"` : `intitle:"${title}"`);
    searches.push(hasKnownAuthor(book) ? `"${title}" "${book.author}"` : `"${title}"`);
  }
  for (const q of [...new Set(searches)].slice(0, 8)) {
    const params = new URLSearchParams({ q, maxResults: "10", projection: "full" });
    const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?${params}`);
    const item = (data.items || []).find((entry) => {
      const info = entry.volumeInfo || {};
      return info.title && (info.description || info.publisher || info.industryIdentifiers?.length);
    });
    const info = item?.volumeInfo;
    if (!info) continue;
    const image = info.imageLinks?.extraLarge || info.imageLinks?.large || info.imageLinks?.medium || info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;
    return {
      title: info.title,
      author: info.authors,
      publisher: info.publisher,
      isbn: isbnFromIdentifiers(info.industryIdentifiers),
      language: info.language,
      publishedDate: info.publishedDate,
      description: info.description,
      pageCount: info.pageCount,
      coverUrl: image,
      source: "Google Books"
    };
  }
  return null;
}

async function findOpenLibraryMetadata(book, candidates = coverSearchCandidates(book)) {
  const searches = [];
  if (book.isbn) searches.push(new URLSearchParams({ isbn: book.isbn, limit: "5" }));
  for (const title of candidates) {
    const params = new URLSearchParams({ title, limit: "5" });
    if (hasKnownAuthor(book)) params.set("author", book.author);
    searches.push(params);
  }
  for (const params of searches.slice(0, 8)) {
    const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);
    const doc = (data.docs || []).find((item) => item.title);
    if (!doc) continue;
    let description = "";
    if (doc.key) {
      const work = await fetchJson(`https://openlibrary.org${doc.key}.json`).catch(() => null);
      description = typeof work?.description === "string" ? work.description : work?.description?.value || "";
    }
    return {
      title: doc.title,
      author: doc.author_name,
      publisher: doc.publisher,
      isbn: doc.isbn,
      language: doc.language,
      publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : "",
      description,
      pageCount: doc.number_of_pages_median,
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : "",
      source: "Open Library"
    };
  }
  return null;
}

async function enrichOnlineMetadata(book) {
  const candidates = coverSearchCandidates(book);
  const lookups = [
    () => findGoogleBooksMetadata(book, candidates),
    () => findOpenLibraryMetadata(book, candidates)
  ];
  for (const lookup of lookups) {
    const metadata = await lookup().catch(() => null);
    if (!metadata) continue;
    const changed = applyOnlineMetadata(book, metadata);
    if (!book.coverPath && !book.coverUrl && metadata.coverUrl) {
      await downloadCover(book, metadata.coverUrl).catch(() => {
        book.coverUrl = metadata.coverUrl;
      });
      if (book.coverPath || book.coverUrl) book.coverSource = metadata.source;
    }
    if (changed || book.coverPath || book.coverUrl) return metadata.source || "online";
  }
  return "";
}

function coverExt(contentType, url) {
  const lower = String(contentType || "").toLowerCase();
  if (lower.includes("png")) return ".png";
  if (lower.includes("webp")) return ".webp";
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
}

async function downloadCover(book, url) {
  const cleanUrl = String(url || "").replace(/^http:\/\//i, "https://");
  const { buffer, contentType } = await requestBuffer(cleanUrl);
  if (buffer.length < 1500) throw new Error("Capa pequena demais ou vazia");
  const ext = coverExt(contentType, cleanUrl);
  const coverPath = path.join(COVER_DIR, `${book.id}${ext}`);
  await fsp.writeFile(coverPath, buffer);
  book.coverPath = coverPath;
  book.coverUrl = "";
  book.coverSvg = "";
  return true;
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
  await enrichOnlineMetadata(book);
  await findOnlineCover(book);
  if (!book.coverPath && book.isbn) {
    await downloadCover(book, `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`).catch(() => {
      book.coverUrl = `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`;
    });
  }
  if (!book.coverPath) await extractEmbeddedEpubCover(book, manifest, opf, opfDir);
}

async function analyzePdf(book) {
  book.title = book.title || path.parse(book.originalName).name;
  book.author = book.author || "Autor desconhecido";
  await enrichOnlineMetadata(book);
  await findOnlineCover(book);
  if (!book.coverPath) await extractPdfFirstPageCover(book);
  if (!book.coverPath) book.coverSvg = makeCoverSvg(book, "#155e75", "#f8fafc");
}

async function findOnlineCover(book) {
  const candidates = coverSearchCandidates(book);
  const queries = [
    () => findGoogleBooksCover(book, candidates),
    () => findOpenLibraryCover(book, candidates),
    () => findBookcoverApiCover(book, candidates)
  ];
  for (const query of queries) {
    const result = await query().catch(() => null);
    const url = typeof result === "string" ? result : result?.url;
    if (!url) continue;
    const ok = await downloadCover(book, url).catch(() => false);
    if (ok) {
      book.coverSource = typeof result === "string" ? url : result.source;
      return book.coverSource || "online";
    }
  }
  return "";
}

function coverSearchCandidates(book) {
  const raw = [
    book.title,
    path.parse(book.originalName || "").name
  ].filter(Boolean);
  const cleaned = raw.flatMap((value) => {
    const title = String(value).replace(/\s+\[[^\]]+\]$/, "").trim();
    const beforeColon = title.split(":")[0].trim();
    const beforeDash = title.split(/\s+-\s+/)[0].trim();
    return [title, beforeColon, beforeDash];
  });
  return [...new Set(cleaned.filter((item) => item && item.length > 2))].slice(0, 5);
}

function hasKnownAuthor(book) {
  return book.author && !/^autor desconhecido$/i.test(book.author) && !/^unknown$/i.test(book.author);
}

async function findOpenLibraryCover(book, candidates = coverSearchCandidates(book)) {
  if (book.isbn) {
    const isbnUrl = `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`;
    const ok = await requestBuffer(isbnUrl).then((res) => res.buffer.length > 1500).catch(() => false);
    if (ok) return { url: isbnUrl, source: "Open Library ISBN" };
  }
  if (book.olid) {
    const olidUrl = `https://covers.openlibrary.org/b/olid/${book.olid}-L.jpg`;
    const ok = await requestBuffer(olidUrl).then((res) => res.buffer.length > 1500).catch(() => false);
    if (ok) return { url: olidUrl, source: "Open Library OLID" };
  }
  for (const title of candidates) {
    const searches = [];
    const byTitle = new URLSearchParams({ title, limit: "10", fields: "cover_i,title,author_name" });
    if (hasKnownAuthor(book)) byTitle.set("author", book.author);
    searches.push(byTitle);
    searches.push(new URLSearchParams({ q: hasKnownAuthor(book) ? `${title} ${book.author}` : title, limit: "10", fields: "cover_i,title,author_name" }));
    for (const params of searches) {
      const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);
      const doc = (data.docs || []).find((item) => item.cover_i);
      if (doc?.cover_i) return { url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`, source: "Open Library" };
    }
  }
  return null;
}

async function findGoogleBooksCover(book, candidates = coverSearchCandidates(book)) {
  for (const title of candidates) {
    const searches = [
      hasKnownAuthor(book) ? `intitle:"${title}" inauthor:"${book.author}"` : `intitle:"${title}"`,
      hasKnownAuthor(book) ? `"${title}" "${book.author}"` : `"${title}"`,
      title
    ];
    for (const q of searches) {
      const params = new URLSearchParams({ q, maxResults: "10", projection: "lite" });
      const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?${params}`);
      const item = (data.items || []).find((entry) => entry.volumeInfo?.imageLinks?.thumbnail || entry.volumeInfo?.imageLinks?.smallThumbnail);
      const image = item?.volumeInfo?.imageLinks?.thumbnail || item?.volumeInfo?.imageLinks?.smallThumbnail;
      if (image) return { url: image.replace(/^http:\/\//i, "https://"), source: "Google Books" };
    }
  }
  return null;
}

async function findBookcoverApiCover(book, candidates = coverSearchCandidates(book)) {
  if (!hasKnownAuthor(book)) return null;
  for (const title of candidates) {
    const params = new URLSearchParams({ book_title: title, author_name: book.author });
    const apiUrl = `https://bookcover.longitood.com/bookcover?${params}`;
    const response = await requestBuffer(apiUrl);
    if (/^image\//i.test(response.contentType)) return { url: apiUrl, source: "bookcover-api" };
    const text = response.buffer.toString("utf8").trim().replace(/^"|"$/g, "");
    if (/^https?:\/\//i.test(text)) return { url: text, source: "bookcover-api" };
  }
  return null;
}

async function extractEmbeddedEpubCover(book, manifest, opf, opfDir) {
  const coverMeta = (/name=["']cover["'][^>]+content=["']([^"']+)["']/i.exec(opf) || [])[1];
  const items = Object.entries(manifest).map(([id, item]) => ({ id, ...item }));
  const coverItem =
    items.find((item) => item.properties.includes("cover-image")) ||
    manifest[coverMeta] ||
    items.find((item) => /(^|[-_])(?:cover|capa)([-_.]|$)/i.test(`${item.id} ${item.href}`)) ||
    items.find((item) => /^image\//i.test(item.type || ""));
  if (!coverItem) return false;
  const coverSource = path.join(opfDir, coverItem.href);
  if (!fs.existsSync(coverSource)) return false;
  const ext = path.extname(coverSource) || ".jpg";
  const coverPath = path.join(COVER_DIR, `${book.id}${ext}`);
  await fsp.copyFile(coverSource, coverPath);
  book.coverPath = coverPath;
  book.coverUrl = "";
  book.coverSvg = "";
  book.coverSource = "embedded";
  return true;
}

async function extractExistingEpubCover(book) {
  if (book.format !== "epub") return false;
  const outDir = path.join(EPUB_DIR, book.id);
  const containerPath = path.join(outDir, "META-INF", "container.xml");
  if (!fs.existsSync(containerPath)) return false;
  const container = await fsp.readFile(containerPath, "utf8");
  const opfRel = attr((container.match(/<rootfile\b[^>]*>/i) || [""])[0], "full-path");
  if (!opfRel) return false;
  const opfPath = path.join(outDir, opfRel);
  if (!fs.existsSync(opfPath)) return false;
  const opfDir = path.dirname(opfPath);
  const opf = await fsp.readFile(opfPath, "utf8");
  const manifest = {};
  for (const item of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const itemId = attr(tag, "id");
    if (itemId) manifest[itemId] = { href: attr(tag, "href"), type: attr(tag, "media-type"), properties: attr(tag, "properties") };
  }
  return extractEmbeddedEpubCover(book, manifest, opf, opfDir);
}

async function extractPdfFirstPageCover(book) {
  if (book.format !== "pdf" || !book.filePath || !fs.existsSync(book.filePath)) return false;
  const coverPath = path.join(COVER_DIR, `${book.id}.jpg`);
  await execFilePromise("magick.exe", ["-density", "160", `${book.filePath}[0]`, "-quality", "88", coverPath]);
  if (!fs.existsSync(coverPath) || fs.statSync(coverPath).size < 1500) return false;
  book.coverPath = coverPath;
  book.coverUrl = "";
  book.coverSvg = "";
  book.coverSource = "pdf-first-page";
  return true;
}

async function extractFileCover(book) {
  if (book.format === "epub") return await extractExistingEpubCover(book) ? "primeira imagem do EPUB" : "";
  if (book.format === "pdf") return await extractPdfFirstPageCover(book).catch(() => false) ? "primeira pagina do PDF" : "";
  return "";
}

function splitCoverLines(value, maxChars = 18, maxLines = 5) {
  const words = String(value || "").replace(/\.[^.]+$/, "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : ["Livro"];
}

function makeCoverSvg(bookOrTitle, bg = "#334155", fg = "#ffffff") {
  const book = typeof bookOrTitle === "object" ? bookOrTitle : { title: bookOrTitle };
  const title = book.title || book.originalName || "Livro sem titulo";
  const author = book.author || "Autor desconhecido";
  const format = String(book.format || "livro").toUpperCase();
  const titleLines = splitCoverLines(title);
  const esc = (v) => String(v || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const renderedTitle = titleLines
    .map((line, index) => `<text x="48" y="${190 + index * 42}" font-family="Georgia,serif" font-size="34" font-weight="700" fill="${fg}">${esc(line).slice(0, 24)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="620" viewBox="0 0 420 620"><rect width="420" height="620" fill="${bg}"/><rect x="28" y="28" width="364" height="564" fill="none" stroke="${fg}" stroke-opacity=".34" stroke-width="2"/><circle cx="330" cy="88" r="34" fill="${fg}" opacity=".12"/><text x="48" y="112" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="${fg}" opacity=".72">MyBookLib</text>${renderedTitle}<text x="48" y="454" font-family="Arial,sans-serif" font-size="19" fill="${fg}" opacity=".82">${esc(author).slice(0, 42)}</text><text x="48" y="540" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="${fg}" opacity=".72">${esc(format)}</text></svg>`;
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

function canAccessBook(user, book) {
  return Boolean(user && book && (book.userId === user.id || user.role === "admin"));
}

function wantsAllBooks(req, user) {
  if (user?.role !== "admin") return false;
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("scope") === "all" || url.searchParams.get("all") === "1";
}

function booksForUser(db, user, req) {
  return db.books.filter((book) => wantsAllBooks(req, user) || book.userId === user.id);
}

function publicBook(db, book) {
  const owner = db.users.find((user) => user.id === book.userId);
  return { ...book, ownerName: owner?.name || "Usuario removido" };
}

function userStorageBytes(db, userId) {
  return db.books
    .filter((book) => book.userId === userId)
    .reduce((sum, book) => sum + Number(book.fileSize || 0), 0);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function cleanListPart(part) {
  return decodeMultipartText(part?.data ? part.data.toString("latin1") : "").split(",").map((x) => x.trim()).filter(Boolean);
}

function cleanTextPart(part) {
  return decodeMultipartText(part?.data ? part.data.toString("latin1") : "").trim();
}

function fileFingerprint(file) {
  return crypto.createHash("sha256").update(file.data).digest("hex");
}

function normalizedBookName(filename) {
  return path.basename(String(filename || ""), path.extname(String(filename || "")))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findDuplicateBook(db, user, file, fingerprint) {
  const ext = path.extname(file.filename).toLowerCase().replace(".", "");
  const name = normalizedBookName(file.filename);
  return db.books.find((book) => book.userId === user.id && (
    book.fileHash === fingerprint ||
    (book.format === ext && normalizedBookName(book.originalName) === name && Number(book.fileSize || 0) === file.data.length)
  ));
}

function duplicateGroupKey(book) {
  if (book.fileHash) return `hash:${book.userId}:${book.fileHash}`;
  return `legacy:${book.userId}:${book.format}:${normalizedBookName(book.originalName)}:${Number(book.fileSize || 0)}`;
}

function bookKeepScore(book) {
  const progress = Number(book.readingProgress?.percent || 0);
  const hasCover = book.coverPath || book.coverUrl ? 1 : 0;
  const ready = book.status === "ready" ? 1 : 0;
  const opened = book.lastOpenedAt ? 1 : 0;
  return progress * 1000 + hasCover * 100 + ready * 10 + opened;
}

function normalizeSubjectName(value) {
  return String(value || "").trim();
}

function ensureSubjectsInCatalog(db, names) {
  if (!Array.isArray(db.subjects)) db.subjects = [];
  for (const name of names || []) {
    const subject = normalizeSubjectName(name);
    if (!subject) continue;
    if (!db.subjects.some((item) => item.toLowerCase() === subject.toLowerCase())) db.subjects.push(subject);
  }
  db.subjects.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

async function removeBookFiles(book) {
  await Promise.allSettled([
    fsp.rm(book.filePath, { force: true }),
    book.coverPath ? fsp.rm(book.coverPath, { force: true }) : null,
    fsp.rm(path.join(EPUB_DIR, book.id), { recursive: true, force: true })
  ]);
}

async function removeBookFromDb(db, book) {
  const index = db.books.findIndex((item) => item.id === book.id);
  if (index < 0) return false;
  db.books.splice(index, 1);
  db.annotations = (db.annotations || []).filter((item) => item.bookId !== book.id);
  await removeBookFiles(book);
  return true;
}

async function deduplicateLibrary(db, user, req) {
  const books = booksForUser(db, user, req);
  const groups = new Map();
  for (const book of books) {
    const key = duplicateGroupKey(book);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(book);
  }
  let removed = 0;
  const duplicates = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      const scoreDiff = bookKeepScore(b) - bookKeepScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const kept = group[0];
    for (const duplicate of group.slice(1)) {
      if (await removeBookFromDb(db, duplicate)) {
        removed += 1;
        duplicates.push({
          keptId: kept.id,
          keptTitle: kept.title || kept.originalName,
          removedId: duplicate.id,
          removedTitle: duplicate.title || duplicate.originalName
        });
      }
    }
  }
  if (removed) await saveDb(db);
  return { removed, duplicates };
}

async function createBookFromUpload(db, user, file, parts) {
  const ext = path.extname(file.filename).toLowerCase();
  if (![".epub", ".pdf"].includes(ext)) return { error: `${path.basename(file.filename)} ignorado: apenas EPUB e PDF sao aceitos` };
  const fingerprint = fileFingerprint(file);
  const duplicate = findDuplicateBook(db, user, file, fingerprint);
  if (duplicate) return { error: `${path.basename(file.filename)} ignorado: ja existe no MyBookLib` };
  const storageLimit = Number(user.storageLimitMb || 0) * 1024 * 1024;
  if (storageLimit && userStorageBytes(db, user.id) + file.data.length > storageLimit) {
    return { error: `${path.basename(file.filename)} ignorado: limite de armazenamento excedido` };
  }
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
    publishedDate: "",
    description: "",
    pageCount: "",
    metadataSource: "",
    format: ext.slice(1),
    originalName: path.basename(file.filename),
    relativeFolder: path.dirname(String(file.filename)).replace(/^[./\\]+$/, ""),
    filePath,
    fileSize: file.data.length,
    fileHash: fingerprint,
    coverPath: "",
    coverUrl: "",
    coverSvg: "",
    subjects: cleanListPart(parts.subjects),
    tags: cleanListPart(parts.tags),
    shelf: cleanTextPart(parts.shelf) || "MyBookLib",
    readingProgress: { position: 0, label: "", percent: 0 },
    status: "uploaded",
    createdAt: now,
    updatedAt: now
  };
  ensureSubjectsInCatalog(db, book.subjects);
  db.books.push(book);
  await saveDb(db);
  processBook(book, filePath);
  return { book };
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

    if (pathname === "/api/subjects" && req.method === "GET") {
      return json(res, 200, { subjects: db.subjects || [] });
    }
    if (pathname === "/api/subjects" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 1024 * 20)).toString("utf8") || "{}");
      const subject = normalizeSubjectName(body.name);
      if (!subject) return json(res, 400, { error: "Informe o nome do assunto" });
      ensureSubjectsInCatalog(db, [subject]);
      await saveDb(db);
      return json(res, 201, { subjects: db.subjects });
    }
    const subjectMatch = pathname.match(/^\/api\/subjects\/([^/]+)$/);
    if (subjectMatch && req.method === "DELETE") {
      const subjectName = decodeURIComponent(subjectMatch[1]);
      const before = db.subjects.length;
      db.subjects = (db.subjects || []).filter((item) => item.toLowerCase() !== subjectName.toLowerCase());
      if (db.subjects.length === before) return notFound(res);
      await saveDb(db);
      return json(res, 200, { subjects: db.subjects });
    }
    if (pathname === "/api/books" && req.method === "GET") {
      return json(res, 200, { books: booksForUser(db, user, req).map((book) => publicBook(db, book)) });
    }
    if (pathname === "/api/books/deduplicate" && req.method === "POST") {
      const result = await deduplicateLibrary(db, user, req);
      return json(res, 200, result);
    }
    if (pathname === "/api/books" && req.method === "POST") {
      const parts = parseMultipart(await readBody(req), req.headers["content-type"]);
      const files = (Array.isArray(parts.file) ? parts.file : [parts.file]).filter((file) => file?.filename);
      if (!files.length) return json(res, 400, { error: "Arquivo nao enviado" });
      const results = [];
      for (const file of files) {
        results.push(await createBookFromUpload(db, user, file, parts));
      }
      const books = results.map((result) => result.book).filter(Boolean);
      const errors = results.map((result) => result.error).filter(Boolean);
      return json(res, books.length ? 201 : 400, { book: books[0], books, errors });
    }
    const bookOpenMatch = pathname.match(/^\/api\/books\/([^/]+)\/open$/);
    if (bookOpenMatch && req.method === "POST") {
      const book = db.books.find((item) => item.id === bookOpenMatch[1] && canAccessBook(user, item));
      if (!book) return notFound(res);
      book.lastOpenedAt = new Date().toISOString();
      book.updatedAt = book.lastOpenedAt;
      await saveDb(db);
      return json(res, 200, { book: publicBook(db, book) });
    }
    const bookMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
    if (bookMatch && req.method === "PATCH") {
      const book = db.books.find((item) => item.id === bookMatch[1] && canAccessBook(user, item));
      if (!book) return notFound(res);
      const body = JSON.parse((await readBody(req, 1024 * 100)).toString("utf8") || "{}");
      ["title", "author", "publisher", "isbn", "language", "publishedDate", "description", "shelf"].forEach((key) => {
        if (body[key] !== undefined) book[key] = String(body[key]);
      });
      if (body.pageCount !== undefined) book.pageCount = Number(body.pageCount || 0) || "";
      if (Array.isArray(body.subjects)) {
        book.subjects = body.subjects.map(String).map(normalizeSubjectName).filter(Boolean);
        ensureSubjectsInCatalog(db, book.subjects);
      }
      if (Array.isArray(body.tags)) book.tags = body.tags.map(String);
      if (body.readingStatus !== undefined) {
        const allowed = new Set(["", "favorite", "planned", "completed"]);
        book.readingStatus = allowed.has(body.readingStatus) ? body.readingStatus : "";
      }
      if (body.readingProgress) {
        book.readingProgress = body.readingProgress;
        if (Number(book.readingProgress?.percent || 0) >= 100 && book.readingStatus !== "planned") {
          book.readingStatus = "completed";
        }
      }
      book.updatedAt = new Date().toISOString();
      await saveDb(db);
      return json(res, 200, { book });
    }
    if (bookMatch && req.method === "DELETE") {
      const book = db.books.find((item) => item.id === bookMatch[1] && canAccessBook(user, item));
      if (!book || !(await removeBookFromDb(db, book))) return notFound(res);
      await saveDb(db);
      return json(res, 200, { ok: true });
    }
    const kindleMatch = pathname.match(/^\/api\/books\/([^/]+)\/kindle$/);
    if (kindleMatch && req.method === "POST") {
      const book = db.books.find((item) => item.id === kindleMatch[1] && canAccessBook(user, item));
      if (!book) return notFound(res);
      const body = JSON.parse((await readBody(req, 1024 * 20)).toString("utf8") || "{}");
      const kindleEmail = String(body.kindleEmail || user.kindleEmail || "").trim();
      if (!isValidEmail(kindleEmail)) return json(res, 400, { error: "Informe um e-mail Kindle valido" });
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
    const coverLookupMatch = pathname.match(/^\/api\/books\/([^/]+)\/cover$/);
    if (coverLookupMatch && req.method === "POST") {
      const book = db.books.find((item) => item.id === coverLookupMatch[1] && canAccessBook(user, item));
      if (!book) return notFound(res);
      let source = await findOnlineCover(book);
      if (!source) {
        source = await extractFileCover(book);
      }
      if (!source) return json(res, 404, { error: "Nao encontrei uma capa online nem consegui gerar capa a partir do arquivo" });
      book.updatedAt = new Date().toISOString();
      await saveDb(db);
      return json(res, 200, { book: publicBook(db, book), source });
    }
    const annotationsMatch = pathname.match(/^\/api\/books\/([^/]+)\/annotations(?:\/([^/]+))?$/);
    if (annotationsMatch) {
      const book = db.books.find((item) => item.id === annotationsMatch[1] && canAccessBook(user, item));
      if (!book) return notFound(res);
      if (req.method === "GET" && !annotationsMatch[2]) {
        const annotations = db.annotations.filter((item) => item.bookId === book.id && item.userId === user.id);
        return json(res, 200, { annotations });
      }
      if (req.method === "POST" && !annotationsMatch[2]) {
        const body = JSON.parse((await readBody(req, 1024 * 100)).toString("utf8") || "{}");
        const now = new Date().toISOString();
        const annotation = {
          id: id("ann"),
          userId: user.id,
          bookId: book.id,
          chapter: Math.max(0, Number(body.chapter) || 0),
          color: String(body.color || "#fff2a8").slice(0, 24),
          quote: String(body.quote || "").trim().slice(0, 2000),
          note: String(body.note || "").trim().slice(0, 4000),
          createdAt: now,
          updatedAt: now
        };
        if (!annotation.quote && !annotation.note) return json(res, 400, { error: "Informe um trecho ou uma anotacao" });
        db.annotations.push(annotation);
        await saveDb(db);
        return json(res, 201, { annotation });
      }
      if (req.method === "DELETE" && annotationsMatch[2]) {
        const index = db.annotations.findIndex((item) => item.id === annotationsMatch[2] && item.bookId === book.id && item.userId === user.id);
        if (index < 0) return notFound(res);
        db.annotations.splice(index, 1);
        await saveDb(db);
        return json(res, 200, { ok: true });
      }
    }
    if (pathname === "/api/admin/users" && user.role === "admin" && req.method === "GET") {
      return json(res, 200, { users: db.users.map(publicUser) });
    }
    if (pathname === "/api/admin/users" && user.role === "admin" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 1024 * 50)).toString("utf8") || "{}");
      if (!body.email || !body.password || !body.name) return json(res, 400, { error: "Nome, e-mail e senha sao obrigatorios" });
      const email = String(body.email).trim().toLowerCase();
      if (!isValidEmail(email)) return json(res, 400, { error: "E-mail invalido" });
      if (db.users.some((item) => item.email === email)) return json(res, 409, { error: "E-mail ja cadastrado" });
      const created = createUser(String(body.name).trim(), email, String(body.password), body.role === "admin" ? "admin" : "user");
      db.users.push(created);
      await saveDb(db);
      return json(res, 201, { user: publicUser(created) });
    }
    const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && user.role === "admin" && req.method === "PATCH") {
      const target = db.users.find((item) => item.id === userMatch[1]);
      if (!target) return notFound(res);
      const body = JSON.parse((await readBody(req, 1024 * 50)).toString("utf8") || "{}");
      if (body.email !== undefined) {
        const email = String(body.email).trim().toLowerCase();
        if (!isValidEmail(email)) return json(res, 400, { error: "E-mail invalido" });
        if (db.users.some((item) => item.id !== target.id && item.email === email)) return json(res, 409, { error: "E-mail ja cadastrado" });
        target.email = email;
      }
      if (body.name !== undefined) target.name = String(body.name).trim();
      if (body.role !== undefined) target.role = body.role === "admin" ? "admin" : "user";
      if (body.status !== undefined) target.status = body.status === "blocked" ? "blocked" : "active";
      if (body.kindleEmail !== undefined) {
        const kindleEmail = String(body.kindleEmail).trim();
        if (kindleEmail && !isValidEmail(kindleEmail)) return json(res, 400, { error: "E-mail Kindle invalido" });
        target.kindleEmail = kindleEmail;
      }
      if (body.storageLimitMb !== undefined) target.storageLimitMb = Math.max(0, Number(body.storageLimitMb) || 0);
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
    const book = db.books.find((item) => item.id === cover[1] && canAccessBook(user, item));
    if (!book) return notFound(res);
    if (book.coverSvg) return send(res, 200, book.coverSvg, { "Content-Type": "image/svg+xml" });
    if (book.coverPath) return streamFile(res, book.coverPath, req);
    return send(res, 200, makeCoverSvg(book), { "Content-Type": "image/svg+xml" });
  }
  const file = pathname.match(/^\/files\/([^/]+)$/);
  if (file) {
    const book = db.books.find((item) => item.id === file[1] && canAccessBook(user, item));
    if (!book) return notFound(res);
    const download = new URL(req.url, `http://${req.headers.host}`).searchParams.get("download") === "1";
    return streamFile(res, book.filePath, req, download ? book.originalName : "");
  }
  const epub = pathname.match(/^\/epub\/([^/]+)\/(.+)$/);
  if (epub) {
    const book = db.books.find((item) => item.id === epub[1] && canAccessBook(user, item));
    if (!book) return notFound(res);
    const filePath = safeJoin(path.join(EPUB_DIR, book.id), decodeURIComponent(epub[2]));
    if (!filePath || !fs.existsSync(filePath)) return notFound(res);
    return streamFile(res, filePath, req);
  }
  return false;
}

function contentDisposition(filename) {
  if (!filename) return "";
  const ascii = path.basename(filename).replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  const encoded = encodeURIComponent(path.basename(filename));
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function streamFile(res, filePath, req, downloadName = "") {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const range = req?.headers?.range;
  const disposition = contentDisposition(downloadName);
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    res.writeHead(206, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      ...(disposition ? { "Content-Disposition": disposition } : {})
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    ...(disposition ? { "Content-Disposition": disposition } : {})
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
    console.log(`MyBookLib em http://localhost:${PORT}`);
    console.log("Login inicial: admin@local / admin123");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
