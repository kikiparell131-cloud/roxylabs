"use strict";

/*
 * ============================================================
 * FRANXX MD — GOOGLE DRIVE DOWNLOADER
 * ============================================================
 *
 * FITUR:
 * - .drive <url>
 * - .gdrive <url>
 * - Auto detect link Google Drive
 * - Support reply pesan yang berisi link Google Drive
 * - Support:
 *   https://drive.google.com/file/d/FILE_ID/view
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/uc?id=FILE_ID
 *   https://drive.google.com/uc?export=download&id=FILE_ID
 *
 * CATATAN:
 * - File Google Drive harus dapat diakses secara publik
 *   atau minimal "Anyone with the link".
 * - Tidak membutuhkan Google Drive API Key.
 * ============================================================
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/*
|--------------------------------------------------------------------------
| HANDLER
|--------------------------------------------------------------------------
*/

let handler = async (m, {
  conn,
  text,
  usedPrefix,
  command
}) => {

  /*
  |--------------------------------------------------------------------------
  | CARI URL GOOGLE DRIVE
  |--------------------------------------------------------------------------
  */

  const driveUrl = getDriveUrl(m, text);

  /*
  |--------------------------------------------------------------------------
  | COMMAND TANPA URL
  |--------------------------------------------------------------------------
  */

  if (!driveUrl) {
    throw (
      `Contoh penggunaan:\n\n` +
      `${usedPrefix}${command} https://drive.google.com/file/d/XXXXXXXX/view\n\n` +
      `Atau cukup kirim pesan yang berisi link Google Drive.`
    );
  }

  /*
  |--------------------------------------------------------------------------
  | EXTRACT FILE ID
  |--------------------------------------------------------------------------
  */

  const fileId = extractDriveId(driveUrl);

  if (!fileId) {
    throw "Link Google Drive tidak valid.";
  }

  /*
  |--------------------------------------------------------------------------
  | TEMP FILE
  |--------------------------------------------------------------------------
  */

  let tempPath = null;

  try {

    /*
    |--------------------------------------------------------------------------
    | INFO AWAL
    |--------------------------------------------------------------------------
    */

    await m.reply(
      "📥 *Google Drive Downloader*\n\n" +
      "⏳ Sedang mengambil file dari Google Drive..."
    );

    /*
    |--------------------------------------------------------------------------
    | DOWNLOAD
    |--------------------------------------------------------------------------
    */

    const result = await downloadDriveFile(fileId);

    tempPath = result.filePath;

    const fileName =
      result.fileName ||
      `gdrive-${fileId}`;

    const mimeType =
      result.mimeType ||
      "application/octet-stream";

    const fileSize =
      result.size ||
      fs.statSync(tempPath).size;

    /*
    |--------------------------------------------------------------------------
    | VALIDASI UKURAN
    |--------------------------------------------------------------------------
    */

    if (fileSize > MAX_FILE_SIZE) {

      throw new Error(
        `Ukuran file terlalu besar.\n\n` +
        `Maksimal: ${formatBytes(MAX_FILE_SIZE)}\n` +
        `File: ${formatBytes(fileSize)}`
      );
    }

    /*
    |--------------------------------------------------------------------------
    | INFO DOWNLOAD
    |--------------------------------------------------------------------------
    */

    await m.reply(
      `📦 *File ditemukan!*\n\n` +
      `📄 Nama: ${fileName}\n` +
      `📊 Ukuran: ${formatBytes(fileSize)}\n` +
      `🗂️ Tipe: ${mimeType}\n\n` +
      `📤 Mengirim file...`
    );

    /*
    |--------------------------------------------------------------------------
    | KIRIM FILE
    |--------------------------------------------------------------------------
    |
    | Pakai ReadStream supaya tidak perlu memasukkan seluruh file
    | ke Buffer/RAM.
    |
    */

    // Baileys rc14 lebih stabil menerima Buffer untuk document lokal.
    // ReadStream dari axios/FS pada jalur ini dapat berakhir sebagai
    // "Cannot read properties of undefined (reading 'toString')" ketika
    // media diproses ulang oleh media uploader.
    const documentBuffer =
      await fs.promises.readFile(tempPath);

    await conn.sendMessage(
      m.chat,
      {
        document: documentBuffer,
        fileName,
        mimetype: mimeType,
        caption:
          `📥 *Google Drive Downloader*\n\n` +
          `📄 *Nama:* ${fileName}\n` +
          `📊 *Ukuran:* ${formatBytes(fileSize)}\n` +
          `🗂️ *Tipe:* ${mimeType}\n\n` +
          `© FRANXX MD`
      },
      {
        quoted: m
      }
    );

  } catch (error) {

    console.error(
      "[GDRIVE ERROR]",
      error
    );

    /*
    |--------------------------------------------------------------------------
    | ERROR MESSAGE
    |--------------------------------------------------------------------------
    */

    let message =
      error?.message ||
      String(error);

    if (
      message.includes("403") ||
      message.includes("Access denied") ||
      message.includes("Forbidden")
    ) {
      message =
        "File Google Drive tidak bisa diakses.\n\n" +
        "Pastikan akses file diubah menjadi:\n" +
        "Anyone with the link / Siapa saja yang memiliki link.";
    }

    if (
      message.includes("404") ||
      message.includes("Not Found")
    ) {
      message =
        "File Google Drive tidak ditemukan.\n\n" +
        "Pastikan link Drive masih aktif.";
    }

    await m.reply(
      `❌ *Gagal mendownload file*\n\n${message}`
    );

  } finally {

    /*
    |--------------------------------------------------------------------------
    | HAPUS TEMP FILE
    |--------------------------------------------------------------------------
    */

    if (tempPath) {
      try {

        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

      } catch (error) {

        console.error(
          "[GDRIVE CLEANUP ERROR]",
          error
        );

      }
    }
  }
};

