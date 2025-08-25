/**
 * RemoteView Tile Frame Parser
 * 
 * Centralized binary parsing with comprehensive validation and error handling.
 * Enforces protocol invariants and drops malformed frames with detailed reasons.
 */

import { TileHeader, TileData, DataType, CompressionType, PlaneType } from '../types';

export enum ParseError {
  BUFFER_TOO_SHORT = 'buffer_too_short',
  INVALID_MESSAGE_TYPE = 'invalid_message_type',
  INVALID_PLANE_TYPE = 'invalid_plane_type',
  INVALID_DATA_TYPE = 'invalid_data_type',
  INVALID_COMPRESSION_TYPE = 'invalid_compression_type',
  INVALID_TILE_DIMENSIONS = 'invalid_tile_dimensions',
  INVALID_PAYLOAD_SIZE = 'invalid_payload_size',
  PAYLOAD_SIZE_MISMATCH = 'payload_size_mismatch',
  UNCOMPRESSED_SIZE_MISMATCH = 'uncompressed_size_mismatch',
  CORRUPTED_HEADER = 'corrupted_header',
  ENDIANNESS_MISMATCH = 'endianness_mismatch'
}

export interface ParseResult {
  success: boolean;
  data?: TileData;
  error?: ParseError;
  errorDetails?: string;
  droppedBytes?: number;
}

export interface ValidationLimits {
  maxTileWidth: number;
  maxTileHeight: number;
  maxCoordinate: number;
  maxSliceIndex: number;
  maxPixelsPerTile: number;
  maxPayloadSize: number;
}

export class TileFrameParser {
  private static readonly TILE_HEADER_SIZE = 24;
  private static readonly EXPECTED_MSG_TYPE = 0x01;
  private static readonly PROTOCOL_VERSION = 1;
  
  // Validation limits matching server-side implementation
  private static readonly LIMITS: ValidationLimits = {
    maxTileWidth: 2048,
    maxTileHeight: 2048,
    maxCoordinate: 1000000,
    maxSliceIndex: 100000,
    maxPixelsPerTile: 4 * 1024 * 1024, // 4M pixels
    maxPayloadSize: 16 * 1024 * 1024    // 16MB
  };

  private frameCount = 0;
  private droppedFrames = 0;
  private lastError: ParseError | null = null;

  /**
   * Parse a binary tile frame with comprehensive validation
   */
  parse(buffer: ArrayBuffer): ParseResult {
    this.frameCount++;
    
    try {
      // Basic buffer size check
      if (buffer.byteLength < TileFrameParser.TILE_HEADER_SIZE) {
        this.recordDrop(ParseError.BUFFER_TOO_SHORT);
        return {
          success: false,
          error: ParseError.BUFFER_TOO_SHORT,
          errorDetails: `Buffer too short: ${buffer.byteLength} < ${TileFrameParser.TILE_HEADER_SIZE}`,
          droppedBytes: buffer.byteLength
        };
      }

      const view = new DataView(buffer);
      const header = this.parseHeader(view);
      
      if (!header.success) {
        this.recordDrop(header.error!);
        return {
          success: false,
          error: header.error,
          errorDetails: header.errorDetails,
          droppedBytes: buffer.byteLength
        };
      }

      // Validate payload size matches buffer
      const expectedTotalSize = TileFrameParser.TILE_HEADER_SIZE + header.data!.payloadBytes;
      if (buffer.byteLength !== expectedTotalSize) {
        this.recordDrop(ParseError.PAYLOAD_SIZE_MISMATCH);
        return {
          success: false,
          error: ParseError.PAYLOAD_SIZE_MISMATCH,
          errorDetails: `Buffer size ${buffer.byteLength} != expected ${expectedTotalSize}`,
          droppedBytes: buffer.byteLength
        };
      }

      // Extract payload
      const payload = new Uint8Array(
        buffer, 
        TileFrameParser.TILE_HEADER_SIZE, 
        header.data!.payloadBytes
      );

      // Validate payload integrity
      const payloadValidation = this.validatePayload(payload, header.data!);
      if (!payloadValidation.success) {
        this.recordDrop(payloadValidation.error!);
        return {
          success: false,
          error: payloadValidation.error,
          errorDetails: payloadValidation.errorDetails,
          droppedBytes: buffer.byteLength
        };
      }

      return {
        success: true,
        data: {
          header: header.data!,
          payload
        }
      };

    } catch (error) {
      this.recordDrop(ParseError.CORRUPTED_HEADER);
      return {
        success: false,
        error: ParseError.CORRUPTED_HEADER,
        errorDetails: error instanceof Error ? error.message : 'Unknown parsing error',
        droppedBytes: buffer.byteLength
      };
    }
  }

