import { z } from 'zod';
import { router, contentProcedure } from '../trpc';
import { optimizeUploadsFolder } from '../lib/optimizeUploads';

/**
 * Manutenção do acervo de mídia — hoje só a compressão das imagens já enviadas.
 *
 * `contentProcedure` (admin e editor): é a mesma permissão de quem envia mídia
 * pelo painel, e a operação não apaga nada — só reescreve a imagem menor,
 * mantendo nome e extensão para não quebrar as referências do site.
 */
export const mediaLibraryRouter = router({
  /** Simulação: mostra o quanto dá para economizar, sem escrever nada. */
  scanUploads: contentProcedure.mutation(async () => {
    return optimizeUploadsFolder({ apply: false });
  }),

  /**
   * Comprime de fato os arquivos.
   *
   * `files` é a seleção feita na análise: sem ela o acervo inteiro é
   * processado (comportamento antigo), com ela só as imagens escolhidas. Como
   * a compressão não tem desfazer, comprimir uma de cada vez é o caminho
   * normal no painel.
   */
  optimizeUploads: contentProcedure
    .input(
      z
        .object({
          files: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      return optimizeUploadsFolder({ apply: true, only: input?.files });
    }),
});
