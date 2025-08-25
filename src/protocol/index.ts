// Protocol handling for RemoteView client

import { DataType, CompressionType } from '../types';
import type { 
  TileHeader, 
  TileData, 
  ControlMessage, 
  ControlResponse
} from '../types';

import { TileFrameParser } from './parseTileFrame';

export class TileDecoder {
  private static parser = new TileFrameParser();

  // Decode binary tile message with comprehensive validation
  static decode(data: ArrayBuffer): TileData | null {
    const result = this.parser.parse(data);
    
    if (!result.success) {
      console.warn(`[TileDecoder] Frame parse failed: ${result.error} - ${result.errorDetails}`);
      return null;
    }
    
    return result.data!;
  }

  // Get parser statistics
  static getParseStats() {
    return this.parser.getStats();
  }

  // Reset parser statistics
  static resetParseStats() {
    this.parser.resetStats();
  }

  // Check if buffer contains a valid tile frame
  static isValidTileFrame(buffer: ArrayBuffer): boolean {
    return TileFrameParser.isValidTileFrame(buffer);
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

import { getDecompressionPool } from '../workers/DecompressionPool';

export class TileDecompressor {
  private decompressionPool = getDecompressionPool();

  async initialize() {
    console.log('TileDecompressor using worker pool for decompression');
  }

  async decompress(data: Uint8Array, compression: CompressionType, uncompressedSize: number): Promise<Uint8Array> {
    // Use worker pool for all decompression (including 'none' for consistency)
    return this.decompressionPool.decompress(data, compression, uncompressedSize);
  }

  getStats() {
    return this.decompressionPool.getStats();
  }

  shouldBackOff(): boolean {
    return this.decompressionPool.shouldBackOff();
  }

  getQueuePressure(): number {
    return this.decompressionPool.getQueuePressure();
  }

  dispose() {
    // Note: Don't dispose the global pool here as other instances might be using it
    // Pool disposal should be handled at application shutdown
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