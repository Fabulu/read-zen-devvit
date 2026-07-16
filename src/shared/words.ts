/** CJK-aware word count: whitespace-delimited tokens for alphabetic scripts,
 *  plus one word per CJK/kana/hangul codepoint (those scripts don't space-
 *  delimit words; per-character is the standard proxy, ~1 hanzi = ~1 word).
 *  Ranges: Hiragana/Katakana U+3040-30FF, CJK-Ext-A U+3400-4DBF, CJK-unified
 *  U+4E00-9FFF, CJK-compat U+F900-FAFF, Hangul-syllables U+AC00-D7AF. */
const CJK =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/gu

export function countWords(s: string): number {
  const cjk = s.match(CJK)?.length ?? 0
  const rest = s.replace(CJK, ' ').trim().split(/\s+/).filter(Boolean).length
  return cjk + rest
}
