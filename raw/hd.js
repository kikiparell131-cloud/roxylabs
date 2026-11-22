import axios from 'axios'
import * as cheerio from 'cheerio'
import FormData from 'form-data'
import crypto from 'crypto'
import sharp from 'sharp'

export default {
  name: 'hd',
  command: ['hd', 'hdr'],
  category: 'tools',
  description: 'Meningkatkan kualitas dan resolusi gambar',
  limit: 10,
  premium: false,

  async execute({ sock, m, command }) {
    const quoted = m.quoted ? m.quoted : m
    const mime = quoted?.msg?.mimetype || quoted?.mimetype || ''

    if (!/image/.test(mime)) {
      return m.reply(
        `❌ Kirim atau reply foto dengan caption .${command}`
      )
    }

    let media

    try {
      media = await quoted.download()
    } catch (error) {
      return m.reply(
        `❌ Gagal mengunduh gambar.\n\n${error.message}`
      )
    }

    if (!media || !Buffer.isBuffer(media)) {
      return m.reply('❌ File gambar tidak berhasil didapatkan.')
    }

    // HDR = scale 4, HD = scale 2
    const scale = /^hdr$/i.test(command) ? 4 : 2

    // =========================
    // STATUS PROSES
    // =========================
    let statusMsg

    try {
      statusMsg = await sock.sendMessage(
        m.chat,
        {
          text:
            `⏳ *MEMPROSES GAMBAR*\n\n` +
            `> Mode: ${command.toUpperCase()}\n` +
            `> Scale: ${scale}x\n\n` +
            `Mohon tunggu, gambar sedang ditingkatkan kualitasnya...`
        },
        { quoted: m.raw }
      )
    } catch {
      statusMsg = null
    }

    let result

    try {
      // =========================
      // iLoveIMG
      // =========================
      result = await hdr(media, scale)

      if (statusMsg) {
        try {
          await sock.sendMessage(
            m.chat,
            {
              text:
                `✅ *PROSES SELESAI*\n\n` +
                `Gambar berhasil diproses menggunakan iLoveIMG.\n` +
                `Mengirim hasil...`,
              edit: statusMsg.key
            }
          )
        } catch {}
      }

    } catch (error) {
      console.log(
        '[iLoveIMG Error] Fallback ke Remini:',
        error.message
      )

      if (statusMsg) {
        try {
          await sock.sendMessage(
            m.chat,
            {
              text:
                `⚠️ *iLoveIMG GAGAL*\n\n` +
                `Beralih ke engine Remini...\n` +
                `Mohon tunggu sebentar.`,
              edit: statusMsg.key
            }
          )
        } catch {}
      }

      try {
        // =========================
        // REMINI FALLBACK
        // =========================
        result = await reminiHDFallback(media)

        if (statusMsg) {
          try {
            await sock.sendMessage(
              m.chat,
              {
                text:
                  `✅ *PROSES SELESAI*\n\n` +
                  `Gambar berhasil diproses menggunakan Remini.\n` +
                  `Mengirim hasil...`,
                edit: statusMsg.key
              }
            )
          } catch {}
        }

      } catch (err) {
        console.error('[Remini Error]', err)

        if (statusMsg) {
          try {
            await sock.sendMessage(
              m.chat,
              {
                text:
                  `❌ *GAGAL MEMPROSES GAMBAR*\n\n` +
                  `${err.message || 'Terjadi kesalahan.'}`,
                edit: statusMsg.key
              }
            )
          } catch {}
        }

        return
      }
    }

    // =========================
    // VALIDASI HASIL
    // =========================
    if (!result || !Buffer.isBuffer(result)) {
      if (statusMsg) {
        try {
          await sock.sendMessage(
            m.chat,
            {
              text: '❌ Hasil gambar tidak valid.',
              edit: statusMsg.key
            }
          )
        } catch {}
      }

      return
    }

    // =========================
    // KIRIM HASIL
    // =========================
    try {
      await sock.sendMessage(
        m.chat,
        {
          image: result,
          mimetype: 'image/png',
          fileName: `${command}-hd.png`,
          caption:
            `✨ *${command.toUpperCase()} BERHASIL*\n\n` +
            `> Scale: ${scale}x\n` +
            `> Limit: 10\n\n` +
            `© FRANXX MD`
        },
        { quoted: m.raw }
      )

      // Update status setelah hasil terkirim
      if (statusMsg) {
        try {
          await sock.sendMessage(
            m.chat,
            {
              text:
                `✅ *SELESAI*\n\n` +
                `Hasil ${command.toUpperCase()} sudah dikirim.`,
              edit: statusMsg.key
            }
          )
        } catch {}
      }

    } catch (error) {
      console.error('[HD Send Error]', error)

      if (statusMsg) {
        try {
          await sock.sendMessage(
            m.chat,
            {
              text:
                `❌ Gagal mengirim hasil.\n\n` +
                `${error.message}`,
              edit: statusMsg.key
            }
          )
        } catch {}
      }
    }
  }
}


