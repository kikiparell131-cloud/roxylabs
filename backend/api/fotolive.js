/**
 * Roxy Main API — FotoLive converter.
 * Accepts one video upload (maximum 5 MiB), extracts its first frame as a JPEG,
 * and returns the still image + original motion video as a paired-media payload.
 * This is an API representation of the WhatsApp Live Photo pair; it does not
 * send a WhatsApp message or create a proprietary device Live Photo container.
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

function extractFirstFrame(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFMPEG_NOT_AVAILABLE'));
    const child = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-frames:v', '1',
      '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
      '-q:v', '3',
      outputPath
    ], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return resolve();
      reject(new Error(`FFMPEG_FAILED:${stderr.slice(-1200)}`));
    });
  });
}

module.exports = {
  name: 'FotoLive Converter',
  path: '/api/v1/fotolive',
  method: 'POST',
  category: 'Media Tools',
  plan: 'Both',
  description: 'Upload a video up to 5 MB and convert it into a paired still-image + motion-video FotoLive payload.',
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
      const inputPath = path.join(os.tmpdir(), `${id}.video`);
      const imagePath = path.join(os.tmpdir(), `${id}.jpg`);
      try {
        fs.writeFileSync(inputPath, file.buffer, { flag: 'wx' });
        await extractFirstFrame(inputPath, imagePath);
        const image = fs.readFileSync(imagePath);
        const videoMime = file.mimetype.toLowerCase();
        return res.json({
          success: true,
          source: 'Roxy FotoLive Converter',
          result: {
            id,
            format: 'fotolive-pair',
            image: { mimeType: 'image/jpeg', encoding: 'base64', data: image.toString('base64'), dataUrl: `data:image/jpeg;base64,${image.toString('base64')}` },
            motion: { mimeType: videoMime, encoding: 'base64', data: file.buffer.toString('base64'), dataUrl: `data:${videoMime};base64,${file.buffer.toString('base64')}` },
            pairing: {
              imagePairedMediaType: 5,
              videoPairedMediaType: 6,
              associationType: 12,
              description: 'Still image and motion video are returned as a paired-media payload.'
            },
            original: { fileName: path.basename(file.originalname || 'video'), sizeBytes: file.size, sizeLimitBytes: MAX_VIDEO_BYTES }
          },
          note: 'This endpoint returns the two media components and pairing metadata. It does not send WhatsApp messages or generate a proprietary native Live Photo file.'
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
        for (const temp of [inputPath, imagePath]) {
          try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
        }
      }
    });
  }
};
