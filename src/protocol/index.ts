// Protocol handling for RemoteView client

import type { 
  TileHeader, 
  TileData, 
  ControlMessage, 
  ControlResponse,
  DataType,
  CompressionType 
} from '@/types';

export class TileDecoder {
  // Decode binary tile message as per wire protocol spec
  static decode(data: ArrayBuffer): TileData | null {
    if (data.byteLength < 24) {
      console.warn('Tile message too short for header');
      return null;
    }

    const view = new DataView(data);
    let offset = 0;

    // Parse 24-byte header
    const header: TileHeader = {
      msgType: view.getUint8(offset++),
      plane: view.getUint8(offset++),
      tileW: view.getUint16(offset, true), // little endian
      tileH: view.getUint16(offset + 2, true),
      tileX: view.getUint32(offset + 4, true),
      tileY: view.getUint32(offset + 8, true),
      sliceIndex: view.getUint32(offset + 12, true),
      dtype: view.getUint8(offset + 16),
      compression: view.getUint8(offset + 17),
      uncompressedBytes: view.getUint32(offset + 18, true),
      payloadBytes: view.getUint32(offset + 22, true)
    };

    offset = 24;

    // Validate header
    if (header.msgType !== 0x01) {
      console.warn('Invalid tile message type:', header.msgType);
      return null;
    }

    if (data.byteLength < 24 + header.payloadBytes) {
      console.warn('Tile payload incomplete');
      return null;
    }

    // Extract payload
    const payload = new Uint8Array(data, offset, header.payloadBytes);

    return { header, payload };
  }

  // Get bytes per sample for data type
  static getBytesPerSample(dtype: DataType): number {
    switch (dtype) {
      case DataType.U8:
      case DataType.MuLawU8:
        return 1;
      case DataType.U16:
        return 2;
      case DataType.F32:
        return 4;
      default:
        return 1;
    }
  }

  // Get data type name
  static getDataTypeName(dtype: DataType): string {
    switch (dtype) {
      case DataType.U8: return 'u8';
      case DataType.U16: return 'u16';
      case DataType.F32: return 'f32';
      case DataType.MuLawU8: return 'mu-law-u8';
      default: return 'unknown';
    }
  }

  // Get compression type name
  static getCompressionName(compression: CompressionType): string {
    switch (compression) {
      case CompressionType.None: return 'none';
      case CompressionType.LZ4: return 'lz4';
      case CompressionType.Zstd: return 'zstd';
      default: return 'unknown';
    }
  }
}

export class TileDecompressor {
  private lz4Module: any = null;
  private zstdModule: any = null;

  async initialize() {
    // Initialize compression libraries
    // Note: In a real implementation, you'd load LZ4 and Zstd WASM modules
    console.log('Initializing tile decompressor...');
  }

  async decompress(data: Uint8Array, compression: CompressionType, uncompressedSize: number): Promise<Uint8Array> {
    switch (compression) {
      case CompressionType.None:
        return data;

      case CompressionType.LZ4:
        return this.decompressLZ4(data, uncompressedSize);

      case CompressionType.Zstd:
        return this.decompressZstd(data, uncompressedSize);

      default:
        throw new Error(`Unsupported compression type: ${compression}`);
    }
  }

  private async decompressLZ4(data: Uint8Array, uncompressedSize: number): Promise<Uint8Array> {
    // Placeholder - would use actual LZ4 WASM implementation
    console.log(`Decompressing LZ4: ${data.length} -> ${uncompressedSize} bytes`);
    
    // For now, assume data is already decompressed (development fallback)
    if (data.length === uncompressedSize) {
      return data;
    }
    
    // In real implementation, use LZ4 WASM module
    throw new Error('LZ4 decompression not yet implemented');
  }

  private async decompressZstd(data: Uint8Array, uncompressedSize: number): Promise<Uint8Array> {
    // Placeholder - would use actual Zstd WASM implementation  
    console.log(`Decompressing Zstd: ${data.length} -> ${uncompressedSize} bytes`);
    
    // For now, assume data is already decompressed (development fallback)
    if (data.length === uncompressedSize) {
      return data;
    }
    
    // In real implementation, use Zstd WASM module
    throw new Error('Zstd decompression not yet implemented');
  }
}

export class ControlMessageHandler {
  // Encode control message to JSON string
  static encode(message: ControlMessage): string {
    return JSON.stringify(message);
  }

  // Decode control response from JSON string
  static decode(data: string): ControlResponse {
    try {
      return JSON.parse(data) as ControlResponse;
    } catch (error) {
      console.error('Failed to parse control response:', error);
      return {
        t: 'error',
        message: 'Failed to parse server response'
      };
    }
  }

  // Create ping message
  static createPing(id: number) {
    return ControlMessageHandler.encode({
      t: 'ping',
      id
    });
  }

  // Create hello message with client capabilities
  static createHello(capabilities: any) {
    return ControlMessageHandler.encode({
      t: 'hello',
      clientCaps: capabilities
    });
  }
}