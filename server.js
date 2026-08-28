import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { EditorUtils } from './public/js/editor-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file if present
function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    } catch (_) {}
  }
}

loadEnvFile(path.join(__dirname, '.env'));

function resolvePort() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const val = parseInt(args[i + 1], 10);
      if (Number.isFinite(val) && val > 0 && val <= 65535) return val;
    } else if (arg.startsWith('--port=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(val) && val > 0 && val <= 65535) return val;
    }
  }
  if (process.env.PORT) {
    const val = parseInt(process.env.PORT, 10);
    if (Number.isFinite(val) && val > 0 && val <= 65535) return val;
  }
  return 3000;
}

const app = express();
let PORT = resolvePort();

// Setup directories
const uploadsDir = path.join(__dirname, 'uploads');
const tempDir = path.join(__dirname, 'temp');
const publicDir = path.join(__dirname, 'public');

[uploadsDir, tempDir, publicDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure Multer for video and image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

function parsePlaybackSpeed(value) {
  if (value === undefined || value === null || value === '') return 1;
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed < EditorUtils.MIN_SPEED || speed > EditorUtils.MAX_SPEED) {
    const error = new Error(`playbackSpeed must be between ${EditorUtils.MIN_SPEED} and ${EditorUtils.MAX_SPEED}`);
    error.statusCode = 400;
    throw error;
  }
  return speed;
}

function removeFileIfExists(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {
    // Periodic cleanup remains as a fallback for locked files.
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', args);
    let stderr = '';
    let settled = false;

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    process.on('error', (error) => {
      if (settled) return;
      settled = true;
      error.stderr = stderr;
      reject(error);
    });
    process.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ stderr });
      else {
        const error = new Error(`FFmpeg exited with code ${code}`);
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

// Clean up old files periodically (older than 1 hour)
function cleanupTempFiles() {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour

  [uploadsDir, tempDir].forEach((dir) => {
    fs.readdir(dir, (err, files) => {
      if (err) return;
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          if (now - stats.mtimeMs > maxAge) {
            fs.unlink(filePath, () => {});
          }
        });
      });
    });
  });
}
setInterval(cleanupTempFiles, 15 * 60 * 1000);

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// API: Upload video
app.post('/api/upload-video', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  res.json({
    message: 'Video uploaded successfully',
    filename: req.file.filename,
    originalName: req.file.originalname,
    path: `/uploads/${req.file.filename}`,
    size: req.file.size
  });
});

