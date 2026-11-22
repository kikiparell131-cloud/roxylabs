"use strict";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import webpmux from "node-webpmux";

import {
  downloadContentFromMessage
} from "@whiskeysockets/baileys";

import config from "../../config.js";

const { Image } = webpmux;

/* ============================================================
 * CONFIG
 * ========================================================== */

const DEFAULT_PACKNAME = "FRANXX MD";
const DEFAULT_AUTHOR = "Kyuu";

const MAX_VIDEO_DURATION = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const TEMP_DIR = path.join(
  os.tmpdir(),
  "franxx-sticker"
);

/* ============================================================
 * STICKER CONFIG
 * ========================================================== */

function getStickerConfig() {
  const stickerConfig =
    config?.sticker || {};

  const packname = String(
    stickerConfig.packname ||
    stickerConfig.packName ||
    DEFAULT_PACKNAME
  )
    .trim()
    .slice(0, 128);

  const author = String(
    stickerConfig.author ||
    stickerConfig.authorName ||
    DEFAULT_AUTHOR
  )
    .trim()
    .slice(0, 128);

  return {
    packname:
      packname || DEFAULT_PACKNAME,

    author:
      author || DEFAULT_AUTHOR
  };
}

/* ============================================================
 * TEMP DIRECTORY
 * ========================================================== */

function ensureTempDir() {
  fs.mkdirSync(
    TEMP_DIR,
    {
      recursive: true
    }
  );
}

function randomId() {
  return crypto
    .randomBytes(16)
    .toString("hex");
}

function tempFile(extension) {
  ensureTempDir();

  return path.join(
    TEMP_DIR,
    `franxx-${Date.now()}-${randomId()}${extension}`
  );
}

function removeFile(file) {
  try {
    if (
      file &&
      fs.existsSync(file)
    ) {
      fs.unlinkSync(file);
    }
  } catch {}
}

/* ============================================================
 * CHAT JID
 * ========================================================== */

function getChatJid(m) {
  const jid =
    m?.chat ||
    m?.from ||
    m?.jid ||
    m?.key?.remoteJid ||
    null;

  if (
    typeof jid !== "string" ||
    !jid.trim()
  ) {
    return null;
  }

  return jid.trim();
}

/* ============================================================
 * QUOTED MESSAGE
 * ========================================================== */

function getQuotedMessage(raw) {
  if (!raw?.message) {
    return null;
  }

  const message =
    raw.message;

  const possibleMessages = [
    message.extendedTextMessage,
    message.imageMessage,
    message.videoMessage,
    message.stickerMessage,
    message.documentMessage
  ];

  for (
    const item
    of possibleMessages
  ) {
    const quoted =
      item?.contextInfo
        ?.quotedMessage;

    if (quoted) {
      return quoted;
    }
  }

  const documentWrapper =
    message.documentWithCaptionMessage;

  const documentMessage =
    documentWrapper
      ?.message
      ?.documentMessage;

  if (
    documentMessage
      ?.contextInfo
      ?.quotedMessage
  ) {
    return documentMessage
      .contextInfo
      .quotedMessage;
  }

  return null;
}

/* ============================================================
 * MEDIA DETECTION
 * ========================================================== */

function detectMedia(message) {
  if (!message) {
    return null;
  }

  /* IMAGE */

  if (message.imageMessage) {
    return {
      type: "image",
      message:
        message.imageMessage
    };
  }

  /* VIDEO */

  if (message.videoMessage) {
    return {
      type: "video",
      message:
        message.videoMessage
    };
  }

  /* EXISTING STICKER */

  if (message.stickerMessage) {
    return {
      type: "sticker",
      message:
        message.stickerMessage
    };
  }

  /* DOCUMENT */

  if (message.documentMessage) {
    const document =
      message.documentMessage;

    const mime =
      String(
        document.mimetype || ""
      ).toLowerCase();

    if (
      mime === "image/webp"
    ) {
      return {
        type: "webp",
        message: document
      };
    }

    if (
      mime.startsWith(
        "image/"
      )
    ) {
      return {
        type: "image",
        message: document
      };
    }

    if (
      mime.startsWith(
        "video/"
      )
    ) {
      return {
        type: "video",
        message: document
      };
    }
  }

  /* DOCUMENT WITH CAPTION */

  if (
    message.documentWithCaptionMessage
  ) {
    const document =
      message
        .documentWithCaptionMessage
        ?.message
        ?.documentMessage;

    if (document) {
      const mime =
        String(
          document.mimetype || ""
        ).toLowerCase();

      if (
        mime === "image/webp"
      ) {
        return {
          type: "webp",
          message: document
        };
      }

      if (
        mime.startsWith(
          "image/"
        )
      ) {
        return {
          type: "image",
          message: document
        };
      }

      if (
        mime.startsWith(
          "video/"
        )
      ) {
        return {
          type: "video",
          message: document
        };
      }
    }
  }

  return null;
}