/*
|--------------------------------------------------------------------------
| COMMAND
|--------------------------------------------------------------------------
*/

handler.help = [
  "drive <url>",
  "gdrive <url>"
];

handler.tags = [
  "downloader"
];

handler.command =
  /^(drive|gdrive)$/i;

/*
|--------------------------------------------------------------------------
| LIMIT
|--------------------------------------------------------------------------
|
| Sistem loader FRANXX MD akan menangani limit.
| Limit hanya dikenakan ketika handler berhasil selesai.
|
*/

handler.limit = true;

/*
|--------------------------------------------------------------------------
| EXPORT
|--------------------------------------------------------------------------
*/

export default handler;

/*
|--------------------------------------------------------------------------
| GET DRIVE URL
|--------------------------------------------------------------------------
|
| Prioritas:
| 1. text / command
| 2. pesan yang direply
| 3. caption pesan
| 4. text pesan
|
|--------------------------------------------------------------------------
*/

function getDriveUrl(m, text = "") {

  /*
  |--------------------------------------------------------------------------
  | COMMAND TEXT
  |--------------------------------------------------------------------------
  */

  const sources = [];

  if (text) {
    sources.push(String(text));
  }

  /*
  |--------------------------------------------------------------------------
  | PESAN UTAMA
  |--------------------------------------------------------------------------
  */

  if (m?.text) {
    sources.push(String(m.text));
  }

  if (m?.caption) {
    sources.push(String(m.caption));
  }

  /*
  |--------------------------------------------------------------------------
  | PESAN YANG DIREPLY
  |--------------------------------------------------------------------------
  */

  const quoted = m?.quoted;

  if (quoted) {

    if (quoted.text) {
      sources.push(String(quoted.text));
    }

    if (quoted.caption) {
      sources.push(String(quoted.caption));
    }

    /*
    |--------------------------------------------------------------------------
    | BEBERAPA FORMAT MESSAGE OBJECT BAILEYS
    |--------------------------------------------------------------------------
    */

    const qMessage =
      quoted.message ||
      quoted.msg ||
      null;

    if (qMessage) {

      const possibleText = [
        qMessage.conversation,
        qMessage.extendedTextMessage?.text,
        qMessage.imageMessage?.caption,
        qMessage.videoMessage?.caption,
        qMessage.documentMessage?.caption
      ];

      for (const value of possibleText) {
        if (value) {
          sources.push(String(value));
        }
      }
    }
  }

  /*
  |--------------------------------------------------------------------------
  | CARI URL
  |--------------------------------------------------------------------------
  */

  for (const source of sources) {

    const url = findDriveUrl(source);

    if (url) {
      return url;
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| FIND DRIVE URL
|--------------------------------------------------------------------------
*/

function findDriveUrl(text = "") {

  if (!text) {
    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | Google Drive URL
  |--------------------------------------------------------------------------
  */

  const regex =
    /https?:\/\/(?:drive|docs)\.google\.com\/[^\s<>"']+/gi;

  const matches =
    String(text).match(regex);

  if (!matches?.length) {
    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | Bersihkan tanda baca
  |--------------------------------------------------------------------------
  */

  for (let url of matches) {

    url = url
      .replace(/[)\]}>,"'`]+$/g, "")
      .trim();

    if (extractDriveId(url)) {
      return url;
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| EXTRACT GOOGLE DRIVE FILE ID
|--------------------------------------------------------------------------
*/

function extractDriveId(url) {

  if (!url) {
    return null;
  }

  let value;

  try {
    value = decodeURIComponent(
      String(url).trim()
    );
  } catch {
    value = String(url).trim();
  }

  /*
  |--------------------------------------------------------------------------
  | /file/d/FILE_ID/view
  |--------------------------------------------------------------------------
  */

  let match =
    value.match(
      /\/file\/d\/([a-zA-Z0-9_-]+)/i
    );

  if (match?.[1]) {
    return match[1];
  }

  /*
  |--------------------------------------------------------------------------
  | /d/FILE_ID
  |--------------------------------------------------------------------------
  */

  match =
    value.match(
      /\/d\/([a-zA-Z0-9_-]+)/i
    );

  if (match?.[1]) {
    return match[1];
  }

  /*
  |--------------------------------------------------------------------------
  | ?id=FILE_ID
  |--------------------------------------------------------------------------
  */

  match =
    value.match(
      /[?&]id=([a-zA-Z0-9_-]+)/i
    );

  if (match?.[1]) {
    return match[1];
  }

  /*
  |--------------------------------------------------------------------------
  | /uc/FILE_ID
  |--------------------------------------------------------------------------
  */

  match =
    value.match(
      /\/uc\/([a-zA-Z0-9_-]+)/i
    );

  if (match?.[1]) {
    return match[1];
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| DOWNLOAD GOOGLE DRIVE FILE
|--------------------------------------------------------------------------
*/

async function downloadDriveFile(fileId) {

  /*
  |--------------------------------------------------------------------------
  | RANDOM TEMP NAME
  |--------------------------------------------------------------------------
  */

  const random =
    crypto
      .randomBytes(8)
      .toString("hex");

  const tempDir =
    path.join(
      os.tmpdir(),
      "franxx-gdrive"
    );

  /*
  |--------------------------------------------------------------------------
  | BUAT FOLDER TEMP
  |--------------------------------------------------------------------------
  */

  fs.mkdirSync(
    tempDir,
    {
      recursive: true
    }
  );

  /*
  |--------------------------------------------------------------------------
  | TEMP PATH
  |--------------------------------------------------------------------------
  */

  const tempPath =
    path.join(
      tempDir,
      `${Date.now()}-${random}.bin`
    );

  /*
  |--------------------------------------------------------------------------
  | SESSION COOKIES
  |--------------------------------------------------------------------------
  */

  const cookies = {};

  /*
  |--------------------------------------------------------------------------
  | URL DOWNLOAD
  |--------------------------------------------------------------------------
  */

  const downloadUrl =
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;

  /*
  |--------------------------------------------------------------------------
  | FIRST REQUEST
  |--------------------------------------------------------------------------
  */

  let response;

  try {

    response =
      await axios.get(
        downloadUrl,
        {
          responseType: "stream",
          maxRedirects: 10,
          timeout: 120000,
          validateStatus: status =>
            status >= 200 &&
            status < 400,

          headers: {
            "User-Agent": USER_AGENT,
            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        }
      );

  } catch (error) {

    throw normalizeAxiosError(
      error
    );
  }

  /*
  |--------------------------------------------------------------------------
  | CONTENT TYPE
  |--------------------------------------------------------------------------
  */

  const contentType =
    String(
      response.headers["content-type"] ||
      ""
    ).toLowerCase();

  /*
  |--------------------------------------------------------------------------
  | COOKIES
  |--------------------------------------------------------------------------
  */

  collectCookies(
    response,
    cookies
  );

  /*
  |--------------------------------------------------------------------------
  | CEK APAKAH RESPONSE FILE
  |--------------------------------------------------------------------------
  */

  if (
    isProbablyHtml(
      contentType,
      response.headers["content-disposition"]
    )
  ) {

    /*
    |--------------------------------------------------------------------------
    | SIMPAN HTML SEMENTARA
    |--------------------------------------------------------------------------
    */

    const html =
      await streamToString(
        response.data
      );

    /*
    |--------------------------------------------------------------------------
    | CARI CONFIRM TOKEN
    |--------------------------------------------------------------------------
    */

    const confirm =
      extractConfirmToken(
        html
      );

    /*
    |--------------------------------------------------------------------------
    | CARI DOWNLOAD URL
    |--------------------------------------------------------------------------
    */

    const formAction =
      extractDownloadAction(
        html
      );

    if (!confirm && !formAction) {

      throw new Error(
        "Google Drive meminta akses tambahan. Pastikan file bersifat publik."
      );
    }

    let nextUrl;

    if (formAction) {

      nextUrl =
        formAction;

      if (!/^https?:\/\//i.test(nextUrl)) {

        nextUrl =
          `https://drive.usercontent.google.com${nextUrl}`;
      }

    } else {

      nextUrl =
        `https://drive.usercontent.google.com/download` +
        `?id=${encodeURIComponent(fileId)}` +
        `&export=download` +
        `&confirm=${encodeURIComponent(confirm)}`;
    }

    /*
    |--------------------------------------------------------------------------
    | REQUEST KEDUA
    |--------------------------------------------------------------------------
    */

    response =
      await axios.get(
        nextUrl,
        {
          responseType: "stream",
          maxRedirects: 10,
          timeout: 120000,
          validateStatus: status =>
            status >= 200 &&
            status < 400,

          headers: {
            "User-Agent": USER_AGENT,
            "Accept":
              "*/*",

            ...(Object.keys(cookies).length
              ? {
                  Cookie:
                    Object.entries(cookies)
                      .map(
                        ([key, value]) =>
                          `${key}=${value}`
                      )
                      .join("; ")
                }
              : {})
          }
        }
      );

    const secondContentType =
      String(
        response.headers["content-type"] ||
        ""
      ).toLowerCase();

    if (
      isProbablyHtml(
        secondContentType,
        response.headers["content-disposition"]
      )
    ) {

      const html2 =
        await streamToString(
          response.data
        );

      /*
      |--------------------------------------------------------------------------
      | GOOGLE DRIVE ERROR PAGE
      |--------------------------------------------------------------------------
      */

      throw new Error(
        extractDriveError(
          html2
        ) ||
        "Google Drive tidak memberikan file. Pastikan file dapat diakses publik."
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | CONTENT LENGTH
  |--------------------------------------------------------------------------
  */

  const contentLength =
    Number(
      response.headers["content-length"] ||
      0
    );

  if (
    contentLength &&
    contentLength > MAX_FILE_SIZE
  ) {

    response.data.destroy();

    throw new Error(
      `Ukuran file terlalu besar: ${formatBytes(contentLength)}. ` +
      `Maksimal ${formatBytes(MAX_FILE_SIZE)}.`
    );
  }

  /*
  |--------------------------------------------------------------------------
  | FILE NAME
  |--------------------------------------------------------------------------
  */

  let fileName =
    extractFileName(
      response.headers["content-disposition"]
    );

  /*
  |--------------------------------------------------------------------------
  | EXTENSION DARI MIME
  |--------------------------------------------------------------------------
  */

  const mimeType =
    String(
      response.headers["content-type"] ||
      "application/octet-stream"
    )
      .split(";")[0]
      .trim();

  /*
  |--------------------------------------------------------------------------
  | DEFAULT NAME
  |--------------------------------------------------------------------------
  */

  if (!fileName) {

    fileName =
      `gdrive-${fileId}${extensionFromMime(mimeType)}`;
  }

  /*
  |--------------------------------------------------------------------------
  | NORMALIZE FILE NAME
  |--------------------------------------------------------------------------
  */

  fileName =
    sanitizeFileName(
      fileName
    );

  /*
  |--------------------------------------------------------------------------
  | DOWNLOAD STREAM
  |--------------------------------------------------------------------------
  */

  let downloaded = 0;

  const output =
    createWriteStream(
      tempPath
    );

  /*
  |--------------------------------------------------------------------------
  | HITUNG DOWNLOAD
  |--------------------------------------------------------------------------
  */

  response.data.on(
    "data",
    chunk => {

      downloaded +=
        chunk.length;

      if (
        downloaded > MAX_FILE_SIZE
      ) {

        response.data.destroy(
          new Error(
            `Ukuran file melebihi batas ${formatBytes(MAX_FILE_SIZE)}`
          )
        );
      }
    }
  );

  /*
  |--------------------------------------------------------------------------
  | PIPE
  |--------------------------------------------------------------------------
  */

  try {

    await pipeline(
      response.data,
      output
    );

  } catch (error) {

    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {}

    throw error;
  }

  /*
  |--------------------------------------------------------------------------
  | STAT FILE
  |--------------------------------------------------------------------------
  */

  const stat =
    fs.statSync(
      tempPath
    );

  /*
  |--------------------------------------------------------------------------
  | FINAL SIZE CHECK
  |--------------------------------------------------------------------------
  */

  if (
    stat.size >
    MAX_FILE_SIZE
  ) {

    try {
      fs.unlinkSync(tempPath);
    } catch {}

    throw new Error(
      `Ukuran file terlalu besar: ${formatBytes(stat.size)}. ` +
      `Maksimal ${formatBytes(MAX_FILE_SIZE)}.`
    );
  }

  /*
  |--------------------------------------------------------------------------
  | RETURN
  |--------------------------------------------------------------------------
  */

  return {
    filePath: tempPath,
    fileName,
    mimeType,
    size: stat.size
  };
}

/*
|--------------------------------------------------------------------------
| CHECK HTML RESPONSE
|--------------------------------------------------------------------------
*/

function isProbablyHtml(
  contentType,
  contentDisposition
) {

  const type =
    String(
      contentType ||
      ""
    ).toLowerCase();

  const disposition =
    String(
      contentDisposition ||
      ""
    ).toLowerCase();

  /*
  |--------------------------------------------------------------------------
  | Kalau ada attachment berarti file.
  |--------------------------------------------------------------------------
  */

  if (
    disposition.includes(
      "attachment"
    )
  ) {
    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | HTML
  |--------------------------------------------------------------------------
  */

  return (
    type.includes("text/html") ||
    type.includes("application/xhtml")
  );
}

/*
|--------------------------------------------------------------------------
| STREAM -> STRING
|--------------------------------------------------------------------------
*/

async function streamToString(
  stream
) {

  const chunks = [];

  for await (
    const chunk of stream
  ) {

    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );

    /*
    |--------------------------------------------------------------------------
    | Jangan menerima HTML terlalu besar
    |--------------------------------------------------------------------------
    */

    const size =
      chunks.reduce(
        (total, item) =>
          total + item.length,
        0
      );

    if (
      size > 5 * 1024 * 1024
    ) {
      stream.destroy();

      throw new Error(
        "Response Google Drive terlalu besar."
      );
    }
  }

  return Buffer
    .concat(chunks)
    .toString("utf8");
}

/*
|--------------------------------------------------------------------------
| EXTRACT CONFIRM TOKEN
|--------------------------------------------------------------------------
*/

function extractConfirmToken(
  html
) {

  /*
  |--------------------------------------------------------------------------
  | confirm=TOKEN
  |--------------------------------------------------------------------------
  */

  let match =
    html.match(
      /confirm=([0-9A-Za-z_-]+)/i
    );

  if (match?.[1]) {
    return match[1];
  }

  /*
  |--------------------------------------------------------------------------
  | hidden input confirm
  |--------------------------------------------------------------------------
  */

  match =
    html.match(
      /name=["']confirm["'][^>]*value=["']([^"']+)["']/i
    );

  if (match?.[1]) {
    return match[1];
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| EXTRACT DOWNLOAD ACTION
|--------------------------------------------------------------------------
*/

function extractDownloadAction(
  html
) {

  /*
  |--------------------------------------------------------------------------
  | FORM ACTION
  |--------------------------------------------------------------------------
  */

  const match =
    html.match(
      /<form[^>]+action=["']([^"']+)["'][^>]*>/i
    );

  if (!match?.[1]) {
    return null;
  }

  return decodeHtmlEntities(
    match[1]
  );
}

/*
|--------------------------------------------------------------------------
| EXTRACT FILE NAME
|--------------------------------------------------------------------------
*/

function extractFileName(
  contentDisposition
) {

  if (!contentDisposition) {
    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | filename*=UTF-8''
  |--------------------------------------------------------------------------
  */

  let match =
    contentDisposition.match(
      /filename\*\s*=\s*UTF-8''([^;]+)/i
    );

  if (match?.[1]) {

    try {

      return repairMojibake(
        decodeURIComponent(match[1])
      );

    } catch {

      return repairMojibake(match[1]);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | filename="..."
  |--------------------------------------------------------------------------
  */

  match =
    contentDisposition.match(
      /filename\s*=\s*"([^"]+)"/i
    );

  if (match?.[1]) {
    return repairMojibake(match[1]);
  }

  /*
  |--------------------------------------------------------------------------
  | filename=...
  |--------------------------------------------------------------------------
  */

  match =
    contentDisposition.match(
      /filename\s*=\s*([^;]+)/i
    );

  if (match?.[1]) {
    return repairMojibake(match[1].trim());
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| REPAIR UTF-8 FILENAME DECODED AS LATIN-1
|--------------------------------------------------------------------------
*/

function repairMojibake(value) {
  const input = String(value || "");
  if (!input) return null;

  // Google Drive/HTTP headers can arrive as latin-1 even when the
  // original filename was UTF-8. Only repair when the text strongly
  // resembles mojibake, so normal Unicode filenames stay untouched.
  if (!/[ÃÂâð�]/.test(input)) return input;

  try {
    const repaired = Buffer.from(input, "latin1").toString("utf8");
    if (repaired && !repaired.includes("�")) return repaired;
  } catch {}

  return input;
}

/*
|--------------------------------------------------------------------------
| COLLECT COOKIES
|--------------------------------------------------------------------------
*/

function collectCookies(
  response,
  cookies
) {

  const setCookie =
    response.headers[
      "set-cookie"
    ];

  if (!Array.isArray(setCookie)) {
    return;
  }

  for (
    const cookie of setCookie
  ) {

    const first =
      cookie.split(";")[0];

    const separator =
      first.indexOf("=");

    if (
      separator === -1
    ) {
      continue;
    }

    const key =
      first.slice(
        0,
        separator
      ).trim();

    const value =
      first.slice(
        separator + 1
      ).trim();

    if (key) {
      cookies[key] = value;
    }
  }
}

/*
|--------------------------------------------------------------------------
| DRIVE ERROR
|--------------------------------------------------------------------------
*/

function extractDriveError(
  html
) {

  if (!html) {
    return null;
  }

  const cleaned =
    html
      .replace(
        /<[^>]+>/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const patterns = [
    /Sorry,\s*you can't access this item/i,
    /Access denied/i,
    /File not found/i,
    /Download quota exceeded/i,
    /too many users have viewed or downloaded this file/i
  ];

  for (
    const pattern of patterns
  ) {

    const match =
      cleaned.match(
        pattern
      );

    if (match?.[0]) {
      return match[0];
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| MIME -> EXTENSION
|--------------------------------------------------------------------------
*/

function extensionFromMime(
  mime
) {

  const map = {

    "application/pdf":
      ".pdf",

    "application/zip":
      ".zip",

    "application/x-rar-compressed":
      ".rar",

    "application/vnd.rar":
      ".rar",

    "application/x-7z-compressed":
      ".7z",

    "application/json":
      ".json",

    "text/plain":
      ".txt",

    "text/html":
      ".html",

    "image/jpeg":
      ".jpg",

    "image/png":
      ".png",

    "image/webp":
      ".webp",

    "video/mp4":
      ".mp4",

    "audio/mpeg":
      ".mp3",

    "audio/mp4":
      ".m4a"
  };

  return map[mime] || "";
}

/*
|--------------------------------------------------------------------------
| SANITIZE FILE NAME
|--------------------------------------------------------------------------
*/

function sanitizeFileName(
  name
) {

  let value =
    String(
      name ||
      "gdrive-file"
    );

  value =
    value
      .replace(
        /[\u0000-\u001F<>:"/\\|?*]/g,
        "_"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (!value) {
    value = "gdrive-file";
  }

  /*
  |--------------------------------------------------------------------------
  | Batasi panjang nama
  |--------------------------------------------------------------------------
  */

  if (
    value.length > 180
  ) {

    const ext =
      path.extname(value);

    const base =
      path.basename(
        value,
        ext
      );

    value =
      base.slice(
        0,
        180 - ext.length
      ) + ext;
  }

  return value;
}

/*
|--------------------------------------------------------------------------
| FORMAT BYTES
|--------------------------------------------------------------------------
*/

function formatBytes(
  bytes
) {

  const value =
    Number(bytes);

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB"
  ];

  const index =
    Math.min(
      Math.floor(
        Math.log(value) /
        Math.log(1024)
      ),
      units.length - 1
    );

  const size =
    value /
    Math.pow(
      1024,
      index
    );

  return (
    size >= 100
      ? size.toFixed(0)
      : size >= 10
        ? size.toFixed(1)
        : size.toFixed(2)
  ) +
    ` ${units[index]}`;
}

/*
|--------------------------------------------------------------------------
| NORMALIZE AXIOS ERROR
|--------------------------------------------------------------------------
*/

function normalizeAxiosError(
  error
) {

  if (
    error?.response
  ) {

    const status =
      error.response.status;

    if (status === 403) {
      return new Error(
        "Google Drive menolak akses ke file. Pastikan file bersifat publik."
      );
    }

    if (status === 404) {
      return new Error(
        "File Google Drive tidak ditemukan."
      );
    }

    if (status === 429) {
      return new Error(
        "Google Drive sedang membatasi permintaan. Coba lagi beberapa saat."
      );
    }

    return new Error(
      `Google Drive mengembalikan HTTP ${status}.`
    );
  }

  if (
    error?.code ===
    "ECONNABORTED"
  ) {

    return new Error(
      "Download timeout. File terlalu lama untuk diambil."
    );
  }

  return error instanceof Error
    ? error
    : new Error(
        String(error)
      );
}

/*
|--------------------------------------------------------------------------
| HTML ENTITY DECODER
|--------------------------------------------------------------------------
*/

function decodeHtmlEntities(
  value
) {

  return String(value)
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    );
}