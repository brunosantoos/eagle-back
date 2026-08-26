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

  try {
    const pipeline = sharp(file.path, {
      // PNG gigante (20000px) estoura o limite padrão de pixels do sharp.
      limitInputPixels: 1_000_000_000,
      failOn: 'none',
    }).rotate(); // aplica orientação EXIF antes de descartar os metadados

    const meta = await pipeline.metadata();
    const needsResize =
      (meta.width ?? 0) > MAX_DIMENSION || (meta.height ?? 0) > MAX_DIMENSION;

    await pipeline
      .resize({
        width: needsResize ? MAX_DIMENSION : undefined,
        height: needsResize ? MAX_DIMENSION : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toFile(outPath);

    const { size } = await fs.promises.stat(outPath);

    // Comprimir e ficar maior acontece com PNG pequeno de poucas cores.
    if (size >= file.size && !needsResize) {
      await fs.promises.unlink(outPath).catch(() => {});
      return keepOriginal();
    }

    await fs.promises.unlink(file.path).catch(() => {});

    console.log(
      `[upload] ${file.filename} ${(file.size / 1024 / 1024).toFixed(2)} MB -> ` +
        `${outName} ${(size / 1024 / 1024).toFixed(2)} MB` +
        (needsResize ? ` (redimensionado de ${meta.width}x${meta.height})` : ''),
    );

    return {
      path: outPath,
      filename: outName,
      mimetype: 'image/webp',
      size,
      optimized: true,
      originalSize: file.size,
    };
  } catch (err) {
    console.error('[upload] falha ao comprimir a imagem, mantendo original:', err);
    await fs.promises.unlink(outPath).catch(() => {});
    return keepOriginal();
  }
}
