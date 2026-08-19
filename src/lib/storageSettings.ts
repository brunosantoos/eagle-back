import { prisma } from '../db';

/**
 * Onde os uploads são guardados — configurado pelo admin no painel.
 *
 * Mesmo esquema do e-mail: fica na tabela `SiteContent` sob a chave
 * `storageSettings` (separada da `main`, que é pública), sem migration nova.
 * Variáveis de ambiente servem de fallback.
 *
 * `provider: 'local'` (padrão) grava em disco e serve por `/uploads`.
 * `provider: 's3'` envia para qualquer serviço compatível com S3 — o caso aqui
 * é o DigitalOcean Spaces.
 */

export const STORAGE_SETTINGS_KEY = 'storageSettings';

export type StorageProvider = 'local' | 's3';

export type StorageSettings = {
  provider: StorageProvider;
  /** Ex.: https://nyc3.digitaloceanspaces.com */
  endpoint: string;
  /** Ex.: nyc3 (Spaces ignora, mas o SDK exige algum valor). */
  region: string;
  bucket: string;
  accessKeyId: string;
  /** Segredo: nunca sai do backend em texto puro. */
  secretAccessKey: string;
  /**
   * Base pública dos arquivos (CDN do Spaces, por exemplo). Vazio = monta a
   * URL a partir do endpoint + bucket.
   */
  publicBaseUrl: string;
  /** Pasta dentro do bucket, ex.: `eagle`. Vazio = raiz. */
  folder: string;
  /** true para serviços que exigem caminho `endpoint/bucket/chave`. */
  forcePathStyle: boolean;
};

export type PublicStorageSettings = Omit<StorageSettings, 'secretAccessKey'> & {
  hasSecret: boolean;
  secretPreview: string;
  /** De onde veio o segredo em uso. */
  secretSource: 'panel' | 'env' | 'none';
  /** true quando o provider é s3 e todos os campos obrigatórios estão preenchidos. */
  configured: boolean;
};

function envDefaults(): StorageSettings {
  const secret = process.env.S3_SECRET_ACCESS_KEY?.trim() ?? '';
  const bucket = process.env.S3_BUCKET?.trim() ?? '';
  const endpoint = process.env.S3_ENDPOINT?.trim() ?? '';
  const key = process.env.S3_ACCESS_KEY_ID?.trim() ?? '';
  return {
    // Só cai em s3 por env se a env trouxer o conjunto mínimo.
    provider: secret && bucket && endpoint && key ? 's3' : 'local',
    endpoint,
    region: process.env.S3_REGION?.trim() || 'us-east-1',
    bucket,
    accessKeyId: key,
    secretAccessKey: secret,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL?.trim() ?? '',
    folder: process.env.S3_FOLDER?.trim() ?? '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  };
}

function normalize(stored: unknown, fallback: StorageSettings): StorageSettings {
  if (typeof stored !== 'object' || stored === null) return fallback;
  const value = stored as Partial<Record<keyof StorageSettings, unknown>>;
  const str = (key: keyof StorageSettings, def: string) =>
    typeof value[key] === 'string' ? (value[key] as string).trim() : def;

  return {
    provider: value.provider === 's3' ? 's3' : 'local',
    endpoint: str('endpoint', fallback.endpoint).replace(/\/+$/, ''),
    region: str('region', fallback.region) || 'us-east-1',
    bucket: str('bucket', fallback.bucket),
    accessKeyId: str('accessKeyId', fallback.accessKeyId),
    secretAccessKey: str('secretAccessKey', fallback.secretAccessKey),
    publicBaseUrl: str('publicBaseUrl', fallback.publicBaseUrl).replace(/\/+$/, ''),
    folder: str('folder', fallback.folder).replace(/^\/+|\/+$/g, ''),
    forcePathStyle:
      typeof value.forcePathStyle === 'boolean'
        ? value.forcePathStyle
        : fallback.forcePathStyle,
  };
}

/** true quando dá para enviar de fato para o S3. */
export function isS3Ready(settings: StorageSettings): boolean {
  return (
    settings.provider === 's3' &&
    Boolean(
      settings.endpoint &&
        settings.bucket &&
        settings.accessKeyId &&
        settings.secretAccessKey,
    )
  );
}

let cache: { value: StorageSettings; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateStorageSettings(): void {
  cache = null;
}

export async function loadStorageSettings(): Promise<StorageSettings> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const fallback = envDefaults();
  let value = fallback;
  try {
    const record = await prisma.siteContent.findUnique({
      where: { key: STORAGE_SETTINGS_KEY },
    });
    if (record) value = normalize(JSON.parse(record.data), fallback);
  } catch (err) {
    console.error('[storage] falha ao ler configuração do banco:', err);
  }

  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function saveStorageSettings(next: StorageSettings): Promise<void> {
  const data = JSON.stringify(next);
  await prisma.siteContent.upsert({
    where: { key: STORAGE_SETTINGS_KEY },
    update: { data },
    create: { key: STORAGE_SETTINGS_KEY, data },
  });
  invalidateStorageSettings();
}

export function toPublicStorageSettings(
  settings: StorageSettings,
): PublicStorageSettings {
  const envSecret = process.env.S3_SECRET_ACCESS_KEY?.trim() ?? '';
  const { secretAccessKey, ...rest } = settings;
  return {
    ...rest,
    hasSecret: Boolean(secretAccessKey),
    secretPreview: secretAccessKey ? `••••${secretAccessKey.slice(-4)}` : '',
    secretSource: !secretAccessKey
      ? 'none'
      : secretAccessKey === envSecret
        ? 'env'
        : 'panel',
    configured: isS3Ready(settings),
  };
}

/** URL pública de uma chave já enviada ao bucket. */
export function publicUrlFor(settings: StorageSettings, key: string): string {
  if (settings.publicBaseUrl) return `${settings.publicBaseUrl}/${key}`;

  const endpoint = settings.endpoint.replace(/\/+$/, '');
  if (settings.forcePathStyle) return `${endpoint}/${settings.bucket}/${key}`;

  // Estilo virtual-host: bucket vira subdomínio (padrão no Spaces e na AWS).
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${settings.bucket}.${url.host}/${key}`;
  } catch {
    return `${endpoint}/${settings.bucket}/${key}`;
  }
}
