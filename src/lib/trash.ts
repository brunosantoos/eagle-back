import { prisma } from '../db';

/**
 * Lixeira de leads e contatos.
 *
 * Excluir no painel só carimba `deletedAt` — a mensagem sai das listas mas
 * continua no banco, e dá para restaurar. O que passa da retenção é apagado de
 * verdade.
 *
 * O expurgo roda quando alguém abre o painel (nas queries de listagem), não em
 * cron: é um `deleteMany` indexado por `deletedAt`, e a aplicação não tem
 * agendador. O `THROTTLE_MS` evita repetir a varredura a cada request.
 */

/** Quanto tempo um registro fica recuperável na lixeira. */
export const TRASH_RETENTION_DAYS = 30;

const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Intervalo mínimo entre duas varreduras. */
const THROTTLE_MS = 60 * 60 * 1000;

let lastRun = 0;

/**
 * Apaga em definitivo o que passou da retenção.
 *
 * Nunca lança: é chamado em background a partir das listagens, e falhar aqui
 * não pode derrubar a tela de leads.
 */
export async function purgeExpiredTrash(): Promise<void> {
  const now = Date.now();
  if (now - lastRun < THROTTLE_MS) return;
  lastRun = now;

  const cutoff = new Date(now - RETENTION_MS);

  try {
    const [leads, contacts] = await Promise.all([
      prisma.franchiseLead.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
      prisma.contactSubmission.deleteMany({
        where: { deletedAt: { lt: cutoff } },
      }),
    ]);

    if (leads.count || contacts.count) {
      console.log(
        `[lixeira] expurgo: ${leads.count} lead(s) e ${contacts.count} contato(s) ` +
          `com mais de ${TRASH_RETENTION_DAYS} dias na lixeira.`,
      );
    }
  } catch (err) {
    console.error('[lixeira] falha no expurgo automático:', err);
  }
}
