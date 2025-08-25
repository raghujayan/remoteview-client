/**
 * RemoteView Renderer Manager
 * 
 * Manages renderer tiers: WebGPU > WebGL2 > CPU fallback
 * Automatically selects best available renderer based on browser capabilities.
 */

import { RendererTier, RendererCapabilities, DataType, TileData, LookupTable } from '../types';
import { BaseRenderer } from './BaseRenderer';
import { WebGPURenderer } from './WebGPURenderer';
import { WebGL2Renderer } from './WebGL2Renderer';
import { CPURenderer } from './CPURenderer';

export interface RendererConfig {
  preferredTier?: RendererTier;
  canvas: HTMLCanvasElement;
  maxTextureSize?: number;
}

export interface RenderTarget {
  width: number;
  height: number;
  format: 'rgba8' | 'rgba16' | 'rgba32f';
}

// Re-export for convenience
export { BaseRenderer };
export type { LookupTable };

export class RendererManager {
  private activeRenderer: BaseRenderer | null = null;
  private canvas: HTMLCanvasElement;
  private config: RendererConfig;
  
  constructor(config: RendererConfig) {
    this.config = config;
    this.canvas = config.canvas;
  }

  async initialize(): Promise<void> {
    const capabilities = await this.detectCapabilities();
    
    // Try renderers in order of preference
    const rendererTiers = this.getRendererTiers();
    
    for (const tier of rendererTiers) {
      try {
        const renderer = await this.createRenderer(tier, capabilities);
        await renderer.initialize();
        
        this.activeRenderer = renderer;
        console.log(`[RendererManager] Successfully initialized ${tier} renderer`);
        return;
        
      } catch (error) {
        console.warn(`[RendererManager] Failed to initialize ${tier} renderer:`, error);
        continue;
      }
    }
    
    throw new Error('Failed to initialize any renderer tier');
  }

  private getRendererTiers(): RendererTier[] {
    if (this.config.preferredTier) {
      // If preferred tier is specified, try it first then fall back
      switch (this.config.preferredTier) {
        case RendererTier.WebGPU:
          return [RendererTier.WebGPU, RendererTier.WebGL2, RendererTier.CPU];
        case RendererTier.WebGL2:
          return [RendererTier.WebGL2, RendererTier.CPU];
        case RendererTier.CPU:
          return [RendererTier.CPU];
      }
    }
    
    // Default order: best to worst
    return [RendererTier.WebGPU, RendererTier.WebGL2, RendererTier.CPU];
  }

  private async detectCapabilities(): Promise<RendererCapabilities> {
    const capabilities: RendererCapabilities = {
      tier: RendererTier.CPU, // Will be updated based on successful renderer
      maxTextureSize: this.config.maxTextureSize || 4096,
      supportsFloatTextures: false,
      preferredDataType: DataType.U8
    };

    // Test WebGPU support
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const limits = adapter.limits;
          capabilities.maxTextureSize = Math.min(
            limits.maxTextureDimension2D || 4096,
            capabilities.maxTextureSize
          );
          capabilities.supportsFloatTextures = true;
          capabilities.preferredDataType = DataType.F32;
        }
      } catch (error) {
        console.debug('[RendererManager] WebGPU not available:', error);
      }
    }

    // Test WebGL2 support
    const gl = this.canvas.getContext('webgl2');
    if (gl) {
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      capabilities.maxTextureSize = Math.min(maxTextureSize, capabilities.maxTextureSize);
      
      // Check for float texture support
      const floatTextures = gl.getExtension('EXT_color_buffer_float');
      if (floatTextures) {
        capabilities.supportsFloatTextures = true;
        capabilities.preferredDataType = DataType.F32;
      } else {
        capabilities.preferredDataType = DataType.U16;
      }
    }

    return capabilities;
  }

  private async createRenderer(tier: RendererTier, capabilities: RendererCapabilities): Promise<BaseRenderer> {
    const rendererCapabilities = { ...capabilities, tier };
    
    switch (tier) {
      case RendererTier.WebGPU:
        return new WebGPURenderer(this.canvas, rendererCapabilities);
      
      case RendererTier.WebGL2:
        return new WebGL2Renderer(this.canvas, rendererCapabilities);
      
      case RendererTier.CPU:
        return new CPURenderer(this.canvas, rendererCapabilities);
      
      default:
        throw new Error(`Unsupported renderer tier: ${tier}`);
    }
  }

  async renderTile(tile: TileData, x: number, y: number, lut: LookupTable): Promise<void> {
    if (!this.activeRenderer) {
      throw new Error('Renderer not initialized');
    }
    
    await this.activeRenderer.renderTile(tile, x, y, lut);
  }

  setViewport(width: number, height: number): void {
    if (this.activeRenderer) {
      this.activeRenderer.setViewport(width, height);
    }
  }

  clear(): void {
    if (this.activeRenderer) {
      this.activeRenderer.clear();
    }
  }

  getCapabilities(): RendererCapabilities | null {
    return this.activeRenderer?.getCapabilities() || null;
  }

  getCurrentTier(): RendererTier | null {
    return this.activeRenderer?.getCapabilities().tier || null;
  }

  getFrameStats() {
    return this.activeRenderer?.getFrameStats() || {
      droppedFrames: 0,
      lastFrameTime: 0,
      averageFrameTime: 16.67 // 60fps default
    };
  }

  dispose(): void {
    if (this.activeRenderer) {
      this.activeRenderer.dispose();
      this.activeRenderer = null;
    }
  }

  // Utility method to create common lookup tables
  static createLookupTable(name: string, colors: number[][]): LookupTable {
    const data = new Float32Array(256 * 3);
    
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const colorIndex = Math.min(Math.floor(t * (colors.length - 1)), colors.length - 2);
      const localT = (t * (colors.length - 1)) - colorIndex;
      
      const color1 = colors[colorIndex];
      const color2 = colors[colorIndex + 1];
      
      // Linear interpolation between colors
      data[i * 3 + 0] = (color1[0] * (1 - localT) + color2[0] * localT) / 255;
      data[i * 3 + 1] = (color1[1] * (1 - localT) + color2[1] * localT) / 255;
      data[i * 3 + 2] = (color1[2] * (1 - localT) + color2[2] * localT) / 255;
    }
    
    return {
      name,
      data,
      range: [0, 1]
    };
  }
}