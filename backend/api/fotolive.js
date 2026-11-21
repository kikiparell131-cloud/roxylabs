/**
 * Roxy Main API — dual-output FotoLive converter.
 *
 * Output A: Android Motion Photo 1.0 single-file JPEG + appended MP4 + XMP.
 * Output B: separate image/video components and Baileys-compatible pairing
 * metadata for a WhatsApp bot to upload and relay as a motion-photo pair.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');

const MAX_VIDEO_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 0 }
});

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFMPEG_NOT_AVAILABLE'));
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) return resolve();
      reject(new Error(`FFMPEG_FAILED:${stderr.slice(-1600)}`));
    });
  });
}

// Normalize uploads (including MOV/WebM) to broadly compatible H.264/AAC MP4.
async function normalizeVideo(inputPath, mp4Path) {
  await runFFmpeg([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?',
    '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', mp4Path
  ]);
  if (!fs.existsSync(mp4Path) || fs.statSync(mp4Path).size < 16) {
    throw new Error('VIDEO_NORMALIZATION_FAILED');
  }
}

async function extractFirstFrame(mp4Path, jpgPath) {
  await runFFmpeg([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', mp4Path,
    '-frames:v', '1', '-q:v', '2', '-f', 'image2', jpgPath
  ]);
  if (!fs.existsSync(jpgPath) || fs.statSync(jpgPath).size < 4) {
    throw new Error('THUMBNAIL_FAILED');
  }
}

// Build an Android Motion Photo 1.0 XMP packet and inject it as a JPEG APP1.
// The primary item length is intentionally 0 (allowed by the spec); the MP4
// item length points to the appended video at the end of the container.
function makeMotionPhoto(jpeg, mp4) {
  if (!Buffer.isBuffer(jpeg) || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error('INVALID_JPEG_FRAME');
  }
  if (!Buffer.isBuffer(mp4) || mp4.length < 16 || mp4.toString('ascii', 4, 8) !== 'ftyp') {
    throw new Error('INVALID_MP4_MOTION_VIDEO');
  }

  // Include both the current GContainer directory and the legacy Google
  // Camera MicroVideoOffset tag. Many gallery implementations still rely on
  // the legacy tag to locate the MP4 appended after JPEG's EOI marker.
  const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" ` +
    `xmlns:Camera="http://ns.google.com/photos/1.0/camera/" ` +
    `xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" ` +
    `xmlns:Container="http://ns.google.com/photos/1.0/container/" ` +
    `xmlns:Item="http://ns.google.com/photos/1.0/container/item/" ` +
    `Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1" ` +
    `Camera:MotionPhotoPresentationTimestampUs="0" ` +
    `GCamera:MicroVideo="1" GCamera:MicroVideoVersion="1" ` +
    `GCamera:MicroVideoOffset="${mp4.length}">` +
    `<Container:Directory><rdf:Seq>` +
    `<rdf:li rdf:parseType="Resource"><Container:Item ` +
    `Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/>` +
    `</rdf:li>` +
    `<rdf:li rdf:parseType="Resource"><Container:Item ` +
    `Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${mp4.length}"/>` +
    `</rdf:li>` +
    `</rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>` +
    `<?xpacket end="w"?>`;

  const xmpHeader = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii');
  const xml = Buffer.from(xmp, 'utf8');
  const payload = Buffer.concat([xmpHeader, xml]);
  const segmentLength = payload.length + 2;
  if (segmentLength > 0xffff) throw new Error('XMP_TOO_LARGE');

  const app1 = Buffer.alloc(4);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(segmentLength, 2);

  // XMP must be embedded inside the JPEG header (before image scan data).
  // Appending the MP4 after the JPEG EOI keeps the still photo readable while
  // exposing the motion-video tail to Motion Photo-aware gallery applications.
  const jpegWithXmp = Buffer.concat([
    jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)
  ]);
  return Buffer.concat([jpegWithXmp, mp4]);
}

module.exports = {
  name: 'FotoLive Converter',
  path: '/api/v1/fotolive',
  method: 'POST',
  category: 'Media Tools',
  plan: 'Both',
  description: 'Upload a video up to 5 MB and create an Android Motion Photo file plus WhatsApp paired-media components.',
  async execute(req, res) {
    upload.single('video')(req, res, async error => {
      if (error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ success: false, code: 'VIDEO_TOO_LARGE', message: 'Maximum video size is 5 MB.' });
        }
        return res.status(400).json({ success: false, code: 'UPLOAD_INVALID', message: 'Upload exactly one video using multipart field "video".' });
      }

      const file = req.file;
      if (!file) return res.status(400).json({ success: false, code: 'VIDEO_REQUIRED', message: 'Send a video in multipart/form-data field "video".' });
      if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('video/')) {
        return res.status(415).json({ success: false, code: 'VIDEO_ONLY', message: 'The uploaded file must have a video MIME type.' });
      }
      if (file.size > MAX_VIDEO_BYTES) {
        return res.status(413).json({ success: false, code: 'VIDEO_TOO_LARGE', message: 'Maximum video size is 5 MB.' });
      }

      const id = `roxy_fotolive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const inputPath = path.join(os.tmpdir(), `${id}.input`);
      const mp4Path = path.join(os.tmpdir(), `${id}.mp4`);
      const imagePath = path.join(os.tmpdir(), `${id}.jpg`);
      try {
        fs.writeFileSync(inputPath, file.buffer, { flag: 'wx' });
        await normalizeVideo(inputPath, mp4Path);
        await extractFirstFrame(mp4Path, imagePath);

        const image = fs.readFileSync(imagePath);
        const motion = fs.readFileSync(mp4Path);
        const motionPhoto = makeMotionPhoto(image, motion);
        const imageBase64 = image.toString('base64');
        const motionBase64 = motion.toString('base64');
        const motionPhotoBase64 = motionPhoto.toString('base64');
        const downloadName = `${id}.MP.jpg`;

        return res.json({
          success: true,
          source: 'Roxy FotoLive Converter',
          result: {
            id,
            format: 'android-motion-photo-gcontainer-plus-gcamera-legacy',
            verifiedContainer: { jpegHeader: true, xmpEmbedded: true, mp4Appended: true, mp4Bytes: motion.length },
            gallery: {
              fileName: downloadName,
              mimeType: 'image/jpeg',
              extension: '.MP.jpg',
              encoding: 'base64',
              data: motionPhotoBase64,
              dataUrl: `data:image/jpeg;base64,${motionPhotoBase64}`,
              sizeBytes: motionPhoto.length,
              contains: ['JPEG still image', 'H.264/AAC MP4 appended after JPEG EOI', 'GContainer MotionPhoto XMP directory', 'Legacy GCamera MicroVideoOffset metadata']
            },
            image: {
              mimeType: 'image/jpeg', encoding: 'base64', data: imageBase64,
              dataUrl: `data:image/jpeg;base64,${imageBase64}`
            },
            motion: {
              mimeType: 'video/mp4', encoding: 'base64', data: motionBase64,
              dataUrl: `data:video/mp4;base64,${motionBase64}`
            },
            whatsapp: {
              format: 'baileys-motion-photo-pair',
              image: { mimeType: 'image/jpeg', encoding: 'base64', data: imageBase64 },
              video: { mimeType: 'video/mp4', encoding: 'base64', data: motionBase64 },
              imagePairedMediaType: 5,
              videoPairedMediaType: 6,
              associationType: 12,
              note: 'Bot must upload both components with Baileys and relay the paired messages; this API does not send WhatsApp messages.'
            },
            original: {
              fileName: path.basename(file.originalname || 'video'),
              sizeBytes: file.size,
              sizeLimitBytes: MAX_VIDEO_BYTES
            }
          },
          note: 'gallery.data is one JPEG+MP4 Motion Photo container. A browser preview shows only the still frame; download the complete .MP.jpg file and open it with a Motion Photo-compatible gallery. whatsapp contains the two separate media components and pairing metadata for a Baileys bot.'
        });
      } catch (err) {
        console.error('[FOTOLIVE]', err);
        const ffmpegMissing = String(err && err.message).includes('FFMPEG_NOT_AVAILABLE');
        return res.status(ffmpegMissing ? 503 : 422).json({
          success: false,
          code: ffmpegMissing ? 'FFMPEG_NOT_AVAILABLE' : 'VIDEO_CONVERSION_FAILED',
          message: ffmpegMissing ? 'FFmpeg is unavailable on this server.' : 'Could not read or convert this video. Try a valid supported video file.'
        });
      } finally {
        for (const temp of [inputPath, mp4Path, imagePath]) {
          try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
        }
      }
    });
  }
};
