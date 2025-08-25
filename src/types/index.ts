// RemoteView Client Types - matching server protocol exactly

/// <reference path="./webgpu-minimal.d.ts" />

export enum DataType {
  U8 = 0,
  U16 = 1,
  F32 = 2,
  MuLawU8 = 3
}

export enum CompressionType {
  None = 0,
  LZ4 = 1,
  Zstd = 2
}

export enum PlaneType {
  Inline = 0,
  Crossline = 1,
  TimeDepth = 2
}

export interface TileHeader {
  msgType: number;      // 0x01 for tile
  plane: PlaneType;
  tileW: number;
  tileH: number;
  tileX: number;        // origin in slice pixel space
  tileY: number;
  sliceIndex: number;   // current plane index
  dtype: DataType;
  compression: CompressionType;
  uncompressedBytes: number;
  payloadBytes: number;
}

export interface TileData {
  header: TileHeader;
  payload: Uint8Array;
}

// Client capabilities for hello message
export interface ClientCapabilities {
  webgpu: boolean;
  webgl2: boolean;
  maxTexture: number;
}

// Control message types (client -> server)
export interface HelloMessage {
  t: 'hello';
  clientCaps: ClientCapabilities;
}

export interface SetSliceMessage {
  t: 'set_slice';
  inline: number;
  xline: number; 
  z: number;
}

export interface SetViewMessage {
  t: 'set_view';
  plane: 'inline' | 'xline' | 'z';
  index: number;
  drag?: boolean;
  vx?: number; // velocity hint
}

export interface SetLutMessage {
  t: 'set_lut';
  name: string;
  clipPct?: number;
  gain?: number;
  agc?: number;
}

export interface QualityMessage {
  t: 'quality';
  prefer: {
    dtype: 'u8' | 'u16' | 'f32';
    downsample: number;
  };
}

export interface PingMessage {
  t: 'ping';
  id: number;
}

export type ControlMessage = 
  | HelloMessage 
  | SetSliceMessage 
  | SetViewMessage 
  | SetLutMessage 
  | QualityMessage 
  | PingMessage;

// Response messages (server -> client)
export interface PongMessage {
  t: 'pong';
  id: number;
  serverTime: number;
}

export interface ErrorMessage {
  t: 'error';
  message: string;
}

export interface StatusMessage {
  t: 'status';
  data: any;
}

export type ControlResponse = PongMessage | ErrorMessage | StatusMessage;

// Renderer tiers as per project plan
export enum RendererTier {
  WebGPU = 'webgpu',
  WebGL2 = 'webgl2', 
  CPU = 'cpu'
}

export interface RendererCapabilities {
  tier: RendererTier;
  maxTextureSize: number;
  supportsFloatTextures: boolean;
  preferredDataType: DataType;
}

// LUT (Look-Up Table) definitions
export interface LutDefinition {
  name: string;
  displayName: string;
  colors: number[][]; // RGB triplets 0-255
  description?: string;
}

export interface LookupTable {
  name: string;
  data: Float32Array; // RGB values 0-1, length should be 256 * 3
  range: [number, number]; // min/max values for mapping
}

// HUD statistics
export interface HudStats {
  rtt: number;              // Round-trip time in ms
  tilesPerSecond: number;   // Inbound tile rate
  droppedTiles: number;     // Dropped tile count
  bitrate: number;          // Bits per second
  rendererTier: RendererTier;
  cacheHitRatio?: number;   // Server cache hit ratio
  memoryUsage?: number;     // Server memory usage
}

// Slice intersection point
export interface SliceIntersection {
  inline: number;
  crossline: number;
  timeDepth: number;
}

// View state
export interface ViewState {
  currentPlane: PlaneType;
  sliceIndices: SliceIntersection;
  lut: string;
  clipPercent: number;
  gain: number;
  agcWindow: number;
  isDragging: boolean;
  preferredQuality: {
    dtype: DataType;
    downsample: number;
  };
}