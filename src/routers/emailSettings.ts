import { z } from 'zod';
import { router, adminProcedure } from '../trpc';
import {
  loadEmailSettings,
  saveEmailSettings,
  toPublicSettings,
  type EmailSettings,
} from '../lib/emailSettings';
import { sendEmail } from '../lib/email';

/**
 * Configuração de e-mail — só admin. A chave da API nunca sai daqui em texto
 * puro: `get` devolve apenas se existe e os 4 últimos caracteres.
 */

const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === '' || z.string().email().safeParse(v).success, {
    message: 'E-mail inválido',
  });

export const emailSettingsRouter = router({
  get: adminProcedure.query(async () => {
    return toPublicSettings(await loadEmailSettings());
  }),

  update: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        fromName: z.string().trim().max(120),
        fromEmail: optionalEmail,
        teamEmail: optionalEmail,
        replyTo: optionalEmail,
        siteUrl: z.string().trim().max(300),
        /** Só quando o admin digita uma chave nova; ausente = mantém a atual. */
        apiKey: z.string().trim().min(1).optional(),
        /** Remove a chave cadastrada. */
        clearApiKey: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const current = await loadEmailSettings();

      const apiKey = input.clearApiKey ? '' : input.apiKey ?? current.apiKey;

      const next: EmailSettings = {
        enabled: input.enabled && Boolean(apiKey),
        apiKey,
        fromName: input.fromName,
        fromEmail: input.fromEmail,
        teamEmail: input.teamEmail || current.teamEmail,
        replyTo: input.replyTo,
        siteUrl: input.siteUrl,
      };

      await saveEmailSettings(next);
      return toPublicSettings(next);
    }),

  /** Envia um e-mail de teste com a configuração salva e devolve o erro cru. */
  sendTest: adminProcedure
    .input(z.object({ to: z.string().trim().email() }))
    .mutation(async ({ input }) => {
      const settings = await loadEmailSettings();

      if (!settings.enabled || !settings.apiKey) {
        return {
          ok: false,
          message:
            'Envio desligado ou sem chave cadastrada. Salve a configuração antes de testar.',
        };
      }

      const result = await sendEmail(
        {
          to: input.to,
          subject: 'Teste de configuração — Eagle Center Fitness',
          html:
            '<p>Se você recebeu este e-mail, a configuração de envio do site está funcionando.</p>',
          text:
            'Se você recebeu este e-mail, a configuração de envio do site está funcionando.',
        },
        settings,
      );

      if (result.ok) {
        return { ok: true, message: `E-mail de teste enviado para ${input.to}.` };
      }
      if (result.skipped) {
        return { ok: false, message: 'Envio ignorado: configuração incompleta.' };
      }
      return {
        ok: false,
        message: `Falha no envio: ${result.error ?? 'erro desconhecido'}. Confira a chave e se o remetente está verificado no Resend.`,
      };
    }),
});
