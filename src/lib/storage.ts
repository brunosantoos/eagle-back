import fs from 'fs';
import path from 'path';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  isS3Ready,
  loadStorageSettings,
  publicUrlFor,
  type StorageSettings,
} from './storageSettings';

/**
 * Destino dos uploads: disco local (padrão) ou bucket compatível com S3
 * (DigitalOcean Spaces). A escolha vem das configurações do painel.
 *
 * Sem S3 configurado, tudo continua indo para `uploads/` e sendo servido em
 * `/uploads` — o comportamento que o site já tinha.
 */

export const uploadsDir = path.join(process.cwd(), 'uploads');

export function ensureUploadsDir(): void {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

/** Cliente é recriado quando a configuração muda (chave/endpoint/região). */
let clientCache: { key: string; client: S3Client } | null = null;

function clientFor(settings: StorageSettings): S3Client {
  const cacheKey = [
    settings.endpoint,
    settings.region,
    settings.accessKeyId,
    settings.secretAccessKey,
    String(settings.forcePathStyle),
  ].join('|');

  if (clientCache?.key === cacheKey) return clientCache.client;

  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region || 'us-east-1',
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });

  clientCache = { key: cacheKey, client };
  return client;
}

export function invalidateStorageClient(): void {
  clientCache = null;
}

/** Nome único, mantendo a extensão original. */
export function buildObjectName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}

function objectKey(settings: StorageSettings, name: string): string {
  return settings.folder ? `${settings.folder}/${name}` : name;
}

export type StoredUpload = {
  /** URL para gravar no conteúdo: relativa no local, absoluta no S3. */
  url: string;
  provider: 'local' | 's3';
};

/**
 * Envia um arquivo já gravado em disco pelo multer.
 *
 * No modo S3 o arquivo local é temporário: sobe por stream (sem carregar na
 * memória, importante para vídeo) e é apagado depois. Se o envio falhar, o
 * arquivo local é mantido e servido por `/uploads` — o upload do admin não
 * quebra por indisponibilidade do bucket.
 */
export async function storeUploadedFile(file: {
  path: string;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}): Promise<StoredUpload> {
  const settings = await loadStorageSettings();

  if (!isS3Ready(settings)) {
    return { url: `/uploads/${file.filename}`, provider: 'local' };
  }

  const key = objectKey(settings, file.filename);

  try {
    await clientFor(settings).send(
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        Body: fs.createReadStream(file.path),
        ContentLength: file.size,
        ContentType: file.mimetype || 'application/octet-stream',
        // Mídia do site é pública; sem isso o Spaces devolve 403 no <img>.
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  } catch (err) {
    console.error(
      '[storage] falha ao enviar para o S3, mantendo o arquivo local:',
      err,
    );
    return { url: `/uploads/${file.filename}`, provider: 'local' };
  }

  // Já está no bucket: o arquivo local vira lixo.
  fs.promises.unlink(file.path).catch(() => {
    /* melhor esforço */
  });

  return { url: publicUrlFor(settings, key), provider: 's3' };
}

/**
 * Grava e apaga um objeto pequeno só para validar credenciais/permissão.
 * Devolve mensagem pronta para exibir no painel.
 */
export async function testS3Connection(
  settings: StorageSettings,
): Promise<{ ok: boolean; message: string; url?: string }> {
  if (!isS3Ready(settings)) {
    return {
      ok: false,
      message:
        'Preencha endpoint, bucket, chave e segredo antes de testar a conexão.',
    };
  }

  const key = objectKey(settings, `.eagle-teste-${Date.now()}.txt`);
  const client = clientFor(settings);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        Body: 'eagle storage test',
        ContentType: 'text/plain',
        ACL: 'public-read',
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Falha ao gravar no bucket: ${message}`,
    };
  }

  const url = publicUrlFor(settings, key);

  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }),
    );
  } catch {
    return {
      ok: true,
      message: `Envio funcionou, mas não foi possível apagar o arquivo de teste (${key}). Confira a permissão de exclusão.`,
      url,
    };
  }

  return {
    ok: true,
    message: 'Conexão OK: arquivo de teste enviado e removido do bucket.',
    url,
  };
}
