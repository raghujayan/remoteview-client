/**
 * RemoteView WebGL2 Renderer
 * 
 * WebGL2 renderer using 1D LUT via 2D texture row technique.
 * Maps seismic amplitudes to colors using texelFetch or texture2D with v.y=0.5.
 */

import { TileData, DataType, LookupTable } from '../types';
import { BaseRenderer } from './BaseRenderer';

export class WebGL2Renderer extends BaseRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private lutTexture: WebGLTexture | null = null;
  private currentLut: string | null = null;
  
  private frameStats = {
    droppedFrames: 0,
    lastFrameTime: 0,
    averageFrameTime: 16.67,
    frameCount: 0,
    totalFrameTime: 0
  };

  async initialize(): Promise<void> {
    this.gl = this.canvas.getContext('webgl2');
    
    if (!this.gl) {
      throw new Error('WebGL2 not supported');
    }

    // Check for required extensions
    const requiredExtensions = ['EXT_color_buffer_float', 'OES_texture_float_linear'];
    for (const ext of requiredExtensions) {
      if (!this.gl.getExtension(ext)) {
        console.warn(`[WebGL2Renderer] Extension ${ext} not available`);
      }
    }

    await this.createShaders();
    await this.createBuffers();
    await this.createLutTexture();
    
    // Set initial viewport
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    console.log('[WebGL2Renderer] Initialized successfully');
  }

  private async createShaders(): Promise<void> {
    if (!this.gl) throw new Error('WebGL2 context not available');

    // Vertex shader - simple full-screen quad
    const vertexShaderSource = `#version 300 es
      in vec2 a_position;
      in vec2 a_texCoord;
      
      out vec2 v_texCoord;
      
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    // Fragment shader with 1D LUT via 2D texture row technique
    const fragmentShaderSource = `#version 300 es
      precision highp float;
      
      in vec2 v_texCoord;
      out vec4 outColor;
      
      uniform sampler2D u_tileTexture;
      uniform sampler2D u_lutTexture;
      uniform vec2 u_lutRange;
      
      void main() {
        // Sample the tile data (single channel amplitude)
        float amplitude = texture(u_tileTexture, v_texCoord).r;
        
        // Normalize amplitude to LUT range [0, 1]
        float normalizedAmplitude = (amplitude - u_lutRange.x) / (u_lutRange.y - u_lutRange.x);
        normalizedAmplitude = clamp(normalizedAmplitude, 0.0, 1.0);
        
        // Use 1D LUT via 2D texture row technique (y=0.5)
        // This maps amplitudes to colors using the LUT stored in row 0
        vec2 lutCoord = vec2(normalizedAmplitude, 0.5);
        vec3 color = texture(u_lutTexture, lutCoord).rgb;
        
        outColor = vec4(color, 1.0);
      }
    `;

    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

    // Create and link program
    this.program = this.gl.createProgram();
    if (!this.program) {
      throw new Error('Failed to create shader program');
    }

    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      const error = this.gl.getProgramInfoLog(this.program);
      throw new Error(`Shader program link error: ${error}`);
    }

    // Clean up shaders
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);
  }

  private createShader(type: number, source: string): WebGLShader {
    if (!this.gl) throw new Error('WebGL2 context not available');

    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create shader');
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const error = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${error}`);
    }

    return shader;
  }

  private async createBuffers(): Promise<void> {
    if (!this.gl || !this.program) throw new Error('WebGL2 not initialized');

    // Create vertex array object
    this.vao = this.gl.createVertexArray();
    if (!this.vao) {
      throw new Error('Failed to create VAO');
    }
    
    this.gl.bindVertexArray(this.vao);

    // Full-screen quad vertices
    const vertices = new Float32Array([
      // Position    // TexCoord
      -1.0, -1.0,    0.0, 0.0,
       1.0, -1.0,    1.0, 0.0,
      -1.0,  1.0,    0.0, 1.0,
       1.0,  1.0,    1.0, 1.0
    ]);

    const indices = new Uint16Array([
      0, 1, 2,
      1, 3, 2
    ]);

    // Create and bind vertex buffer
    const vertexBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

    // Create and bind index buffer
    const indexBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);

    // Set up vertex attributes
    const positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
    const texCoordLocation = this.gl.getAttribLocation(this.program, 'a_texCoord');

    this.gl.enableVertexAttribArray(positionLocation);
    this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 4 * 4, 0);

    this.gl.enableVertexAttribArray(texCoordLocation);
    this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 4 * 4, 2 * 4);

    this.gl.bindVertexArray(null);
  }

  private async createLutTexture(): Promise<void> {
    if (!this.gl) throw new Error('WebGL2 context not available');

    this.lutTexture = this.gl.createTexture();
    if (!this.lutTexture) {
      throw new Error('Failed to create LUT texture');
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.lutTexture);
    
    // Set texture parameters for 1D LUT via 2D texture row
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    // Create initial empty texture (256x1 for LUT)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGB8,
      256,
      1,
      0,
      this.gl.RGB,
      this.gl.UNSIGNED_BYTE,
      null
    );

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  async renderTile(tile: TileData, x: number, y: number, lut: LookupTable): Promise<void> {
    if (!this.gl || !this.program || !this.vao) {
      throw new Error('Renderer not initialized');
    }

    const startTime = performance.now();

    try {
      // Create tile texture
      const tileTexture = await this.createTileTexture(tile);
      
      // Update LUT texture if needed
      if (this.currentLut !== lut.name) {
        await this.updateLutTexture(lut);
        this.currentLut = lut.name;
      }

      // Use shader program
      this.gl.useProgram(this.program);

      // Bind vertex array
      this.gl.bindVertexArray(this.vao);

      // Bind textures
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, tileTexture);
      
      this.gl.activeTexture(this.gl.TEXTURE1);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.lutTexture);

      // Set uniforms
      const tileTextureLocation = this.gl.getUniformLocation(this.program, 'u_tileTexture');
      const lutTextureLocation = this.gl.getUniformLocation(this.program, 'u_lutTexture');
      const lutRangeLocation = this.gl.getUniformLocation(this.program, 'u_lutRange');

      this.gl.uniform1i(tileTextureLocation, 0);
      this.gl.uniform1i(lutTextureLocation, 1);
      this.gl.uniform2f(lutRangeLocation, lut.range[0], lut.range[1]);

      // Clear and draw
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

      // Clean up tile texture
      this.gl.deleteTexture(tileTexture);

      // Update frame stats
      const frameTime = performance.now() - startTime;
      this.updateFrameStats(frameTime);

    } catch (error) {
      this.frameStats.droppedFrames++;
      throw error;
    }
  }

  private async createTileTexture(tile: TileData): Promise<WebGLTexture> {
    if (!this.gl) throw new Error('WebGL2 context not available');

    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create tile texture');
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

    // Set texture parameters
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    const { header, payload } = tile;
    
    // Upload texture data based on data type
    switch (header.dtype) {
      case DataType.U8:
      case DataType.MuLawU8:
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.R8,
          header.tileW,
          header.tileH,
          0,
          this.gl.RED,
          this.gl.UNSIGNED_BYTE,
          payload
        );
        break;

      case DataType.U16:
        const uint16Data = new Uint16Array(payload.buffer, payload.byteOffset, payload.byteLength / 2);
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.R16UI,
          header.tileW,
          header.tileH,
          0,
          this.gl.RED_INTEGER,
          this.gl.UNSIGNED_SHORT,
          uint16Data
        );
        break;

      case DataType.F32:
        const float32Data = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.R32F,
          header.tileW,
          header.tileH,
          0,
          this.gl.RED,
          this.gl.FLOAT,
          float32Data
        );
        break;

      default:
        throw new Error(`Unsupported data type: ${header.dtype}`);
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    return texture;
  }

  private async updateLutTexture(lut: LookupTable): Promise<void> {
    if (!this.gl || !this.lutTexture) return;

    // Convert LUT data to RGB8 format
    const lutData = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      lutData[i * 3 + 0] = Math.round(lut.data[i * 3 + 0] * 255);
      lutData[i * 3 + 1] = Math.round(lut.data[i * 3 + 1] * 255);
      lutData[i * 3 + 2] = Math.round(lut.data[i * 3 + 2] * 255);
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.lutTexture);
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      0, 0,
      256, 1,
      this.gl.RGB,
      this.gl.UNSIGNED_BYTE,
      lutData
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
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
    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
    }
  }

  clear(): void {
    if (this.gl) {
      this.gl.clearColor(0, 0, 0, 1);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }

  getFrameStats() {
    return { ...this.frameStats };
  }

  dispose(): void {
    if (this.gl) {
      if (this.lutTexture) {
        this.gl.deleteTexture(this.lutTexture);
      }
      if (this.program) {
        this.gl.deleteProgram(this.program);
      }
      if (this.vao) {
        this.gl.deleteVertexArray(this.vao);
      }
    }

    this.gl = null;
    this.program = null;
    this.vao = null;
    this.lutTexture = null;
    this.currentLut = null;
  }
}