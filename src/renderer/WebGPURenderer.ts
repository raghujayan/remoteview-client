/**
 * RemoteView WebGPU Renderer
 * 
 * High-performance renderer using WebGPU with queue.writeTexture path
 * for optimal tile rendering performance.
 */

import { TileData, DataType, LookupTable } from '../types';
import { BaseRenderer } from './BaseRenderer';

export class WebGPURenderer extends BaseRenderer {
  private device: any = null;
  private context: any = null;
  private renderPipeline: any = null;
  private lutTexture: any = null;
  private lutSampler: any = null;
  private bindGroupLayout: any = null;
  
  private frameStats = {
    droppedFrames: 0,
    lastFrameTime: 0,
    averageFrameTime: 16.67,
    frameCount: 0,
    totalFrameTime: 0
  };

  async initialize(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU adapter not found');
    }

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');
    
    if (!this.context) {
      throw new Error('Failed to get WebGPU context');
    }

    // Configure canvas context
    const format = navigator.gpu?.getPreferredCanvasFormat() || 'bgra8unorm';
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied'
    });

    await this.createShaders();
    await this.createLutTexture();
    
    console.log('[WebGPURenderer] Initialized successfully');
  }

  private async createShaders(): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');

    // Vertex shader
    const vertexShader = this.device.createShaderModule({
      label: 'Tile vertex shader',
      code: `
        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) texCoord: vec2<f32>,
        }

        @vertex
        fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
          // Full-screen quad
          let pos = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>(-1.0,  1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>( 1.0,  1.0),
            vec2<f32>(-1.0,  1.0)
          );
          
          let texCoord = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 1.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(0.0, 0.0)
          );

          var output: VertexOutput;
          output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
          output.texCoord = texCoord[vertexIndex];
          return output;
        }
      `
    });

    // Fragment shader with LUT support
    const fragmentShader = this.device.createShaderModule({
      label: 'Tile fragment shader',
      code: `
        @group(0) @binding(0) var tileTexture: texture_2d<f32>;
        @group(0) @binding(1) var tileSampler: sampler;
        @group(0) @binding(2) var lutTexture: texture_2d<f32>;
        @group(0) @binding(3) var lutSampler: sampler;

        @fragment
        fn fs_main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
          // Sample the tile data
          let tileValue = textureSample(tileTexture, tileSampler, texCoord).r;
          
          // Use tile value to index into LUT
          // LUT is stored as a 1D texture via 2D texture row (y=0.5)
          let lutCoord = vec2<f32>(tileValue, 0.5);
          let color = textureSample(lutTexture, lutSampler, lutCoord);
          
          return vec4<f32>(color.rgb, 1.0);
        }
      `
    });

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Tile bind group layout',
      entries: [
        {
          binding: 0,
          visibility: 2, // FRAGMENT
          texture: { sampleType: 'float' }
        },
        {
          binding: 1,
          visibility: 2, // FRAGMENT
          sampler: {}
        },
        {
          binding: 2,
          visibility: 2, // FRAGMENT
          texture: { sampleType: 'float' }
        },
        {
          binding: 3,
          visibility: 2, // FRAGMENT
          sampler: {}
        }
      ]
    });

    // Create render pipeline
    this.renderPipeline = this.device.createRenderPipeline({
      label: 'Tile render pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      vertex: {
        module: vertexShader,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: fragmentShader,
        entryPoint: 'fs_main',
        targets: [{
          format: navigator.gpu?.getPreferredCanvasFormat() || 'bgra8unorm'
        }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
  }

  private async createLutTexture(): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');

    // Create a 256x1 texture for LUT storage
    this.lutTexture = this.device.createTexture({
      label: 'LUT texture',
      size: [256, 1, 1],
      format: 'rgba8unorm',
      usage: 0x18 // TEXTURE_BINDING | COPY_DST | 0x18 // TEXTURE_BINDING | COPY_DST
    });

    this.lutSampler = this.device.createSampler({
      label: 'LUT sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
  }

  async renderTile(tile: TileData, x: number, y: number, lut: LookupTable): Promise<void> {
    if (!this.device || !this.context || !this.renderPipeline || !this.bindGroupLayout) {
      throw new Error('Renderer not initialized');
    }

    const startTime = performance.now();

    try {
      // Create tile texture based on data type
      const tileTexture = await this.createTileTexture(tile);
      
      // Update LUT texture if needed
      await this.updateLutTexture(lut);

      // Create tile sampler
      const tileSampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
      });

      // Create bind group
      const bindGroup = this.device.createBindGroup({
        label: 'Tile bind group',
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: tileTexture.createView() },
          { binding: 1, resource: tileSampler },
          { binding: 2, resource: this.lutTexture!.createView() },
          { binding: 3, resource: this.lutSampler! }
        ]
      });

      // Record render commands
      const commandEncoder = this.device.createCommandEncoder({
        label: 'Tile render encoder'
      });

      const renderPassDescriptor: any = {
        label: 'Tile render pass',
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      };

      const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(6); // Full-screen quad
      renderPass.end();

      // Submit commands
      this.device.queue.submit([commandEncoder.finish()]);

      // Clean up tile texture
      tileTexture.destroy();

      // Update frame stats
      const frameTime = performance.now() - startTime;
      this.updateFrameStats(frameTime);

    } catch (error) {
      this.frameStats.droppedFrames++;
      throw error;
    }
  }

  private async createTileTexture(tile: TileData): Promise<any> {
    if (!this.device) throw new Error('Device not initialized');

    const { header } = tile;
    let textureFormat: string;
    let data: Uint8Array | Uint16Array | Float32Array;

    // Convert tile data to appropriate format
    switch (header.dtype) {
      case DataType.U8:
      case DataType.MuLawU8:
        textureFormat = 'r8unorm';
        data = tile.payload;
        break;
      
      case DataType.U16:
        textureFormat = 'r16uint';
        data = new Uint16Array(tile.payload.buffer, tile.payload.byteOffset, tile.payload.byteLength / 2);
        break;
      
      case DataType.F32:
        textureFormat = 'r32float';
        data = new Float32Array(tile.payload.buffer, tile.payload.byteOffset, tile.payload.byteLength / 4);
        break;
      
      default:
        throw new Error(`Unsupported data type: ${header.dtype}`);
    }

    // Create texture
    const texture = this.device.createTexture({
      label: 'Tile texture',
      size: [header.tileW, header.tileH, 1],
      format: textureFormat,
      usage: 0x18 // TEXTURE_BINDING | COPY_DST | 0x18 // TEXTURE_BINDING | COPY_DST
    });

    // Upload data using queue.writeTexture (optimal path)
    this.device.queue.writeTexture(
      { texture },
      data,
      {
        bytesPerRow: header.tileW * this.getBytesPerPixel(header.dtype),
        rowsPerImage: header.tileH
      },
      { width: header.tileW, height: header.tileH, depthOrArrayLayers: 1 }
    );

    return texture;
  }

  private async updateLutTexture(lut: LookupTable): Promise<void> {
    if (!this.device || !this.lutTexture) return;

    // Convert LUT data to RGBA8 format for texture
    const lutData = new Uint8Array(256 * 4);
    
    for (let i = 0; i < 256; i++) {
      lutData[i * 4 + 0] = Math.round(lut.data[i * 3 + 0] * 255); // R
      lutData[i * 4 + 1] = Math.round(lut.data[i * 3 + 1] * 255); // G
      lutData[i * 4 + 2] = Math.round(lut.data[i * 3 + 2] * 255); // B
      lutData[i * 4 + 3] = 255; // A
    }

    this.device.queue.writeTexture(
      { texture: this.lutTexture },
      lutData,
      { bytesPerRow: 256 * 4, rowsPerImage: 1 },
      { width: 256, height: 1, depthOrArrayLayers: 1 }
    );
  }

  private getBytesPerPixel(dtype: DataType): number {
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
    // WebGPU clears automatically in render pass
  }

  getFrameStats() {
    return { ...this.frameStats };
  }

  dispose(): void {
    this.lutTexture?.destroy();
    this.device?.destroy();
    
    this.device = null;
    this.context = null;
    this.renderPipeline = null;
    this.lutTexture = null;
    this.lutSampler = null;
    this.bindGroupLayout = null;
  }
}