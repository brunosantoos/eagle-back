import { prisma } from '../db';

/**
 * Configuração de e-mail transacional — cadastrada pelo admin no painel.
 *
 * Guardada na tabela `SiteContent` sob a chave `emailSettings` (JSON), separada
 * da chave `main` que guarda o conteúdo público do site. Isso evita migration
 * nova; a proteção real vem do router (`adminProcedure`) — `siteContent.get`,
 * que é público, lê só a chave `main` e nunca enxerga estes dados.
 *
 * As variáveis de ambiente continuam valendo como fallback (deploys antigos
 * seguem funcionando), mas o que estiver salvo no painel tem prioridade.
 */

export const EMAIL_SETTINGS_KEY = 'emailSettings';

const DEFAULT_TEAM_EMAIL = 'contato@grupogoldeagle.com.br';

export type EmailSettings = {
  /** Desligado = nenhum e-mail sai, mesmo com chave cadastrada. */
  enabled: boolean;
  /** Chave da API do Resend. Segredo: nunca sai do backend em texto puro. */
  apiKey: string;
  fromName: string;
  fromEmail: string;
  /** Destino das notificações internas. */
  teamEmail: string;
  /** Vazio = responde para o e-mail de quem enviou o formulário. */
  replyTo: string;
  /** Usado nos links dos templates. */
  siteUrl: string;
};

/** O que pode ser devolvido para o painel — sem a chave em texto puro. */
export type PublicEmailSettings = Omit<EmailSettings, 'apiKey'> & {
  hasApiKey: boolean;
  /** Últimos 4 caracteres, só para o admin reconhecer a chave cadastrada. */
  apiKeyPreview: string;
  /** De onde veio a chave em uso: painel, variável de ambiente ou nenhuma. */
  apiKeySource: 'panel' | 'env' | 'none';
};

function envDefaults(): EmailSettings {
  const from = process.env.EMAIL_FROM?.trim() ?? '';
  // Aceita "Nome <email@dominio>" ou só o e-mail.
  const match = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  return {
    enabled: Boolean(process.env.RESEND_API_KEY?.trim()),
    apiKey: process.env.RESEND_API_KEY?.trim() ?? '',
    fromName: match ? match[1] : 'Eagle Center Fitness',
    fromEmail: match ? match[2] : from,
    teamEmail: process.env.EMAIL_TEAM?.trim() || DEFAULT_TEAM_EMAIL,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() ?? '',
    siteUrl: process.env.SITE_URL?.trim() ?? '',
  };
}

function normalize(stored: unknown, fallback: EmailSettings): EmailSettings {
  if (typeof stored !== 'object' || stored === null) return fallback;
  const value = stored as Partial<Record<keyof EmailSettings, unknown>>;
  const str = (key: keyof EmailSettings, def: string) =>
    typeof value[key] === 'string' ? (value[key] as string).trim() : def;

  const apiKey = str('apiKey', fallback.apiKey);
  return {
    enabled:
      typeof value.enabled === 'boolean' ? value.enabled : Boolean(apiKey),
    apiKey,
    fromName: str('fromName', fallback.fromName),
    fromEmail: str('fromEmail', fallback.fromEmail),
    teamEmail: str('teamEmail', fallback.teamEmail) || DEFAULT_TEAM_EMAIL,
    replyTo: str('replyTo', fallback.replyTo),
    siteUrl: str('siteUrl', fallback.siteUrl),
  };
}

/**
 * Cache curto: cada envio de formulário dispara dois e-mails, e não vale bater
 * no banco toda vez. `invalidateEmailSettings()` zera na hora que o admin salva.
 */
let cache: { value: EmailSettings; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateEmailSettings(): void {
  cache = null;
}

export async function loadEmailSettings(): Promise<EmailSettings> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const fallback = envDefaults();
  let value = fallback;
  try {
    const record = await prisma.siteContent.findUnique({
      where: { key: EMAIL_SETTINGS_KEY },
    });
    if (record) value = normalize(JSON.parse(record.data), fallback);
  } catch (err) {
    console.error('[email] falha ao ler configuração do banco:', err);
  }

  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function saveEmailSettings(next: EmailSettings): Promise<void> {
  const data = JSON.stringify(next);
  await prisma.siteContent.upsert({
    where: { key: EMAIL_SETTINGS_KEY },
    update: { data },
    create: { key: EMAIL_SETTINGS_KEY, data },
  });
  invalidateEmailSettings();
}

/** Versão segura para mandar ao painel. */
export function toPublicSettings(settings: EmailSettings): PublicEmailSettings {
  const envKey = process.env.RESEND_API_KEY?.trim() ?? '';
  const { apiKey, ...rest } = settings;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    apiKeyPreview: apiKey ? `••••${apiKey.slice(-4)}` : '',
    apiKeySource: !apiKey ? 'none' : apiKey === envKey ? 'env' : 'panel',
  };
}

/** Remetente no formato aceito pelo Resend. */
export function formatFrom(settings: EmailSettings): string {
  const email = settings.fromEmail.trim();
  if (!email) return `Eagle Center Fitness <${settings.teamEmail}>`;
  const name = settings.fromName.trim();
  return name ? `${name} <${email}>` : email;
}