/* ============================================================
 * FIND MEDIA
 * ========================================================== */

function findMedia(raw) {
  const quoted =
    getQuotedMessage(raw);

  if (quoted) {
    const quotedMedia =
      detectMedia(quoted);

    if (quotedMedia) {
      return quotedMedia;
    }
  }

  return detectMedia(
    raw?.message
  );
}

/* ============================================================
 * STREAM -> BUFFER
 * ========================================================== */

async function streamToBuffer(stream) {
  const chunks = [];

  for await (
    const chunk
    of stream
  ) {
    if (
      chunk &&
      chunk.length
    ) {
      chunks.push(
        Buffer.from(chunk)
      );
    }
  }

  return Buffer.concat(
    chunks
  );
}

/* ============================================================
 * DOWNLOAD MEDIA
 * ========================================================== */

async function downloadMedia(media) {
  if (
    !media?.message
  ) {
    throw new Error(
      "Media tidak ditemukan."
    );
  }

  let downloadType;

  switch (
    media.type
  ) {
    case "image":
      downloadType = "image";
      break;

    case "video":
      downloadType = "video";
      break;

    case "webp":
      downloadType = "document";
      break;

    case "sticker":
      downloadType = "sticker";
      break;

    default:
      throw new Error(
        "Jenis media tidak didukung."
      );
  }

  const stream =
    await downloadContentFromMessage(
      media.message,
      downloadType
    );

  const buffer =
    await streamToBuffer(
      stream
    );

  if (
    !buffer.length
  ) {
    throw new Error(
      "Media yang didownload kosong."
    );
  }

  return buffer;
}

/* ============================================================
 * PROCESS RUNNER
 * ========================================================== */

function runProcess(
  command,
  args
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let child;

      try {
        child = spawn(
          command,
          args,
          {
            stdio: [
              "ignore",
              "pipe",
              "pipe"
            ]
          }
        );
      } catch (error) {
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";

      child.stdout?.on(
        "data",
        data => {
          stdout +=
            data.toString();
        }
      );

      child.stderr?.on(
        "data",
        data => {
          stderr +=
            data.toString();
        }
      );

      child.once(
        "error",
        reject
      );

      child.once(
        "close",
        code => {
          if (
            code === 0
          ) {
            resolve({
              stdout,
              stderr
            });

            return;
          }

          reject(
            new Error(
              stderr.trim() ||
              stdout.trim() ||
              `FFmpeg exited dengan code ${code}`
            )
          );
        }
      );
    }
  );
}

/* ============================================================
 * IMAGE -> WEBP
 * ========================================================== */

async function imageToWebp(
  buffer,
  output
) {
  await sharp(buffer)
    .rotate()
    .resize(
      512,
      512,
      {
        fit: "contain",
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0
        }
      }
    )
    .webp({
      quality: 90,
      effort: 4
    })
    .toFile(output);
}

/* ============================================================
 * EXISTING WEBP -> WEBP
 * ========================================================== */

async function normalizeWebp(
  buffer,
  output
) {
  await sharp(buffer)
    .resize(
      512,
      512,
      {
        fit: "contain",
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0
        }
      }
    )
    .webp({
      quality: 90,
      effort: 4
    })
    .toFile(output);
}

/* ============================================================
 * VIDEO -> ANIMATED WEBP
 * ========================================================== */

