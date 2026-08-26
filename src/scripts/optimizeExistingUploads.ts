/**
 * Comprime as imagens que já estão em `uploads/`, pela linha de comando.
 *
 * A lógica vive em `lib/optimizeUploads.ts` e é a mesma do botão em
 * Admin > Mídias — este script é só o acesso por terminal, útil quando o painel
 * não está à mão (deploy, VPS, manutenção).
 *
 *   pnpm exec tsx src/scripts/optimizeExistingUploads.ts          # dry-run
 *   pnpm exec tsx src/scripts/optimizeExistingUploads.ts --apply  # grava
 *
 * Só mexe em arquivo local. No modo S3 os objetos ficam no bucket e não são
 * alcançados por aqui.
 */

import { optimizeUploadsFolder } from '../lib/optimizeUploads';

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const report = await optimizeUploadsFolder({ apply });

  if (report.remoteStorage) {
    console.log(
      '[uploads] atenção: o destino das mídias é um bucket S3/Spaces. ' +
        'Só os arquivos que sobraram no disco local são processados.',
    );
  }

  for (const file of report.files) {
    console.log(
      `${file.name}: ${mb(file.before)} -> ${mb(file.after)}` +
        (file.resizedFrom ? ` (de ${file.resizedFrom})` : ''),
    );
  }

  for (const name of report.failed) {
    console.log(`${name}: falhou, mantido como está`);
  }

  console.log(
    `\n${report.files.length} arquivo(s): ${mb(report.totalBefore)} -> ${mb(
      report.totalAfter,
    )}` + (apply ? ' (gravado)' : ' — dry-run, rode com --apply para gravar'),
  );
}

void main();
