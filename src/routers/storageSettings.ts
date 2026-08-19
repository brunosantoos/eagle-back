import { z } from 'zod';
import { router, adminProcedure } from '../trpc';
import {
  loadStorageSettings,
  saveStorageSettings,
  toPublicStorageSettings,
  type StorageSettings,
} from '../lib/storageSettings';
import { invalidateStorageClient, testS3Connection } from '../lib/storage';

/**
 * Configuração de armazenamento de mídia — só admin.
 * O segredo nunca sai daqui em texto puro (só existência + 4 últimos dígitos).
 */

const settingsInput = z.object({
  provider: z.enum(['local', 's3']),
  endpoint: z.string().trim().max(300),
  region: z.string().trim().max(60),
  bucket: z.string().trim().max(120),
  accessKeyId: z.string().trim().max(200),
  publicBaseUrl: z.string().trim().max(300),
  folder: z.string().trim().max(120),
  forcePathStyle: z.boolean(),
  /** Só quando o admin digita um segredo novo; ausente = mantém o atual. */
  secretAccessKey: z.string().trim().min(1).optional(),
  clearSecret: z.boolean().optional(),
});

/** Junta o input com o que já está salvo (o segredo pode não vir no payload). */
async function merge(
  input: z.infer<typeof settingsInput>,
): Promise<StorageSettings> {
  const current = await loadStorageSettings();
  const secretAccessKey = input.clearSecret
    ? ''
    : input.secretAccessKey ?? current.secretAccessKey;

  return {
    provider: input.provider,
    endpoint: input.endpoint.replace(/\/+$/, ''),
    region: input.region || 'us-east-1',
    bucket: input.bucket,
    accessKeyId: input.accessKeyId,
    secretAccessKey,
    publicBaseUrl: input.publicBaseUrl.replace(/\/+$/, ''),
    folder: input.folder.replace(/^\/+|\/+$/g, ''),
    forcePathStyle: input.forcePathStyle,
  };
}

export const storageSettingsRouter = router({
  get: adminProcedure.query(async () => {
    return toPublicStorageSettings(await loadStorageSettings());
  }),

  update: adminProcedure
    .input(settingsInput)
    .mutation(async ({ input }) => {
      const next = await merge(input);
      await saveStorageSettings(next);
      invalidateStorageClient();
      return toPublicStorageSettings(next);
    }),

  /**
   * Testa com os dados do formulário (sem precisar salvar antes), reaproveitando
   * o segredo já gravado quando o campo vem vazio.
   */
  testConnection: adminProcedure
    .input(settingsInput)
    .mutation(async ({ input }) => {
      const candidate = await merge(input);
      const result = await testS3Connection(candidate);
      return {
        ok: result.ok,
        message: result.message,
        url: result.url ?? '',
      };
    }),
});