  private parseHeader(view: DataView): { success: boolean; data?: TileHeader; error?: ParseError; errorDetails?: string } {
    let offset = 0;

    try {
      // Check message type
      const msgType = view.getUint8(offset++);
      if (msgType !== TileFrameParser.EXPECTED_MSG_TYPE) {
        return {
          success: false,
          error: ParseError.INVALID_MESSAGE_TYPE,
          errorDetails: `Expected 0x${TileFrameParser.EXPECTED_MSG_TYPE.toString(16)}, got 0x${msgType.toString(16)}`
        };
      }

      // Parse plane type
      const planeValue = view.getUint8(offset++);
      if (!this.isValidPlaneType(planeValue)) {
        return {
          success: false,
          error: ParseError.INVALID_PLANE_TYPE,
          errorDetails: `Invalid plane type: ${planeValue}`
        };
      }

      // Parse dimensions (little endian per protocol spec)
      const tileW = view.getUint16(offset, true);
      const tileH = view.getUint16(offset + 2, true);
      offset += 4;

      // Validate tile dimensions
      if (tileW === 0 || tileH === 0 || 
          tileW > TileFrameParser.LIMITS.maxTileWidth || 
          tileH > TileFrameParser.LIMITS.maxTileHeight) {
        return {
          success: false,
          error: ParseError.INVALID_TILE_DIMENSIONS,
          errorDetails: `Invalid dimensions: ${tileW}x${tileH}`
        };
      }

      // Check pixel count limit
      const pixelCount = tileW * tileH;
      if (pixelCount > TileFrameParser.LIMITS.maxPixelsPerTile) {
        return {
          success: false,
          error: ParseError.INVALID_TILE_DIMENSIONS,
          errorDetails: `Too many pixels: ${pixelCount} > ${TileFrameParser.LIMITS.maxPixelsPerTile}`
        };
      }

      // Parse coordinates (little endian)
      const tileX = view.getUint32(offset, true);
      const tileY = view.getUint32(offset + 4, true);
      const sliceIndex = view.getUint32(offset + 8, true);
      offset += 12;

      // Validate coordinates
      if (tileX > TileFrameParser.LIMITS.maxCoordinate || 
          tileY > TileFrameParser.LIMITS.maxCoordinate ||
          sliceIndex > TileFrameParser.LIMITS.maxSliceIndex) {
        return {
          success: false,
          error: ParseError.INVALID_TILE_DIMENSIONS,
          errorDetails: `Invalid coordinates: (${tileX}, ${tileY}) slice ${sliceIndex}`
        };
      }

      // Parse data type and compression
      const dtype = view.getUint8(offset++);
      const compression = view.getUint8(offset++);

      if (!this.isValidDataType(dtype)) {
        return {
          success: false,
          error: ParseError.INVALID_DATA_TYPE,
          errorDetails: `Invalid data type: ${dtype}`
        };
      }

      if (!this.isValidCompressionType(compression)) {
        return {
          success: false,
          error: ParseError.INVALID_COMPRESSION_TYPE,
          errorDetails: `Invalid compression type: ${compression}`
        };
      }

      // Parse sizes (little endian)
      const uncompressedBytes = view.getUint32(offset, true);
      const payloadBytes = view.getUint32(offset + 4, true);
      offset += 8;

      // Validate sizes
      if (payloadBytes > TileFrameParser.LIMITS.maxPayloadSize) {
        return {
          success: false,
          error: ParseError.INVALID_PAYLOAD_SIZE,
          errorDetails: `Payload too large: ${payloadBytes} > ${TileFrameParser.LIMITS.maxPayloadSize}`
        };
      }

      // For uncompressed data, sizes should match
      if (compression === CompressionType.None && uncompressedBytes !== payloadBytes) {
        return {
          success: false,
          error: ParseError.UNCOMPRESSED_SIZE_MISMATCH,
          errorDetails: `Uncompressed size mismatch: ${uncompressedBytes} != ${payloadBytes}`
        };
      }

      // Validate expected uncompressed size based on dimensions and data type
      const bytesPerSample = this.getBytesPerSample(dtype);
      const expectedUncompressedSize = pixelCount * bytesPerSample;
      if (uncompressedBytes !== expectedUncompressedSize) {
        return {
          success: false,
          error: ParseError.UNCOMPRESSED_SIZE_MISMATCH,
          errorDetails: `Expected ${expectedUncompressedSize} bytes, got ${uncompressedBytes}`
        };
      }

      return {
        success: true,
        data: {
          msgType,
          plane: planeValue as PlaneType,
          tileW,
          tileH,
          tileX,
          tileY,
          sliceIndex,
          dtype: dtype as DataType,
          compression: compression as CompressionType,
          uncompressedBytes,
          payloadBytes
        }
      };

    } catch (error) {
      return {
        success: false,
        error: ParseError.CORRUPTED_HEADER,
        errorDetails: error instanceof Error ? error.message : 'Header parsing failed'
      };
    }
  }

