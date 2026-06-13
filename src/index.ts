import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { toNodeHandler } from 'better-auth/node';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router';
import { createContext } from './trpc';
import { auth } from './auth';

const app = express();

const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
app.use(cors({ origin: corsOrigin, credentials: true }));

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// Static file serving
app.use('/uploads', express.static(uploadsDir));

// better-auth handler (before body parser)
// @ts-ignore — Express wildcard type and better-auth handler are compatible at runtime
app.all('/api/auth/*', toNodeHandler(auth));

// Body parser — siteContent.update envia o JSON inteiro do site (rich text + URLs);
// o default de 100kb derruba o save silenciosamente quando o conteúdo cresce.
app.use(express.json({ limit: '10mb' }));

// Upload endpoint
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file received' });
      return;
    }
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// tRPC
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Eagle backend running on http://localhost:${port}`);
});
