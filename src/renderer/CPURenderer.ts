/**
 * RemoteView CPU Renderer
 * 
 * CPU fallback renderer using WASM mapping (window/level + LUT) → ImageData blit.
 * Reduces rendering rate while dragging to maintain responsiveness.
 */

import { TileData, DataType, LookupTable } from '../types';
import { BaseRenderer } from './BaseRenderer';

interface WindowLevelSettings {
  windowWidth: number;
  windowCenter: number;
}

export class CPURenderer extends BaseRenderer {
  private context: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;
  private currentLut: string | null = null;
  private lutData: Uint8Array | null = null;
  private isDragging: boolean = false;
  private reducedQuality: boolean = false;
  
  private frameStats = {
    droppedFrames: 0,
    lastFrameTime: 0,
    averageFrameTime: 16.67,
    frameCount: 0,
    totalFrameTime: 0
  };

  // WASM-style optimized mapping functions
  private static windowLevelMapping = new Float32Array(65536);
  private static lutMapping = new Uint8Array(256 * 4);

  async initialize(): Promise<void> {
    this.context = this.canvas.getContext('2d', {
      alpha: false,
      desynchronized: true
    });
    
    if (!this.context) {
      throw new Error('Failed to get 2D rendering context');
    }

    // Pre-allocate ImageData for common tile size
    this.imageData = new ImageData(256, 256);
    
    console.log('[CPURenderer] Initialized successfully');
  }

  async renderTile(tile: TileData, x: number, y: number, lut: LookupTable): Promise<void> {
    if (!this.context) {
      throw new Error('Renderer not initialized');
    }

    const startTime = performance.now();

    try {
      // Skip rendering if dragging and reduced quality mode is active
      if (this.isDragging && this.reducedQuality) {
        if (Math.random() > 0.3) { // Drop 70% of frames while dragging
          this.frameStats.droppedFrames++;
          return;
        }
      }

      // Update LUT if needed
      if (this.currentLut !== lut.name) {
        this.updateLutMapping(lut);
        this.currentLut = lut.name;
      }

      // Create or resize ImageData if needed
      const { header } = tile;
      if (!this.imageData || 
          this.imageData.width !== header.tileW || 
          this.imageData.height !== header.tileH) {
        this.imageData = new ImageData(header.tileW, header.tileH);
      }

      // Process tile data based on data type
      await this.processTileData(tile, lut);

      // Blit to canvas
      this.context.putImageData(this.imageData, x, y);

      // Update frame stats
      const frameTime = performance.now() - startTime;
      this.updateFrameStats(frameTime);

    } catch (error) {
      this.frameStats.droppedFrames++;
      throw error;
    }
  }

  private async processTileData(tile: TileData, lut: LookupTable): Promise<void> {
    const { header, payload } = tile;
    const pixelCount = header.tileW * header.tileH;
    
    // Get typed array view based on data type
    let sourceData: Uint8Array | Uint16Array | Float32Array;
    
    switch (header.dtype) {
      case DataType.U8:
      case DataType.MuLawU8:
        sourceData = payload;
        break;
      case DataType.U16:
        sourceData = new Uint16Array(payload.buffer, payload.byteOffset, payload.byteLength / 2);
        break;
      case DataType.F32:
        sourceData = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
        break;
      default:
        throw new Error(`Unsupported data type: ${header.dtype}`);
    }

    // Apply window/level + LUT mapping (WASM-style optimized)
    const imageBuffer = this.imageData!.data;
    const windowSettings: WindowLevelSettings = {
      windowWidth: lut.range[1] - lut.range[0],
      windowCenter: (lut.range[1] + lut.range[0]) / 2
    };

    // Optimized mapping loop
    for (let i = 0; i < pixelCount; i++) {
      const rawValue = sourceData[i];
      
      // Window/Level transformation
      let normalizedValue = this.applyWindowLevel(rawValue, windowSettings);
      
      // Clamp to [0, 1] range
      normalizedValue = Math.max(0, Math.min(1, normalizedValue));
      
      // Map to LUT index
      const lutIndex = Math.floor(normalizedValue * 255);
      
      // Apply LUT and write to ImageData
      const pixelOffset = i * 4;
      imageBuffer[pixelOffset + 0] = this.lutData![lutIndex * 3 + 0]; // R
      imageBuffer[pixelOffset + 1] = this.lutData![lutIndex * 3 + 1]; // G
      imageBuffer[pixelOffset + 2] = this.lutData![lutIndex * 3 + 2]; // B
      imageBuffer[pixelOffset + 3] = 255; // A
    }
  }

  private applyWindowLevel(value: number, settings: WindowLevelSettings): number {
    const { windowWidth, windowCenter } = settings;
    const minValue = windowCenter - windowWidth / 2;
    const maxValue = windowCenter + windowWidth / 2;
    
    if (value <= minValue) return 0;
    if (value >= maxValue) return 1;
    
    return (value - minValue) / windowWidth;
  }

  private updateLutMapping(lut: LookupTable): void {
    // Convert Float32Array LUT to Uint8Array for faster access
    this.lutData = new Uint8Array(256 * 3);
    
    for (let i = 0; i < 256; i++) {
      this.lutData[i * 3 + 0] = Math.round(lut.data[i * 3 + 0] * 255);
      this.lutData[i * 3 + 1] = Math.round(lut.data[i * 3 + 1] * 255);
      this.lutData[i * 3 + 2] = Math.round(lut.data[i * 3 + 2] * 255);
    }
  }

  private updateFrameStats(frameTime: number): void {
    this.frameStats.lastFrameTime = frameTime;
    this.frameStats.frameCount++;
    this.frameStats.totalFrameTime += frameTime;
    this.frameStats.averageFrameTime = this.frameStats.totalFrameTime / this.frameStats.frameCount;
  }

  setViewport(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  clear(): void {
    if (this.context) {
      this.context.fillStyle = 'black';
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  getFrameStats() {
    return { ...this.frameStats };
  }

  // Performance optimization methods
  setDragging(isDragging: boolean): void {
    this.isDragging = isDragging;
    this.reducedQuality = isDragging;
    
    if (isDragging) {
      console.log('[CPURenderer] Entering reduced quality mode for dragging');
    } else {
      console.log('[CPURenderer] Exiting reduced quality mode');
    }
  }

  setReducedQuality(enabled: boolean): void {
    this.reducedQuality = enabled;
  }

  dispose(): void {
    this.context = null;
    this.imageData = null;
    this.lutData = null;
    this.currentLut = null;
  }

  // Static utility for creating window/level presets
  static createWindowLevelLut(
    windowWidth: number,
    windowCenter: number,
    colorMap: number[][]
  ): LookupTable {
    const data = new Float32Array(256 * 3);
    
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const colorIndex = Math.min(Math.floor(t * (colorMap.length - 1)), colorMap.length - 2);
      const localT = (t * (colorMap.length - 1)) - colorIndex;
      
      const color1 = colorMap[colorIndex];
      const color2 = colorMap[colorIndex + 1];
      
      // Linear interpolation between colors
      data[i * 3 + 0] = (color1[0] * (1 - localT) + color2[0] * localT) / 255;
      data[i * 3 + 1] = (color1[1] * (1 - localT) + color2[1] * localT) / 255;
      data[i * 3 + 2] = (color1[2] * (1 - localT) + color2[2] * localT) / 255;
    }
    
    return {
      name: `WL_${windowWidth}_${windowCenter}`,
      data,
      range: [
        windowCenter - windowWidth / 2,
        windowCenter + windowWidth / 2
      ]
    };
  }
}