import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { toNodeHandler } from 'better-auth/node';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router';
import { createContext } from './trpc';
import { auth } from './auth';
import {
  buildObjectName,
  ensureUploadsDir,
  storeUploadedFile,
  uploadsDir,
} from './lib/storage';

const app = express();

// Apache/nginx na frente em produção — sem isso req.ip vira o IP do proxy e o
// rate limit dos formulários públicos trataria todo mundo como o mesmo cliente.
// Confia em UM hop só (o proxy local): com `true`, req.ip passa a ser o valor
// que o cliente escrever em X-Forwarded-For e o rate limit vira decorativo.
// TRUST_PROXY_HOPS permite ajustar se entrar CDN na frente do Apache.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// CORS aberto: qualquer origem, com credenciais.
// `origin: true` reflete o Origin do request no Access-Control-Allow-Origin — é o
// que permite cookie de sessão em requisição cross-origin (o browser rejeita `*`
// junto de Allow-Credentials). Preflight (OPTIONS) é respondido para todas as
// rotas, incluindo /api/auth e /trpc.
// Sem restrição de origem, a proteção contra requisição de outro site fica só no
// SameSite=Lax do cookie de sessão.
app.use(cors({ origin: true, credentials: true }));

ensureUploadsDir();

// Sempre grava em disco primeiro: no modo S3 o arquivo é temporário e sobe por
// stream, o que evita segurar vídeo de 100 MB na memória do processo.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, buildObjectName(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// Static file serving — nome do arquivo é único por upload, então cache longo é seguro.
// `Access-Control-Allow-Origin: *` permite ler a imagem em <canvas> (editor de recorte
// do admin) sem "tainted canvas" quando front e back estão em domínios diferentes.
app.use(
  '/uploads',
  express.static(uploadsDir, {
    maxAge: '365d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // `*` + Allow-Credentials é combinação rejeitada pelo browser. Mídia é
      // pública, então o header de credenciais do cors() sai daqui.
      res.removeHeader('Access-Control-Allow-Credentials');
    },
  }),
);

// better-auth handler (before body parser)
// @ts-ignore — Express wildcard type and better-auth handler are compatible at runtime
app.all('/api/auth/*', toNodeHandler(auth));

// Body parser — siteContent.update envia o JSON inteiro do site (rich text + URLs);
// o default de 100kb derruba o save silenciosamente quando o conteúdo cresce.
app.use(express.json({ limit: '10mb' }));

// Charset explícito nas respostas do tRPC.
// `express.json`/`res.json` já mandam "; charset=utf-8", mas o adapter do tRPC
// escreve "application/json" puro — e é por ali que passa o conteúdo acentuado
// do site. (`res.charset` não serve: é API do Express 3, ignorada na v4.)
app.use('/trpc', (_req, res, next) => {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = function patchedSetHeader(name: string, value: never) {
    if (
      String(name).toLowerCase() === 'content-type' &&
      String(value).toLowerCase() === 'application/json'
    ) {
      return setHeader(name, 'application/json; charset=utf-8');
    }
    return setHeader(name, value);
  } as typeof res.setHeader;
  next();
});

// Upload endpoint — destino (disco ou S3/Spaces) vem das configurações do painel.
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    void (async () => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file received' });
        return;
      }

      try {
        const stored = await storeUploadedFile(req.file);
        res.json({ url: stored.url, provider: stored.provider });
      } catch (uploadError) {
        console.error('[upload] falha ao armazenar arquivo:', uploadError);
        res.status(500).json({ error: 'Falha ao armazenar o arquivo.' });
      }
    })();
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
  console.log('CORS: aberto para qualquer origem (com credenciais)');
});
