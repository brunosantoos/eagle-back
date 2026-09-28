import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { uploadsDir } from './storage';
import { isS3Ready, loadStorageSettings } from './storageSettings';

/**
 * Compressão do acervo que já está em `uploads/`.
 *
 * A compressão automática (`lib/imageOptimize.ts`) só vale para upload novo; o
 * que foi enviado antes continua do tamanho original. Esta rotina reprocessa o
 * que está no disco e é usada em dois lugares: o botão em Admin > Mídias e o
 * script `scripts/optimizeExistingUploads.ts`.
 *
 * Diferença importante para o pipeline de upload: aqui **nome e extensão são
 * preservados** (PNG continua PNG). O `SiteContent` guarda o caminho do
 * arquivo, então trocar a extensão quebraria as referências do site — a
 * economia vem do redimensionamento e da recompressão.
 */

/**
 * Maior lado permitido. Alto de propósito: o objetivo é derrubar o arquivo fora
 * de escala, não reencodar foto que o site já usa bem.
 */
const MAX_DIMENSION = 4500;

/** Qualidade da recompressão. Alta — a queixa do cliente foi perda visível. */
const QUALITY = 92;

/**
 * Abaixo disso o arquivo nem entra na lista.
 *
 * Era 60 KB, e por isso a rotina pegava **todas** as imagens do acervo, incluindo
 * as que já estavam no tamanho certo, e reencodava cada uma em q82 — foi o que
 * transformou 436 MB em 13 MB numa passada só. Com 1,5 MB a lista fica com o que
 * de fato pesa no carregamento do site.
 */
const MIN_BYTES = 1_500 * 1024;

/**
 * Ganho mínimo para valer a reescrita.
 *
 * Era 5%: qualquer arquivo "melhorava" 5% e era reescrito, trocando qualidade
 * por quase nada. Com 30% só sobra o caso em que a troca compensa de verdade.
 */
const MIN_SAVING_RATIO = 0.30;

const EXT_BY_FORMAT: Record<string, string[]> = {
  jpeg: ['.jpg', '.jpeg'],
  png: ['.png'],
  webp: ['.webp'],
};

export type OptimizableFile = {
  name: string;
  /** Tamanho atual em bytes. */
  before: number;
  /** Tamanho estimado (ou final, quando aplicado) em bytes. */
  after: number;
  /** Dimensões originais, quando a imagem precisa ser reduzida. */
  resizedFrom: string | null;
};

export type OptimizeUploadsReport = {
  /** true = os arquivos foram reescritos; false = simulação. */
  applied: boolean;
  files: OptimizableFile[];
  totalBefore: number;
  totalAfter: number;
  /** Arquivos que falharam no processamento (mantidos como estavam). */
  failed: string[];
  /**
   * true quando o destino das mídias é um bucket S3/Spaces: os arquivos não
   * estão no disco da API e esta rotina não os alcança.
   */
  remoteStorage: boolean;
};

function formatFor(ext: string): 'jpeg' | 'png' | 'webp' | null {
  const lower = ext.toLowerCase();
  for (const [format, exts] of Object.entries(EXT_BY_FORMAT)) {
    if (exts.includes(lower)) return format as 'jpeg' | 'png' | 'webp';
  }
  return null;
}

/**
 * Percorre `uploads/` comprimindo o que dá.
 *
 * Com `apply: false` nada é escrito — devolve o mesmo relatório, com os
 * tamanhos que o resultado teria. É o que sustenta o "analisar antes" do painel.
 *
 * Com `only`, só os arquivos daquela lista são olhados — é o que permite
 * comprimir uma imagem escolhida na análise sem tocar nas outras.
 */
export async function optimizeUploadsFolder({
  apply,
  only,
}: {
  apply: boolean;
  /**
   * Nomes de arquivo a processar. Ausente (ou vazio) = o acervo inteiro.
   *
   * Existe para o painel comprimir uma imagem de cada vez: a operação não tem
   * desfazer, então quem está no Admin escolhe na lista da análise em vez de
   * reescrever tudo numa tacada.
   *
   * A filtragem é feita **sobre o resultado do `readdir`**, não montando um
   * caminho a partir do que veio de fora — nome com `../` simplesmente não
   * casa com nenhuma entrada e é ignorado.
   */
  only?: string[];
}): Promise<OptimizeUploadsReport> {
  const settings = await loadStorageSettings().catch(() => null);
  const report: OptimizeUploadsReport = {
    applied: apply,
    files: [],
    totalBefore: 0,
    totalAfter: 0,
    failed: [],
    remoteStorage: settings ? isS3Ready(settings) : false,
  };

  if (!fs.existsSync(uploadsDir)) return report;

  const names = await fs.promises.readdir(uploadsDir);
  const wanted = only?.length ? new Set(only.map((n) => path.basename(n))) : null;

  for (const name of names) {
    if (wanted && !wanted.has(name)) continue;

    const file = path.join(uploadsDir, name);
    const stat = await fs.promises.stat(file).catch(() => null);
    // Arquivo pequeno passa direto: só entra na lista o que pesa, ou o que está
    // fora de escala (conferido abaixo, depois de ler as dimensões).
    if (!stat?.isFile()) continue;

    const format = formatFor(path.extname(name));
    if (!format) continue;

    try {
      const pipeline = sharp(file, {
        // PNG de 20000px estoura o limite padrão de pixels do sharp.
        limitInputPixels: 1_000_000_000,
        failOn: 'none',
      }).rotate();

      const meta = await pipeline.metadata();
      const needsResize =
        (meta.width ?? 0) > MAX_DIMENSION || (meta.height ?? 0) > MAX_DIMENSION;

      if (stat.size < MIN_BYTES && !needsResize) continue;

      const resized = pipeline.resize({
        width: needsResize ? MAX_DIMENSION : undefined,
        height: needsResize ? MAX_DIMENSION : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      });

      const buffer =
        format === 'png'
          ? await resized
              // Sem `palette`: ele reduz a imagem a 256 cores. Em ícone e
              // desenho é invisível, em foto é degradê virando faixa — e o
              // acervo aqui é foto.
              .png({ compressionLevel: 9, effort: 10 })
              .toBuffer()
          : format === 'jpeg'
            ? await resized.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer()
            : await resized.webp({ quality: QUALITY, effort: 4 }).toBuffer();

      // Ganho pequeno não compensa reescrever (e perder qualidade à toa).
      if (buffer.length >= stat.size * (1 - MIN_SAVING_RATIO)) continue;

      if (apply) await fs.promises.writeFile(file, buffer);

      report.files.push({
        name,
        before: stat.size,
        after: buffer.length,
        resizedFrom: needsResize ? `${meta.width}x${meta.height}` : null,
      });
      report.totalBefore += stat.size;
      report.totalAfter += buffer.length;
    } catch (err) {
      console.error(`[uploads] falha ao comprimir ${name}, mantido:`, err);
      report.failed.push(name);
    }
  }

  if (apply && report.files.length) {
    console.log(
      `[uploads] ${report.files.length} arquivo(s) comprimidos: ` +
        `${(report.totalBefore / 1024 / 1024).toFixed(2)} MB -> ` +
        `${(report.totalAfter / 1024 / 1024).toFixed(2)} MB`,
    );
  }

  return report;
}
