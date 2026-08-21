import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
let PORT = parseInt(process.env.PORT, 10) || 3000;

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

  try {
    const startTime = parseFloat(req.body.startTime) || 0;
    const endTime = parseFloat(req.body.endTime) || 0;
    const downloadName = (req.body.downloadName || 'audio').replace(/[^a-zA-Z0-9_-]/g, '_');

    if (req.file) {
      inputPath = req.file.path;
      shouldDeleteInput = true;
    } else if (req.body.videoFilename) {
      inputPath = path.join(uploadsDir, path.basename(req.body.videoFilename));
      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({ error: 'Referenced video file not found on server' });
      }
    } else {
      return res.status(400).json({ error: 'No video provided for audio extraction' });
    }

    const outputFilename = `audio-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`;
    const outputPath = path.join(tempDir, outputFilename);

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

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    let stderrData = '';
    ffmpegProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('FFmpeg audio extraction error:', stderrData);
        if (shouldDeleteInput && inputPath && fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
        return res.status(500).json({ error: 'Failed to extract audio with FFmpeg', details: stderrData });
      }

      // Check if output file has size > 0
      const stat = fs.statSync(outputPath);
      if (stat.size === 0) {
        if (shouldDeleteInput && inputPath && fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
        return res.status(400).json({ error: 'No audio stream detected in video' });
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}.mp3"`);

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('close', () => {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (shouldDeleteInput && inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      });
    });
  } catch (err) {
    console.error('Audio extraction exception:', err);
    if (shouldDeleteInput && inputPath && fs.existsSync(inputPath)) {
      try { fs.unlinkSync(inputPath); } catch (_) {}
    }
    res.status(500).json({ error: err.message });
  }
});

// API: Download Bundle ZIP (Sprite Sheet + MP3 Audio)
app.post('/api/export-bundle', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let shouldDeleteVideo = false;

  try {
    const {
      spriteDataUrl,
      spriteFormat = 'png',
      downloadName = 'spritesheet',
      startTime = '0',
      endTime = '0',
      videoFilename
    } = req.body;

    const baseName = (downloadName || 'spritesheet').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = spriteFormat.toLowerCase() === 'webp' ? 'webp' : 'png';
    const spriteFilename = `${baseName}.${ext}`;
    const audioFilename = `${baseName}.mp3`;

    if (req.file) {
      videoPath = req.file.path;
      shouldDeleteVideo = true;
    } else if (videoFilename) {
      videoPath = path.join(uploadsDir, path.basename(videoFilename));
    }

    // Prepare archive
    const archive = archiver('zip', { zlib: { level: 6 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}_bundle.zip"`);

    archive.pipe(res);

    // 1. Add Sprite Sheet image to zip
    if (spriteDataUrl) {
      const base64Data = spriteDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      archive.append(imageBuffer, { name: spriteFilename });
    }

    // 2. Extract and add MP3 if video is available
    if (videoPath && fs.existsSync(videoPath)) {
      const tempAudioFile = path.join(tempDir, `bundle-audio-${Date.now()}.mp3`);
      const sTime = parseFloat(startTime) || 0;
      const eTime = parseFloat(endTime) || 0;

      const ffmpegArgs = [];
      if (sTime > 0) ffmpegArgs.push('-ss', sTime.toString());
      ffmpegArgs.push('-i', videoPath);
      if (eTime > sTime && eTime > 0) {
        ffmpegArgs.push('-t', (eTime - sTime).toString());
      }
      ffmpegArgs.push('-vn', '-acodec', 'libmp3lame', '-q:a', '2', '-y', tempAudioFile);

      await new Promise((resolve) => {
        const proc = spawn('ffmpeg', ffmpegArgs);
        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(tempAudioFile)) {
            const stat = fs.statSync(tempAudioFile);
            if (stat.size > 0) {
              archive.file(tempAudioFile, { name: audioFilename });
            }
          }
          resolve();
        });
        proc.on('error', () => resolve());
      });

      // Cleanup temp audio file after archive finishes
      archive.on('end', () => {
        if (fs.existsSync(tempAudioFile)) {
          try { fs.unlinkSync(tempAudioFile); } catch (_) {}
        }
        if (shouldDeleteVideo && videoPath && fs.existsSync(videoPath)) {
          try { fs.unlinkSync(videoPath); } catch (_) {}
        }
      });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Export bundle error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
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
