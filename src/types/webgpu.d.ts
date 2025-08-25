/**
 * WebGPU Type Declarations
 * 
 * Basic WebGPU types for TypeScript support
 */

declare global {
  interface Navigator {
    gpu?: GPU;
  }

  interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  }

  interface GPUAdapter {
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
    limits: GPUSupportedLimits;
  }

  interface GPUSupportedLimits {
    maxTextureDimension2D?: number;
  }

  interface GPUDevice {
    createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
    createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
    createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
    createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
    createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
    createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
    createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
    createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
    queue: GPUQueue;
    destroy(): void;
  }

  interface GPUQueue {
    writeTexture(
      destination: GPUImageCopyTexture,
      data: BufferSource,
      dataLayout: GPUImageDataLayout,
      size: GPUExtent3D
    ): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  }

  interface GPUTexture {
    createView(): GPUTextureView;
    destroy(): void;
  }

  interface GPUCanvasContext {
    configure(configuration: GPUCanvasConfiguration): void;
    getCurrentTexture(): GPUTexture;
  }

  interface GPURenderPipeline {}
  interface GPUBindGroupLayout {}
  interface GPUSampler {}
  interface GPUShaderModule {}
  interface GPUPipelineLayout {}
  interface GPUBindGroup {}
  interface GPUCommandEncoder {
    beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
    finish(): GPUCommandBuffer;
  }
  interface GPUCommandBuffer {}
  interface GPUTextureView {}
  interface GPURenderPassEncoder {
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    draw(vertexCount: number): void;
    end(): void;
  }

  // Enums and constants
  type GPUTextureFormat = 
    | 'rgba8unorm' 
    | 'r8unorm' 
    | 'r16uint' 
    | 'r32float'
    | 'bgra8unorm';

  const GPUShaderStage: {
    readonly VERTEX: 1;
    readonly FRAGMENT: 2;
    readonly COMPUTE: 4;
  };

  const GPUTextureUsage: {
    readonly TEXTURE_BINDING: 16;
    readonly COPY_DST: 8;
    readonly RENDER_ATTACHMENT: 16;
  };

  // Descriptor types
  interface GPURequestAdapterOptions {}
  interface GPUDeviceDescriptor {}
  interface GPUShaderModuleDescriptor {
    label?: string;
    code: string;
  }
  interface GPUBindGroupLayoutDescriptor {
    label?: string;
    entries: GPUBindGroupLayoutEntry[];
  }
  interface GPUBindGroupLayoutEntry {
    binding: number;
    visibility: number;
    texture?: { sampleType?: string };
    sampler?: {};
  }
  interface GPURenderPipelineDescriptor {
    label?: string;
    layout: GPUPipelineLayout;
    vertex: {
      module: GPUShaderModule;
      entryPoint: string;
    };
    fragment?: {
      module: GPUShaderModule;
      entryPoint: string;
      targets: { format: GPUTextureFormat }[];
    };
    primitive?: {
      topology: string;
    };
  }
  interface GPUPipelineLayoutDescriptor {
    bindGroupLayouts: GPUBindGroupLayout[];
  }
  interface GPUTextureDescriptor {
    label?: string;
    size: [number, number, number];
    format: GPUTextureFormat;
    usage: number;
  }
  interface GPUSamplerDescriptor {
    label?: string;
    magFilter?: string;
    minFilter?: string;
    addressModeU?: string;
    addressModeV?: string;
  }
  interface GPUBindGroupDescriptor {
    label?: string;
    layout: GPUBindGroupLayout;
    entries: GPUBindGroupEntry[];
  }
  interface GPUBindGroupEntry {
    binding: number;
    resource: GPUTextureView | GPUSampler;
  }
  interface GPUCommandEncoderDescriptor {
    label?: string;
  }
  interface GPUImageCopyTexture {
    texture: GPUTexture;
  }
  interface GPUImageDataLayout {
    bytesPerRow: number;
    rowsPerImage: number;
  }
  interface GPUExtent3D {
    width: number;
    height: number;
    depthOrArrayLayers: number;
  }
  interface GPUCanvasConfiguration {
    device: GPUDevice;
    format: GPUTextureFormat;
    alphaMode?: string;
  }
  interface GPURenderPassDescriptor {
    label?: string;
    colorAttachments: GPURenderPassColorAttachment[];
  }
  interface GPURenderPassColorAttachment {
    view: GPUTextureView;
    clearValue?: { r: number; g: number; b: number; a: number };
    loadOp: string;
    storeOp: string;
  }
}