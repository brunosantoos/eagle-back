import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

/**
 * Compressão automática das imagens enviadas pelo painel.
 *
 * O acervo do site tinha PNG de 9 MB (16000x20000px) porque o admin envia o
 * arquivo direto da câmera/designer. Aqui o arquivo é reduzido para o que o
 * site realmente usa: no máximo `MAX_DIMENSION` px no maior lado, convertido
 * para WebP (ou AVIF quando compensa), sem metadados EXIF.
 *
 * Regras de segurança:
 * - Vídeo, GIF e SVG passam intactos (sharp não deve mexer neles).
 * - Se o resultado ficar maior que o original, o original é mantido.
 * - Qualquer erro do sharp devolve o arquivo original — upload nunca quebra.
 * - O arquivo de entrada **nunca** é apagado num caminho de erro. Quando a
 *   entrada já é `.webp`, o nome de saída é o mesmo da entrada, e apagar a
 *   "saída" no `catch` apagava o próprio upload (ver `sameFile` abaixo).
 */

/** Maior lado permitido. Hero em 4K ainda cabe; foto de 20000px não. */
const MAX_DIMENSION = 2560;

/** Qualidade do WebP. 82 é o ponto onde a perda deixa de ser perceptível. */
const WEBP_QUALITY = 82;

/** Abaixo disso não vale reprocessar (ícone, logo já otimizado). */
const MIN_BYTES_TO_PROCESS = 60 * 1024;

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

  // WebP pequeno já veio do editor de recorte do painel — não reprocessa.
  if (file.mimetype === 'image/webp' && file.size < MIN_BYTES_TO_PROCESS) {
    return keepOriginal();
  }

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

    // WebP que já chegou pronto do navegador e cabe no limite: recomprimir
    // seria q82 sobre q82 — perde qualidade sem ganhar tamanho.
    if (file.mimetype === 'image/webp' && !needsResize) return keepOriginal();

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
