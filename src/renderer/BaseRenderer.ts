/**
 * RemoteView Base Renderer
 * 
 * Abstract base class for all renderer implementations.
 */

import type { RendererCapabilities, TileData, LookupTable } from '../types';

export abstract class BaseRenderer {
  protected canvas: HTMLCanvasElement;
  protected capabilities: RendererCapabilities;

  constructor(canvas: HTMLCanvasElement, capabilities: RendererCapabilities) {
    this.canvas = canvas;
    this.capabilities = capabilities;
  }

  abstract initialize(): Promise<void>;
  abstract renderTile(tile: TileData, x: number, y: number, lut: LookupTable): Promise<void>;
  abstract setViewport(width: number, height: number): void;
  abstract clear(): void;
  abstract dispose(): void;

  getCapabilities(): RendererCapabilities {
    return { ...this.capabilities };
  }

  abstract getFrameStats(): {
    droppedFrames: number;
    lastFrameTime: number;
    averageFrameTime: number;
  };
}