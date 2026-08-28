import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

/**
 * Rede de segurança das imagens enviadas pelo painel.
 *
 * **A imagem não é mais reprocessada por padrão.** Antes toda foto era reduzida
 * para 2560px e reencodada em WebP q82 aqui — e o navegador já tinha feito o
 * mesmo antes de subir. Duas perdas empilhadas em cima de um arquivo que já saía
 * comprimido da câmera, e a queda de qualidade era visível no site.
 *
 * Comprimir virou um ato explícito: o botão "Comprimir imagens já enviadas"
 * (Admin > Mídias, `lib/optimizeUploads.ts`). Aqui só sobra o caso extremo —
 * o PNG de 9 MB em 16000x20000px que o designer manda sem pensar, e que
 * derrubaria o carregamento do site.
 *
 * Regras de segurança:
 * - Vídeo, GIF e SVG passam intactos (sharp não deve mexer neles).
 * - Arquivo dentro dos limites passa **byte a byte**, sem reencode.
 * - Se o resultado ficar maior que o original, o original é mantido.
 * - Qualquer erro do sharp devolve o arquivo original — upload nunca quebra.
 * - O arquivo de entrada **nunca** é apagado num caminho de erro. Quando a
 *   entrada já é `.webp`, o nome de saída é o mesmo da entrada, e apagar a
 *   "saída" no `catch` apagava o próprio upload (ver `sameFile` abaixo).
 */

/**
 * Maior lado tolerado sem reprocessar. Alto de propósito: é mais que o dobro do
 * maior hero do site, então quem manda foto de câmera passa intacto e só o
 * arquivo realmente absurdo é reduzido.
 */
const MAX_DIMENSION = 4500;

/** Qualidade do WebP quando a rede de segurança precisa reencodar. */
const WEBP_QUALITY = 95;

/**
 * A partir deste tamanho o arquivo é reprocessado mesmo cabendo em
 * `MAX_DIMENSION` — acima disso o custo de banda no site supera a perda.
 */
const MAX_BYTES_TO_KEEP = 15 * 1024 * 1024;

/** Formatos que o sharp reprocessa com segurança. */
const OPTIMIZABLE = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif',
]);

export type OptimizedFile = {
  path: string;
  filename: string;
  mimetype: string;
  size: number;
  /** true quando o arquivo foi realmente reprocessado. */
  optimized: boolean;
  /** Tamanho antes da compressão, para log/telemetria. */
  originalSize: number;
};

export function isOptimizableImage(mimetype: string): boolean {
  return OPTIMIZABLE.has(mimetype.toLowerCase());
}

function webpNameFor(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return `${base}.webp`;
}

/**
 * Reprocessa o arquivo gravado em disco pelo multer.
 *
 * Devolve sempre um descritor válido: no pior caso, o do arquivo original.
 * O arquivo antigo só é apagado depois que o novo está gravado.
 *
 * A gravação é `toBuffer()` + `writeFile` (e não `toFile`) de propósito: o
 * painel comprime a imagem no navegador antes de subir, então a entrada
 * costuma ser `.webp` e o `toFile` no mesmo caminho falha com
 * "Cannot use same file for input and output". Mesma abordagem do
 * `lib/optimizeUploads.ts`.
 */
export async function optimizeUploadedImage(file: {
  path: string;
  filename: string;
  mimetype: string;
  size: number;
}): Promise<OptimizedFile> {
  const keepOriginal = (): OptimizedFile => ({
    path: file.path,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    optimized: false,
    originalSize: file.size,
  });

  if (!isOptimizableImage(file.mimetype)) return keepOriginal();

  const dir = path.dirname(file.path);
  const outName = webpNameFor(file.filename);
  const outPath = path.join(dir, outName);
  /** Entrada `.webp`: o nome de saída é o mesmo da entrada. */
  const sameFile = path.resolve(outPath) === path.resolve(file.path);

  try {
    const pipeline = sharp(file.path, {
      // PNG gigante (20000px) estoura o limite padrão de pixels do sharp.
      limitInputPixels: 1_000_000_000,
      failOn: 'none',
    }).rotate(); // aplica orientação EXIF antes de descartar os metadados

    const meta = await pipeline.metadata();
    const needsResize =
      (meta.width ?? 0) > MAX_DIMENSION || (meta.height ?? 0) > MAX_DIMENSION;
    const tooHeavy = file.size > MAX_BYTES_TO_KEEP;

    // O caminho normal para aqui: a imagem do cliente vai para o site como ela
    // é. Só arquivo fora de escala segue para o reencode.
    if (!needsResize && !tooHeavy) return keepOriginal();

    const buffer = await pipeline
      .resize({
        width: needsResize ? MAX_DIMENSION : undefined,
        height: needsResize ? MAX_DIMENSION : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer();

    // Comprimir e ficar maior acontece com PNG pequeno de poucas cores.
    if (buffer.length >= file.size && !needsResize) return keepOriginal();

    await fs.promises.writeFile(outPath, buffer);
    if (!sameFile) await fs.promises.unlink(file.path).catch(() => {});

    console.log(
      `[upload] ${file.filename} ${(file.size / 1024 / 1024).toFixed(2)} MB -> ` +
        `${outName} ${(buffer.length / 1024 / 1024).toFixed(2)} MB` +
        (needsResize ? ` (redimensionado de ${meta.width}x${meta.height})` : ''),
    );

    return {
      path: outPath,
      filename: outName,
      mimetype: 'image/webp',
      size: buffer.length,
      optimized: true,
      originalSize: file.size,
    };
  } catch (err) {
    console.error('[upload] falha ao comprimir a imagem, mantendo original:', err);
    // `sameFile`: apagar aqui apagaria o arquivo que acabou de subir.
    if (!sameFile) await fs.promises.unlink(outPath).catch(() => {});
    return keepOriginal();
  }
}