  private validatePayload(payload: Uint8Array, header: TileHeader): { success: boolean; error?: ParseError; errorDetails?: string } {
    // Basic payload size check
    if (payload.length !== header.payloadBytes) {
      return {
        success: false,
        error: ParseError.PAYLOAD_SIZE_MISMATCH,
        errorDetails: `Payload size ${payload.length} != header ${header.payloadBytes}`
      };
    }

    // For compressed data, validate that it's not larger than the uncompressed size
    // (this catches some forms of corruption)
    if (header.compression !== CompressionType.None && payload.length > header.uncompressedBytes) {
      return {
        success: false,
        error: ParseError.INVALID_PAYLOAD_SIZE,
        errorDetails: `Compressed payload larger than uncompressed size: ${payload.length} > ${header.uncompressedBytes}`
      };
    }

    return { success: true };
  }

  private isValidPlaneType(value: number): boolean {
    return value >= 0 && value <= 2 && Object.values(PlaneType).includes(value);
  }

  private isValidDataType(value: number): boolean {
    return Object.values(DataType).includes(value);
  }

  private isValidCompressionType(value: number): boolean {
    return Object.values(CompressionType).includes(value);
  }

  private getBytesPerSample(dtype: DataType): number {
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

  private recordDrop(error: ParseError) {
    this.droppedFrames++;
    this.lastError = error;
    console.warn(`[TileFrameParser] Frame dropped: ${error} (${this.droppedFrames}/${this.frameCount})`);
  }

  /**
   * Get parsing statistics
   */
  getStats() {
    return {
      totalFrames: this.frameCount,
      droppedFrames: this.droppedFrames,
      successRate: this.frameCount > 0 ? (this.frameCount - this.droppedFrames) / this.frameCount : 1,
      lastError: this.lastError
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.frameCount = 0;
    this.droppedFrames = 0;
    this.lastError = null;
  }

  /**
   * Check if data looks like a valid tile frame header
   */
  static isValidTileFrame(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < TileFrameParser.TILE_HEADER_SIZE) {
      return false;
    }
    
    const view = new DataView(buffer);
    const msgType = view.getUint8(0);
    return msgType === TileFrameParser.EXPECTED_MSG_TYPE;
  }
}