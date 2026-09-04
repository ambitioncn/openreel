export function inspectWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.subarray(0, 4).toString() !== "RIFF" || bytes.subarray(8, 12).toString() !== "WAVE") return null;
  if (bytes.readUInt32LE(4) !== bytes.length - 8) return null;
  let offset = 12, chunkCount = 0, hasFormat = false, hasFact = false, hasAudio = false, blockAlign = null, channels = null, sampleRate = null, dataBytes = null, audioFormat = null, bitsPerSample = null, factSampleFrames = null;
  while (offset < bytes.length) {
    if (++chunkCount > 1_024) return null;
    if (offset + 8 > bytes.length) return null;
    const idBytes = bytes.subarray(offset, offset + 4);
    if ([...idBytes].some(byte => byte < 0x20 || byte > 0x7e)) return null;
    const id = idBytes.toString("ascii"), size = bytes.readUInt32LE(offset + 4), dataStart = offset + 8, dataEnd = dataStart + size;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.length) return null;
    if (id === "fmt ") {
      if (hasFormat || size < 16) return null;
      const format = bytes.readUInt16LE(dataStart), byteRate = bytes.readUInt32LE(dataStart + 8);
      audioFormat = format === 1 ? "pcm" : format === 3 ? "ieee-float" : null;
      bitsPerSample = bytes.readUInt16LE(dataStart + 14);
      channels = bytes.readUInt16LE(dataStart + 2); sampleRate = bytes.readUInt32LE(dataStart + 4); blockAlign = bytes.readUInt16LE(dataStart + 12);
      const supportedBits = format === 1 ? new Set([8, 16, 24, 32]) : format === 3 ? new Set([32, 64]) : null;
      if (!supportedBits?.has(bitsPerSample) || channels < 1 || channels > 2 || sampleRate < 8_000 || sampleRate > 192_000) return null;
      // This boundary supports canonical WAVEFORMAT plus the zero-length
      // WAVEFORMATEX form only. Do not silently admit truncated, undeclared,
      // or codec-specific extension bytes that we do not interpret.
      if (size !== 16 && (size !== 18 || bytes.readUInt16LE(dataStart + 16) !== 0)) return null;
      const expectedBlockAlign = channels * (bitsPerSample / 8);
      if (blockAlign !== expectedBlockAlign || byteRate !== sampleRate * expectedBlockAlign) return null;
      hasFormat = true;
    }
    if (id === "fact") {
      if (!hasFormat || hasFact || hasAudio || size !== 4) return null;
      factSampleFrames = bytes.readUInt32LE(dataStart);
      if (factSampleFrames === 0) return null;
      hasFact = true;
    }
    if (id === "data") {
      if (!hasFormat || hasAudio || size === 0 || size % blockAlign !== 0) return null;
      dataBytes = size;
      // IEEE-float requires fact provenance. PCM does not require the chunk,
      // but if an upstream includes it, it must not contradict the byte-derived
      // frame count that will drive duration and timeline persistence.
      if ((audioFormat === "ieee-float" && !hasFact) || (hasFact && factSampleFrames !== dataBytes / blockAlign)) return null;
      if (audioFormat === "ieee-float") {
        const sampleBytes = bitsPerSample / 8;
        for (let sampleOffset = dataStart; sampleOffset < dataEnd; sampleOffset += sampleBytes) {
          const sample = bitsPerSample === 32 ? bytes.readFloatLE(sampleOffset) : bytes.readDoubleLE(sampleOffset);
          if (!Number.isFinite(sample)) return null;
        }
      }
      hasAudio = true;
    }
    if (size % 2 && (dataEnd >= bytes.length || bytes[dataEnd] !== 0)) return null;
    offset = dataEnd + (size % 2);
    if (offset > bytes.length) return null;
  }
  if (offset !== bytes.length || !hasFormat || !hasAudio) return null;
  return Object.freeze({ audioFormat, bitsPerSample, channels, sampleRate, durationSeconds: dataBytes / (sampleRate * blockAlign) });
}