async function videoToWebp(
  buffer,
  output
) {
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg-static tidak tersedia. Jalankan npm install terlebih dahulu."
    );
  }

  const input =
    tempFile(".mp4");

  try {
    fs.writeFileSync(
      input,
      buffer
    );

    await runProcess(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",

        "-i",
        input,

        "-t",
        String(
          MAX_VIDEO_DURATION
        ),

        "-vf",
        [
          "fps=15",
          "scale=512:512:force_original_aspect_ratio=decrease",
          "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0",
          "format=yuva420p"
        ].join(","),

        "-an",

        "-c:v",
        "libwebp",

        "-loop",
        "0",

        "-q:v",
        "60",

        "-compression_level",
        "6",

        "-y",
        output
      ]
    );
  } finally {
    removeFile(input);
  }
}

/* ============================================================
 * CREATE WHATSAPP STICKER EXIF
 *
 * Format ini mengikuti struktur EXIF yang digunakan
 * oleh implementasi sticker WhatsApp / webpmux.
 * ========================================================== */

function createStickerExif(
  packname,
  author
) {
  const metadata = {
    "sticker-pack-id":
      `com.franxx.${crypto
        .randomBytes(32)
        .toString("hex")}`,

    "sticker-pack-name":
      packname,

    "sticker-pack-publisher":
      author,

    emojis: [
      ""
    ]
  };

  const jsonBuffer =
    Buffer.from(
      JSON.stringify(
        metadata
      ),
      "utf8"
    );

  /*
   * TIFF/EXIF header.
   */
  const exifAttr =
    Buffer.from([
      0x49,
      0x49,
      0x2a,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x41,
      0x57,
      0x07,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x16,
      0x00,
      0x00,
      0x00
    ]);

  const exif =
    Buffer.concat([
      exifAttr,
      jsonBuffer
    ]);

  /*
   * Panjang JSON berada pada offset 14.
   */
  exif.writeUIntLE(
    jsonBuffer.length,
    14,
    4
  );

  return exif;
}

/* ============================================================
 * ADD EXIF TO WEBP
 * ========================================================== */

async function addStickerMetadata(
  webpBuffer,
  packname,
  author
) {
  if (
    !Buffer.isBuffer(
      webpBuffer
    )
  ) {
    throw new Error(
      "WebP bukan Buffer."
    );
  }

  if (
    webpBuffer.length <
    12
  ) {
    throw new Error(
      "WebP terlalu kecil."
    );
  }

  if (
    webpBuffer.toString(
      "ascii",
      0,
      4
    ) !== "RIFF"
  ) {
    throw new Error(
      "Output bukan RIFF WebP."
    );
  }

  if (
    webpBuffer.toString(
      "ascii",
      8,
      12
    ) !== "WEBP"
  ) {
    throw new Error(
      "Output bukan WebP valid."
    );
  }

  const img =
    new Image();

  await img.load(
    webpBuffer
  );

  const exif =
    createStickerExif(
      packname,
      author
    );

  img.exif = exif;

  const finalBuffer =
    await img.save(null);

  if (
    !Buffer.isBuffer(
      finalBuffer
    ) ||
    !finalBuffer.length
  ) {
    throw new Error(
      "Gagal menyimpan EXIF ke WebP."
    );
  }

  return finalBuffer;
}

/* ============================================================
 * CREATE STICKER
 * ========================================================== */

