// Export wraps the world JSON in gzip. Image bytes are inlined as base64 data
// URLs (see worldFile.ts), and base64 only uses 64 symbols, so it compresses
// extremely well — gzip nearly cancels its ~33% size overhead at zero cost.
// Import accepts both gzipped and legacy plain-JSON files, detected by magic
// bytes, so older exports keep working.

const GZIP_MAGIC = [0x1f, 0x8b] as const;

export const gzipText = (text: string): Promise<Blob> => {
  const compressed = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(compressed).blob();
};

export const readWorldFileText = async (file: Blob): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isGzip = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  if (!isGzip) {
    return new TextDecoder().decode(buffer);
  }

  const decompressed = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressed).text();
};
