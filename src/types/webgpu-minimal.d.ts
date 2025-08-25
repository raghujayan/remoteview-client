/**
 * Minimal WebGPU Type Definitions for RemoteView Client
 * 
 * Only the types we actually use to avoid conflicts
 */

declare global {
  interface Navigator {
    gpu?: {
      requestAdapter(options?: any): Promise<any>;
      getPreferredCanvasFormat(): string;
    };
  }
}

// Empty export to make this a module
export {};