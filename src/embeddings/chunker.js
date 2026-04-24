const DEFAULT_CHUNK_CHARS = 1000
const DEFAULT_OVERLAP_CHARS = 200
const MIN_CHUNK_CHARS = 120

function normalizeWhitespace(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function chunkText(text, { chunkChars = DEFAULT_CHUNK_CHARS, overlap = DEFAULT_OVERLAP_CHARS } = {}) {
  const clean = normalizeWhitespace(text)
  if (clean.length === 0) return []

  if (clean.length <= chunkChars) return [{ text: clean, start: 0, end: clean.length }]

  const stride = Math.max(1, chunkChars - overlap)
  const chunks = []
  for (let start = 0; start < clean.length; start += stride) {
    const end = Math.min(clean.length, start + chunkChars)
    const piece = clean.slice(start, end).trim()
    if (piece.length >= MIN_CHUNK_CHARS || chunks.length === 0) {
      chunks.push({ text: piece, start, end })
    }
    if (end >= clean.length) break
  }
  return chunks
}

function chunkParsedFile(parsedFile, opts = {}) {
  const windows = chunkText(parsedFile?.raw_text, opts)
  return windows.map((w, i) => ({
    id: `${parsedFile.checksum || 'nofile'}_${i}`,
    text: w.text,
    source_file: parsedFile.file_path,
    checksum: parsedFile.checksum || null,
    chunk_index: i,
    char_start: w.start,
    char_end: w.end,
  }))
}

module.exports = { chunkText, chunkParsedFile, DEFAULT_CHUNK_CHARS, DEFAULT_OVERLAP_CHARS }