// ============================================================
// iLoveIMG API
// ============================================================

async function getToken() {
  try {
    const html = await axios.get(
      'https://www.iloveimg.com/upscale-image'
    )

    const $ = cheerio.load(html.data)

    const script = $('script')
      .filter((i, el) =>
        $(el).html()?.includes('ilovepdfConfig =')
      )
      .html()

    if (!script) {
      throw new Error('Config iLoveIMG tidak ditemukan')
    }

    const jsonS = script
      .split('ilovepdfConfig = ')[1]
      .split(';')[0]

    const json = JSON.parse(jsonS)

    const csrf = $('meta[name="csrf-token"]').attr('content')

    if (!json.token) {
      throw new Error('Token iLoveIMG tidak ditemukan')
    }

    return {
      token: json.token,
      csrf
    }

  } catch (err) {
    throw new Error(`Error token: ${err.message}`)
  }
}


async function uploadImage(server, headers, buffer, task) {
  const form = new FormData()

  form.append('name', 'image.jpg')
  form.append('chunk', '0')
  form.append('chunks', '1')
  form.append('task', task)
  form.append('preview', '1')
  form.append(
    'file',
    buffer,
    {
      filename: 'image.jpg',
      contentType: 'image/jpeg'
    }
  )

  const res = await axios.post(
    `https://${server}.iloveimg.com/v1/upload`,
    form,
    {
      headers: {
        ...headers,
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  )

  return res.data
}


async function hdr(buffer, scale = 4) {
  const { token, csrf } = await getToken()

  const servers = [
    'api1g',
    'api2g',
    'api3g',
    'api8g',
    'api9g',
    'api10g',
    'api11g',
    'api12g',
    'api13g',
    'api14g',
    'api15g',
    'api16g',
    'api17g',
    'api18g',
    'api19g',
    'api20g',
    'api21g',
    'api22g',
    'api24g',
    'api25g'
  ]

  const server =
    servers[Math.floor(Math.random() * servers.length)]

  const task =
    'r68zl88mq72xq94j2d5p66bn2z9lrbx20njsbw2qsAvgmzr11lvfhAx9kl87pp6yqgx7c8vg7sfbqnrr42qb16v0gj8jl5s0kq1kgp26mdyjjspd8c5A2wk8b4Adbm6vf5tpwbqlqdr8A9tfn7vbqvy28ylphlxdl379psxpd8r70nzs3sk1'

  const headers = {
    Authorization: `Bearer ${token}`,
    Origin: 'https://www.iloveimg.com/',
    Cookie: `_csrf=${csrf}`,
    'User-Agent': 'Mozilla/5.0'
  }

  const upload = await uploadImage(
    server,
    headers,
    buffer,
    task
  )

  if (!upload?.server_filename) {
    throw new Error('Upload gambar ke iLoveIMG gagal')
  }

  const form = new FormData()

  form.append('task', task)
  form.append(
    'server_filename',
    upload.server_filename
  )
  form.append('scale', String(scale))

  const res = await axios.post(
    `https://${server}.iloveimg.com/v1/upscale`,
    form,
    {
      headers: {
        ...headers,
        ...form.getHeaders()
      },
      responseType: 'arraybuffer',
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  )

  return Buffer.from(res.data)
}


// ============================================================
// REMINI API FALLBACK
// ============================================================

const API =
  'https://a.android.api.remini.ai/v1/mobile'

const ORACLE =
  'https://api.remini.ai/v1/mobile/oracle'


function genId() {
  const a = crypto
    .randomUUID()
    .replace(/-/g, '')
    .slice(0, 16)

  return {
    android_id: a,
    aaid: crypto.randomUUID(),
    backup_persistent_id:
      a + '_com.bigwinepot.nwdn.international',
    non_backup_persistent_id:
      crypto.randomUUID()
  }
}


let dev = genId()
let token = null


function bh(extra = {}) {
  return {
    'bsp-id':
      'com.bigwinepot.nwdn.international.android',

    'build-number': '202514479',
    'build-version': '3.7.1020',

    country: 'US',

    'device-manufacturer': 'Samsung',
    'device-model': 'SM-G998B',
    'device-type': '6.8',

    language: 'en',
    locale: 'en_US',

    'os-version': '33',
    platform: 'Android',

    timezone: 'America/New_York',

    'android-id': dev.android_id,
    aaid: dev.aaid,

    'accept-encoding': 'gzip',
    'user-agent': 'okhttp/4.12.0',

    ...extra
  }
}


function ah(extra = {}) {
  const h = bh(extra)

  if (token) {
    h['identity-token'] = token
  }

  return h
}


async function auth() {
  dev = genId()

  const r = await fetch(
    ORACLE + '/setup',
    {
      headers: bh({
        'first-install-timestamp':
          Math.floor(Date.now() / 1000) + 'E9',

        'backup-persistent-id':
          dev.backup_persistent_id,

        'non-backup-persistent-id':
          dev.non_backup_persistent_id,

        environment: 'Production',
        'settings-response-version': 'v2',

        'is-app-running-in-background': 'false',
        'is-old-user': 'true',

        'app-set-id':
          'd44bd45a-a45d-4470-9674-7348a8e3fb71'
      })
    }
  )

  if (!r.ok) {
    throw new Error(
      `Remini auth HTTP ${r.status}`
    )
  }

  const d = await r.json()

  token =
    d?.settings?.__identity__?.token

  if (!token) {
    throw new Error(
      'Token Remini tidak ditemukan'
    )
  }

  await fetch(
    API + '/users/@me',
    {
      headers: ah()
    }
  )
}


async function reminiHDFallback(buffer) {
  await auth()

  const mime = 'image/jpeg'

  const md5 = crypto
    .createHash('md5')
    .update(buffer)
    .digest('base64')

  const meta = {
    size: buffer.length
  }

  try {
    const m = await sharp(buffer).metadata()

    meta.width = m.width
    meta.height = m.height
  } catch {}

  const taskR = await fetch(
    API + '/tasks',
    {
      method: 'POST',

      headers: ah({
        'content-type':
          'application/json; charset=UTF-8'
      }),

      body: JSON.stringify({
        image_content_type: mime,
        image_md5: md5,

        feature: {
          type: 'enhance',
          models: []
        },

        metadata: meta,

        options: {
          high_quality_output: false,
          save_input: true
        }
      })
    }
  )

  if (!taskR.ok) {
    throw new Error(
      `Remini task HTTP ${taskR.status}`
    )
  }

  const taskD = await taskR.json()

  if (
    !taskD.task_id ||
    !taskD.upload_url ||
    !taskD.upload_headers
  ) {
    throw new Error(
      'Data task Remini tidak lengkap'
    )
  }

  await fetch(
    taskD.upload_url,
    {
      method: 'PUT',

      headers: {
        ...taskD.upload_headers,
        'Content-Length':
          buffer.length.toString(),
        'User-Agent':
          'okhttp/4.12.0'
      },

      body: buffer
    }
  )

  await fetch(
    API +
      '/tasks/' +
      taskD.task_id +
      '/process',
    {
      method: 'POST',

      headers: ah({
        'content-length': '0'
      })
    }
  )

  let cdnUrl = null

  for (let i = 0; i < 40; i++) {
    await new Promise(resolve =>
      setTimeout(resolve, 5000)
    )

    const pr = await fetch(
      API +
        '/tasks/' +
        taskD.task_id,
      {
        headers: ah()
      }
    )

    if (!pr.ok) {
      continue
    }

    const pd = await pr.json()

    if (pd.status === 'completed') {
      const outs =
        pd.result?.outputs

      if (
        Array.isArray(outs) &&
        outs[0]?.url
      ) {
        cdnUrl = outs[0].url
      }

      break
    }

    if (
      pd.status === 'failed' ||
      pd.status === 'error'
    ) {
      throw new Error(
        'Remini task gagal'
      )
    }
  }

  if (!cdnUrl) {
    throw new Error(
      'Tidak mendapatkan URL hasil Remini'
    )
  }

  const finalImage = await axios.get(
    cdnUrl,
    {
      responseType: 'arraybuffer'
    }
  )

  return Buffer.from(finalImage.data)
}