import 'dotenv/config';
import { prisma } from '../db';
import { countMojibake, repairJsonText, repairText } from '../lib/mojibake';

/**
 * Repara mojibake (texto UTF-8 lido como Latin-1/CP1252) já gravado no banco.
 *
 * Sintoma: "musculação" aparece como "musculaÃ§Ã£o" no site. Isso acontece com
 * dados que passaram por uma conexão/cluster sem UTF-8 antes do fix de encoding.
 * O texto novo já entra correto; este script conserta o histórico.
 *
 * A lógica de reparo vive em `src/lib/mojibake.ts` — ela corrige sequência por
 * sequência e, no SiteContent, só grava se o JSON continuar válido.
 *
 * Uso:
 *   pnpm run db:fix-encoding             # dry-run (só relata)
 *   pnpm run db:fix-encoding -- --apply  # grava as correções
 */

const apply = process.argv.includes('--apply');

async function fixSiteContent() {
  const records = await prisma.siteContent.findMany();
  let fixed = 0;
  for (const record of records) {
    const found = countMojibake(record.data);
    if (found === 0) continue;

    const repaired = repairJsonText(record.data);
    if (!repaired) {
      console.warn(
        `SiteContent[${record.key}]: ${found} sequência(s) suspeita(s) — reparo ignorado ` +
          `(não seria JSON válido). Nada foi alterado.`,
      );
      continue;
    }

    fixed++;
    console.log(`SiteContent[${record.key}]: ${found} sequência(s) reparada(s)`);
    if (apply) {
      await prisma.siteContent.update({
        where: { id: record.id },
        data: { data: repaired },
      });
    }
  }
  return fixed;
}

async function fixFranchiseLeads() {
  const leads = await prisma.franchiseLead.findMany();
  let fixed = 0;
  for (const lead of leads) {
    const patch: Record<string, string> = {};
    for (const field of ['name', 'city', 'capital', 'notes'] as const) {
      const repaired = repairText(lead[field]);
      if (repaired) patch[field] = repaired;
    }
    if (Object.keys(patch).length === 0) continue;
    fixed++;
    console.log(`FranchiseLead[${lead.id}]: ${Object.keys(patch).join(', ')}`);
    if (apply) {
      await prisma.franchiseLead.update({ where: { id: lead.id }, data: patch });
    }
  }
  return fixed;
}

async function fixContactSubmissions() {
  const contacts = await prisma.contactSubmission.findMany();
  let fixed = 0;
  for (const contact of contacts) {
    const patch: Record<string, string> = {};
    for (const field of ['name', 'message', 'notes'] as const) {
      const repaired = repairText(contact[field]);
      if (repaired) patch[field] = repaired;
    }
    if (Object.keys(patch).length === 0) continue;
    fixed++;
    console.log(`ContactSubmission[${contact.id}]: ${Object.keys(patch).join(', ')}`);
    if (apply) {
      await prisma.contactSubmission.update({ where: { id: contact.id }, data: patch });
    }
  }
  return fixed;
}

async function main() {
  console.log(apply ? '== Reparando encoding (gravando) ==' : '== Reparando encoding (dry-run) ==');
  const total =
    (await fixSiteContent()) +
    (await fixFranchiseLeads()) +
    (await fixContactSubmissions());

  if (total === 0) {
    console.log('Nada a corrigir — nenhum mojibake encontrado.');
  } else if (apply) {
    console.log(`${total} registro(s) corrigido(s).`);
  } else {
    console.log(`${total} registro(s) precisam de correção. Rode com --apply para gravar.`);
  }
  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