// API: Extract Audio as MP3 using FFmpeg with customizable start/end trim
app.post('/api/extract-audio', upload.single('video'), async (req, res) => {
  let inputPath = null;
  let shouldDeleteInput = false;
  let outputPath = null;

  try {
    if (req.file) {
      inputPath = req.file.path;
      shouldDeleteInput = true;
    }

    const startTime = parseFloat(req.body.startTime) || 0;
    const endTime = parseFloat(req.body.endTime) || 0;
    const playbackSpeed = parsePlaybackSpeed(req.body.playbackSpeed);
    const downloadName = (req.body.downloadName || 'audio').replace(/[^a-zA-Z0-9_-]/g, '_');

    if (!inputPath && req.body.videoFilename) {
      inputPath = path.join(uploadsDir, path.basename(req.body.videoFilename));
      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({ error: 'Referenced video file not found on server' });
      }
    } else if (!inputPath) {
      return res.status(400).json({ error: 'No video provided for audio extraction' });
    }

    const outputFilename = `audio-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`;
    outputPath = path.join(tempDir, outputFilename);

    // Build FFmpeg command
    const ffmpegArgs = [];

    if (startTime > 0) {
      ffmpegArgs.push('-ss', startTime.toString());
    }

    ffmpegArgs.push('-i', inputPath);

    if (endTime > startTime && endTime > 0) {
      const duration = endTime - startTime;
      ffmpegArgs.push('-t', duration.toString());
    }

    ffmpegArgs.push(
      '-vn', // no video
      '-acodec', 'libmp3lame',
      '-q:a', '2', // high quality VBR ~190kbps
      '-y',
      outputPath
    );
    const tempo = EditorUtils.atempoFilter(playbackSpeed);
    if (tempo) ffmpegArgs.splice(ffmpegArgs.indexOf('-vn'), 0, '-filter:a', tempo);

    try {
      await runFfmpeg(ffmpegArgs);
    } catch (error) {
      console.error('FFmpeg audio extraction error:', error.stderr || error.message);
      const ffmpegError = new Error('Failed to extract audio with FFmpeg');
      ffmpegError.cause = error;
      throw ffmpegError;
    }

    const stat = fs.statSync(outputPath);
    if (stat.size === 0) {
      const error = new Error('No audio stream detected in video');
      error.statusCode = 400;
      throw error;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}.mp3"`);

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);
    readStream.on('close', () => {
      removeFileIfExists(outputPath);
      if (shouldDeleteInput) removeFileIfExists(inputPath);
    });
  } catch (err) {
    console.error('Audio extraction exception:', err);
    removeFileIfExists(outputPath);
    if (shouldDeleteInput) removeFileIfExists(inputPath);
    if (!res.headersSent) res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// API: Download Bundle ZIP (Sprite Sheet + MP3 Audio)
app.post('/api/export-bundle', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let shouldDeleteVideo = false;
  let tempAudioFile = null;

  if (req.file) {
    videoPath = req.file.path;
    shouldDeleteVideo = true;
  }

  const cleanupBundleFiles = () => {
    removeFileIfExists(tempAudioFile);
    if (shouldDeleteVideo) removeFileIfExists(videoPath);
  };

  try {
    const {
      spriteDataUrl,
      spriteFormat = 'png',
      downloadName = 'spritesheet',
      startTime = '0',
      endTime = '0',
      playbackSpeed = '1',
      videoFilename
    } = req.body;

    const baseName = (downloadName || 'spritesheet').replace(/[^a-zA-Z0-9_-]/g, '_');
    const validatedPlaybackSpeed = parsePlaybackSpeed(playbackSpeed);
    const ext = spriteFormat.toLowerCase() === 'webp' ? 'webp' : 'png';
    const spriteFilename = `${baseName}.${ext}`;
    const audioFilename = `${baseName}.mp3`;

    if (!videoPath && videoFilename) {
      videoPath = path.join(uploadsDir, path.basename(videoFilename));
    }

    // Extract audio before starting the HTTP response. If this fails, the client
    // receives a normal error and can use its separate-download fallback.
    if (videoPath && fs.existsSync(videoPath)) {
      tempAudioFile = path.join(tempDir, `bundle-audio-${Date.now()}.mp3`);
      const sTime = parseFloat(startTime) || 0;
      const eTime = parseFloat(endTime) || 0;
      const speed = validatedPlaybackSpeed;

      const ffmpegArgs = [];
      if (sTime > 0) ffmpegArgs.push('-ss', sTime.toString());
      ffmpegArgs.push('-i', videoPath);
      if (eTime > sTime && eTime > 0) {
        ffmpegArgs.push('-t', (eTime - sTime).toString());
      }
      ffmpegArgs.push('-vn', '-acodec', 'libmp3lame', '-q:a', '2', '-y', tempAudioFile);
      const tempo = EditorUtils.atempoFilter(speed);
      if (tempo) ffmpegArgs.splice(ffmpegArgs.indexOf('-vn'), 0, '-filter:a', tempo);

      try {
        await runFfmpeg(ffmpegArgs);
        const stat = fs.statSync(tempAudioFile);
        if (stat.size === 0) throw new Error('FFmpeg produced an empty audio file');
      } catch (error) {
        console.error('FFmpeg bundle audio error:', error.stderr || error.message);
        throw new Error('Failed to extract audio for bundle', { cause: error });
      }
    }

    // Prepare archive only after all fallible media processing has completed.
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (error) => {
      if (res.headersSent) res.destroy(error);
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}_bundle.zip"`);
    res.once('close', cleanupBundleFiles);
    archive.pipe(res);

    if (spriteDataUrl) {
      const base64Data = spriteDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      archive.append(imageBuffer, { name: spriteFilename });
    }
    if (tempAudioFile) archive.file(tempAudioFile, { name: audioFilename });

    await archive.finalize();
  } catch (err) {
    console.error('Export bundle error:', err);
    cleanupBundleFiles();
    if (!res.headersSent) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  }
});

// Start Server with auto-fallback if port is busy
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Video Background Remover & Sprite Sheet Studio running!`);
    console.log(`🌐 URL: http://localhost:${port}`);
    console.log(`=======================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Port ${port} is currently in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);
