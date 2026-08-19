/**
 * Reparo de mojibake — texto UTF-8 que foi lido como Latin-1/CP1252.
 *
 * Sintoma: "musculação" gravado como "musculaÃ§Ã£o".
 *
 * A correção é feita **sequência por sequência**, nunca no texto inteiro: só os
 * trechos que casam com o padrão de mojibake são decodificados de volta. Um
 * round-trip `Buffer.from(texto, 'latin1')` sobre o texto todo destruiria
 * qualquer caractere acima de U+00FF (um em dash "—" viraria o byte de controle
 * 0x14, o que quebra o JSON do SiteContent) e abortaria em texto misto.
 */

/** CP1252: bytes 0x80–0x9F viram estes caracteres quando decodificados errado. */
const CP1252_TO_BYTE = new Map<string, number>([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84],
  ['…', 0x85], ['†', 0x86], ['‡', 0x87], ['ˆ', 0x88],
  ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c],
  ['Ž', 0x8e], ['‘', 0x91], ['’', 0x92], ['“', 0x93],
  ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97],
  ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b],
  ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
]);

/** Caracteres que podem representar um byte de continuação (0x80–0xBF). */
const CONT_CLASS = `[\\u0080-\\u00BF${[...CP1252_TO_BYTE.keys()].join('')}]`;

/**
 * Sequências de bytes UTF-8 válidas exibidas como texto Latin-1/CP1252:
 * lead de 2, 3 ou 4 bytes seguido do número certo de bytes de continuação.
 */
export const MOJIBAKE = new RegExp(
  [
    `[\\u00F0-\\u00F4]${CONT_CLASS}{3}`,
    `[\\u00E0-\\u00EF]${CONT_CLASS}{2}`,
    `[\\u00C2-\\u00DF]${CONT_CLASS}`,
  ].join('|'),
  'g',
);

function toByte(char: string): number | null {
  const mapped = CP1252_TO_BYTE.get(char);
  if (mapped !== undefined) return mapped;
  const code = char.codePointAt(0) ?? 0;
  return code <= 0xff ? code : null;
}

/** Decodifica uma única sequência suspeita. Devolve null se não for UTF-8 válido. */
function decodeSequence(sequence: string): string | null {
  const bytes: number[] = [];
  for (const char of sequence) {
    const byte = toByte(char);
    if (byte === null) return null;
    bytes.push(byte);
  }
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(
    Uint8Array.from(bytes),
  );
  if (decoded.includes('�')) return null;
  return decoded;
}

export function countMojibake(text: string): number {
  return text.match(MOJIBAKE)?.length ?? 0;
}

/**
 * Repara só as sequências reconhecidas. Devolve null quando nada muda —
 * então rodar em texto já correto é no-op, e texto misto (parte certa, parte
 * quebrada) é corrigido só na parte quebrada.
 */
export function repairText(text: string): string | null {
  if (!text) return null;
  let changed = false;
  const repaired = text.replace(MOJIBAKE, (sequence) => {
    const decoded = decodeSequence(sequence);
    if (decoded === null || decoded === sequence) return sequence;
    changed = true;
    return decoded;
  });
  return changed ? repaired : null;
}

/**
 * Igual a `repairText`, mas exige que o resultado continue sendo JSON válido.
 * Usado no `SiteContent.data`, que guarda o site inteiro num só campo: gravar
 * JSON inválido ali derruba todo o conteúdo (o `siteContent.get` engole o erro
 * de parse e devolve null).
 */
export function repairJsonText(text: string): string | null {
  const repaired = repairText(text);
  if (repaired === null) return null;
  try {
    JSON.parse(repaired);
  } catch {
    return null;
  }
  return repaired;
}