async function createSticker({
  sock,
  m,
  raw
}) {
  const {
    packname,
    author
  } =
    getStickerConfig();

  const media =
    findMedia(raw);

  if (!media) {
    return m.reply(
      [
        "❌ *MEDIA TIDAK DITEMUKAN*",
        "",
        "Reply/kirim:",
        "🖼️ Gambar",
        "🎥 Video",
        "🧩 WebP",
        "",
        "Lalu gunakan:",
        "`.sticker`",
        "",
        "Alias:",
        "`.s`",
        "`.stiker`"
      ].join("\n")
    );
  }

  /*
   * Cek durasi video dari metadata WhatsApp.
   */
  if (
    media.type ===
      "video" &&
    Number(
      media.message
        ?.seconds ||
      media.message
        ?.duration ||
      0
    ) >
      MAX_VIDEO_DURATION
  ) {
    return m.reply(
      [
        "❌ *VIDEO TERLALU PANJANG*",
        "",
        `Maksimal ${MAX_VIDEO_DURATION} detik.`
      ].join("\n")
    );
  }

  await m.reply(
    [
      "⏳ *MEMBUAT STICKER...*",
      "",
      `📦 Packname : ${packname}`,
      `👤 Author   : ${author}`
    ].join("\n")
  );

  let inputBuffer;

  try {
    inputBuffer =
      await downloadMedia(
        media
      );
  } catch (error) {
    console.error(
      "[STICKER DOWNLOAD]",
      error
    );

    return m.reply(
      [
        "❌ *GAGAL DOWNLOAD MEDIA*",
        "",
        error?.message ||
          String(error)
      ].join("\n")
    );
  }

  if (
    inputBuffer.length >
    MAX_FILE_SIZE
  ) {
    return m.reply(
      [
        "❌ *FILE TERLALU BESAR*",
        "",
        "Maksimal 25 MB."
      ].join("\n")
    );
  }

  const output =
    tempFile(".webp");

  try {
    /*
     * ========================================================
     * IMAGE
     * ========================================================
     */

    if (
      media.type ===
      "image"
    ) {
      await imageToWebp(
        inputBuffer,
        output
      );
    }

    /*
     * ========================================================
     * WEBP
     * ========================================================
     */

    else if (
      media.type ===
      "webp"
    ) {
      await normalizeWebp(
        inputBuffer,
        output
      );
    }

    /*
     * ========================================================
     * EXISTING STICKER
     * ========================================================
     */

    else if (
      media.type ===
      "sticker"
    ) {
      await normalizeWebp(
        inputBuffer,
        output
      );
    }

    /*
     * ========================================================
     * VIDEO
     * ========================================================
     */

    else if (
      media.type ===
      "video"
    ) {
      await videoToWebp(
        inputBuffer,
        output
      );
    }

    else {
      throw new Error(
        "Jenis media tidak didukung."
      );
    }

    /*
     * Pastikan output ada.
     */

    if (
      !fs.existsSync(
        output
      )
    ) {
      throw new Error(
        "FFmpeg/Sharp tidak menghasilkan WebP."
      );
    }

    let webpBuffer =
      fs.readFileSync(
        output
      );

    if (
      !webpBuffer.length
    ) {
      throw new Error(
        "WebP hasil konversi kosong."
      );
    }

    /*
     * ========================================================
     * INI BAGIAN PENTING
     *
     * Packname + author ditanam ke EXIF WebP.
     * ========================================================
     */

    webpBuffer =
      await addStickerMetadata(
        webpBuffer,
        packname,
        author
      );

    /*
     * Validasi final.
     */

    if (
      !Buffer.isBuffer(
        webpBuffer
      ) ||
      !webpBuffer.length
    ) {
      throw new Error(
        "Sticker final kosong."
      );
    }

    /*
     * Simpan final WebP.
     */

    fs.writeFileSync(
      output,
      webpBuffer
    );

    /*
     * ========================================================
     * JID CHAT
     * ========================================================
     */

    const jid =
      getChatJid(m);

    if (!jid) {
      throw new Error(
        "JID chat tidak ditemukan."
      );
    }

    /*
     * ========================================================
     * SEND STICKER
     *
     * Tidak menggunakan quoted supaya tidak terkena
     * error `reading 'fromMe'`.
     * ========================================================
     */

    await sock.sendMessage(
      jid,
      {
        sticker:
          webpBuffer
      }
    );

    console.log(
      `[STICKER] sent | pack="${packname}" | author="${author}" | jid=${jid}`
    );

  } catch (error) {
    console.error(
      "[PLUGIN:sticker]",
      error
    );

    return m.reply(
      [
        "❌ *GAGAL MEMBUAT STICKER*",
        "",
        error?.message ||
          String(error)
      ].join("\n")
    );
  } finally {
    removeFile(
      output
    );
  }
}

/* ============================================================
 * FRANXX PLUGIN EXPORT
 * ========================================================== */

export default {
  name: "sticker",

  command: [
    "sticker",
    "s"
  ],

  category: "sticker",

  description:
    "Membuat sticker dari gambar, video, WebP, dan sticker dengan packname serta author.",

  limit: 1,

  async execute({
    sock,
    m,
    raw
  }) {
    return createSticker({
      sock,
      m,
      raw
    });
  }
};