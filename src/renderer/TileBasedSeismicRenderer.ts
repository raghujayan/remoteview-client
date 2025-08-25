/**
 * TileBasedSeismicRenderer - Professional seismic visualization using streaming tiles
 * 
 * This renderer displays seismic data as 2D textured slices in 3D space,
 * matching industry standards (Petrel, DecisionSpace, OpendTect).
 * Designed for terabyte-scale streaming visualization.
 */

export interface SeismicTile {
  plane: number;           // 0=inline, 1=crossline, 2=time/depth
  sliceIndex: number;      // Position in that plane
  x: number;              // Tile X offset  
  y: number;              // Tile Y offset
  width: number;          // Tile width (typically 256)
  height: number;         // Tile height (typically 256)
  data: Uint8Array;       // Raw 16-bit amplitude data
}

export interface SeismicVolume {
  dimensions: [number, number, number];
  data: Float32Array;
  spacing: [number, number, number];
  origin: [number, number, number];
}

export interface TransferFunction {
  minAmplitude: number;
  maxAmplitude: number;
  clipPercentile: number;
  gain: number;
  agcWindow: number;
}

export class TileBasedSeismicRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  
  // Tile management
  private tileTextures: Map<string, WebGLTexture> = new Map();
  private activePlanes = {
    inline: 1200,    
    crossline: 900,  
    timeslice: 800   
  };
  
  // Survey dimensions (from VDS)
  private surveyDimensions = [1408, 5701, 1600]; // inline, crossline, time
  private surveySpacing = [12.5, 12.5, 4.0];     // meters
  private surveyOrigin = [0, 0, 0];
  
  // Rendering state
  private viewMatrix = new Float32Array(16);
  private projectionMatrix = new Float32Array(16);
  private transferFunction: TransferFunction = {
    minAmplitude: -1.0,
    maxAmplitude: 1.0,
    clipPercentile: 98,
    gain: 1.0,
    agcWindow: 0
  };
  
  // Animation
  private animationId: number | null = null;
  private rotation = 0;

  constructor(canvas: HTMLCanvasElement) {
    console.log('[TileBasedSeismicRenderer] 🚀 Creating tile-based seismic renderer');
    
    this.canvas = canvas;
    
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      depth: true,
      alpha: false,
      premultipliedAlpha: false
    });
    
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    
    this.gl = gl;
    
    // Clear any existing tile cache
    this.tileTextures.clear();
    console.log('[TileBasedSeismicRenderer] 🧹 Cleared tile cache for fresh debugging');
    
    this.initialize();
  }

  private async initialize(): Promise<void> {
    console.log('[TileBasedSeismicRenderer] 🔧 Initializing tile-based renderer...');
    
    const gl = this.gl;
    
    // Enable depth testing and blending
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Set clear color (dark background)
    gl.clearColor(0.05, 0.05, 0.1, 1.0);
    
    // Create shader program
    await this.createShaderProgram();
    
    // Create slice geometry
    this.createSliceGeometry();
    
    // Setup camera matrices
    this.setupCamera();
    
    console.log('[TileBasedSeismicRenderer] ✅ Tile-based renderer initialized');
  }

  private async createShaderProgram(): Promise<void> {
    const gl = this.gl;
    
    const vertexShaderSource = `#version 300 es
      precision highp float;
      
      in vec3 position;
      in vec2 texCoord;
      
      uniform mat4 viewMatrix;
      uniform mat4 projectionMatrix;
      uniform mat4 sliceMatrix; // Position slice in 3D space
      
      out vec2 vTexCoord;
      out vec3 worldPos;
      
      void main() {
        vTexCoord = texCoord;
        
        // Transform slice to world position
        vec4 worldPosition = sliceMatrix * vec4(position, 1.0);
        worldPos = worldPosition.xyz;
        
        // Project to screen
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;
    
    const fragmentShaderSource = `#version 300 es
      precision highp float;
      
      in vec2 vTexCoord;
      in vec3 worldPos;
      
      uniform sampler2D seismicTexture;
      uniform float gain;
      uniform float minAmplitude;
      uniform float maxAmplitude;
      uniform int plane;
      uniform float sliceIndex;
      
      out vec4 fragColor;
      
      void main() {
        // Sample seismic amplitude
        float amplitude = texture(seismicTexture, vTexCoord).r;
        
        // Professional seismic visualization 
        vec3 color;
        
        // WORKING VDS DATA VISUALIZATION - NO ARITHMETIC
        vec4 texSample = texture(seismicTexture, vTexCoord);
        color = texSample.rgb;
        
        // Full opacity
        fragColor = vec4(color, 1.0);
      }
    `;
    
    // Compile shaders
    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    if (!vertexShader || !fragmentShader) {
      throw new Error('Failed to compile shaders');
    }
    
    // Create program
    this.program = gl.createProgram();
    if (!this.program) {
      throw new Error('Failed to create shader program');
    }
    
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(this.program);
      throw new Error(`Failed to link shader program: ${error}`);
    }
    
    // Clean up
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    
    console.log('[TileBasedSeismicRenderer] ✅ Shader program created');
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      console.error(`Shader compilation error: ${error}`);
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }

  private createSliceGeometry(): void {
    const gl = this.gl;
    
    // Create a quad (2 triangles) for rendering seismic slices
    const vertices = new Float32Array([
      // Position (x,y,z)    // TexCoord (u,v)
      -1.0, -1.0, 0.0,       0.0, 0.0,  // Bottom-left
       1.0, -1.0, 0.0,       1.0, 0.0,  // Bottom-right
       1.0,  1.0, 0.0,       1.0, 1.0,  // Top-right
      -1.0,  1.0, 0.0,       0.0, 1.0   // Top-left
    ]);
    
    const indices = new Uint16Array([
      0, 1, 2,  // First triangle
      0, 2, 3   // Second triangle
    ]);
    
    // Create VAO
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    
    // Create vertex buffer
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    
    // Create index buffer
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    
    // Setup vertex attributes
    // Position attribute (location 0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 5 * Float32Array.BYTES_PER_ELEMENT, 0);
    gl.enableVertexAttribArray(0);
    
    // Texture coordinate attribute (location 1)  
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 5 * Float32Array.BYTES_PER_ELEMENT, 3 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(1);
    
    gl.bindVertexArray(null);
    
    console.log('[TileBasedSeismicRenderer] ✅ Slice geometry created');
  }

  private setupCamera(): void {
    // Setup perspective projection
    const aspect = this.canvas.width / this.canvas.height;
    this.createPerspectiveMatrix(this.projectionMatrix, Math.PI / 4, aspect, 0.1, 1000.0);
    
    // Setup initial camera position
    this.updateCamera();
    
    console.log('[TileBasedSeismicRenderer] ✅ Camera setup complete');
  }

  private updateCamera(): void {
    // Camera orbits around the seismic volume - much closer for better visibility
    const distance = 500; // meters - much closer
    const height = 300;   // meters above center
    
    const eye = [
      Math.cos(this.rotation) * distance,
      height,
      Math.sin(this.rotation) * distance
    ];
    
    // Center the view on a smaller area for testing
    const center = [
      100,  // Focus on a smaller area
      100,  // Focus on a smaller area
      100   // Focus on a smaller area
    ];
    
    const up = [0, 1, 0];
    
    this.createLookAtMatrix(this.viewMatrix, eye, center, up);
    
    // Log camera position occasionally for debugging
    if (Math.floor(this.rotation * 100) % 100 === 0) {
      console.log('[TileBasedSeismicRenderer] 📷 Camera position:', {
        eye: eye,
        center: center,
        rotation: this.rotation.toFixed(2)
      });
    }
  }

  // Drop-in replacement interface methods (same as SeismicVolumeRenderer)
  public updateVolume(volume: SeismicVolume): void {
    console.log('[TileBasedSeismicRenderer] 📊 Volume update (ignored - using tiles instead)');
    // This method exists for compatibility but tiles are processed directly
  }

  public updateTransferFunction(tf: TransferFunction): void {
    this.transferFunction = { ...tf };
    console.log('[TileBasedSeismicRenderer] 🎨 Transfer function updated:', tf);
  }

  // NEW: Direct tile processing method
  public renderTile(tile: SeismicTile): void {
    console.log('[TileBasedSeismicRenderer] 🎯 Processing tile:', {
      plane: tile.plane,
      slice: tile.sliceIndex,
      size: `${tile.width}x${tile.height}`,
      dataBytes: tile.data.length
    });
    
    const tileKey = `${tile.plane}-${tile.sliceIndex}`;
    
    // ALWAYS recreate texture to see debug logs
    if (this.tileTextures.has(tileKey)) {
      const oldTexture = this.tileTextures.get(tileKey);
      if (oldTexture) {
        this.gl.deleteTexture(oldTexture);
      }
    }
    
    // Convert 16-bit seismic data to texture (always recreate for debugging)
    console.log('[TileBasedSeismicRenderer] 🔄 Recreating texture for debugging...');
    const texture = this.createSeismicTexture(tile);
    
    this.tileTextures.set(tileKey, texture);
    
    // Update active plane slices
    if (tile.plane === 0) this.activePlanes.inline = tile.sliceIndex;
    if (tile.plane === 1) this.activePlanes.crossline = tile.sliceIndex;
    if (tile.plane === 2) this.activePlanes.timeslice = tile.sliceIndex;
    
    console.log('[TileBasedSeismicRenderer] ✅ Tile texture created and cached');
  }

  private createSeismicTexture(tile: SeismicTile): WebGLTexture {
    const gl = this.gl;
    
    console.log('[TileBasedSeismicRenderer] 🔧 Creating texture from VDS data:', {
      size: `${tile.width}x${tile.height}`,
      dataLength: tile.data.length,
      expectedBytes: tile.width * tile.height * 2
    });
    
    // PROCESS REAL VDS SEISMIC DATA 
    console.log('[TileBasedSeismicRenderer] 🎯 PROCESSING REAL VDS SEISMIC DATA');
    const amplitudes = new Float32Array(tile.width * tile.height);
    let nonZeroCount = 0;
    let minAmp = Infinity, maxAmp = -Infinity;
    
    for (let i = 0; i < tile.width * tile.height; i++) {
      const byteIndex = i * 2;
      
      if (byteIndex + 1 >= tile.data.length) {
        console.warn('[TileBasedSeismicRenderer] Data underrun at sample', i);
        amplitudes[i] = 0.0;
        continue;
      }
      
      // Read 16-bit little-endian amplitude
      const amplitude16 = tile.data[byteIndex] | (tile.data[byteIndex + 1] << 8);
      const signedAmplitude = amplitude16 > 32767 ? amplitude16 - 65536 : amplitude16;
      
      // Normalize to -1 to +1 range
      const normalizedAmplitude = signedAmplitude / 32768.0;
      amplitudes[i] = normalizedAmplitude;
      
      // Track statistics
      if (signedAmplitude !== 0) {
        nonZeroCount++;
        minAmp = Math.min(minAmp, normalizedAmplitude);
        maxAmp = Math.max(maxAmp, normalizedAmplitude);
      }
    }
    
    console.log('[TileBasedSeismicRenderer] 📊 VDS AMPLITUDE ANALYSIS:', {
      nonZeroSamples: nonZeroCount,
      totalSamples: amplitudes.length,
      amplitudeRange: `${minAmp.toFixed(6)} to ${maxAmp.toFixed(6)}`,
      firstRawBytes: Array.from(tile.data.slice(0, 20)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
      firstAmplitudes: Array.from(amplitudes.slice(0, 10)).map(a => a.toFixed(6)),
      nonZeroPercent: `${(nonZeroCount / amplitudes.length * 100).toFixed(1)}%`
    });
    
    // Create WebGL texture
    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to create texture');
    
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    // USE SIMPLEST TEXTURE FORMAT - RGBA UNSIGNED_BYTE
    const rgbaData = new Uint8Array(tile.width * tile.height * 4);
    for (let i = 0; i < amplitudes.length; i++) {
      const byteValue = Math.floor((amplitudes[i] + 1.0) * 127.5); // Map 0..1 to 0..255
      rgbaData[i * 4] = byteValue;     // R
      rgbaData[i * 4 + 1] = byteValue; // G
      rgbaData[i * 4 + 2] = byteValue; // B
      rgbaData[i * 4 + 3] = 255;       // A
    }
    
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,           // Simple RGBA
      tile.width,
      tile.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,  // Basic unsigned byte
      rgbaData
    );
    
    console.log('[TileBasedSeismicRenderer] ✅ RGBA UNSIGNED_BYTE texture uploaded:', {
      format: 'RGBA/UNSIGNED_BYTE',
      firstPixel: [rgbaData[0], rgbaData[1], rgbaData[2], rgbaData[3]],
      testPattern: 'Gradient 0-255'
    });
    
    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // Check for WebGL errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error('[TileBasedSeismicRenderer] WebGL error creating texture:', error);
    }
    
    return texture;
  }

  public startAnimation(): void {
    console.log('[TileBasedSeismicRenderer] 🎬 Starting animation loop');
    
    const animate = () => {
      this.rotation += 0.005; // Slow rotation
      this.render();
      this.animationId = requestAnimationFrame(animate);
    };
    
    animate();
  }

  private render(): void {
    const gl = this.gl;
    
    if (!this.program || !this.vao) {
      console.warn('[TileBasedSeismicRenderer] Missing program or VAO, skipping render');
      return;
    }
    
    // Update camera
    this.updateCamera();
    
    // Clear frame
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Use shader program
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    
    // Set camera uniforms
    const viewLocation = gl.getUniformLocation(this.program, 'viewMatrix');
    const projLocation = gl.getUniformLocation(this.program, 'projectionMatrix');
    gl.uniformMatrix4fv(viewLocation, false, this.viewMatrix);
    gl.uniformMatrix4fv(projLocation, false, this.projectionMatrix);
    
    // Set transfer function uniforms
    const gainLocation = gl.getUniformLocation(this.program, 'gain');
    const minAmpLocation = gl.getUniformLocation(this.program, 'minAmplitude');
    const maxAmpLocation = gl.getUniformLocation(this.program, 'maxAmplitude');
    gl.uniform1f(gainLocation, this.transferFunction.gain);
    gl.uniform1f(minAmpLocation, this.transferFunction.minAmplitude);
    gl.uniform1f(maxAmpLocation, this.transferFunction.maxAmplitude);
    
    // Silent rendering - no spam
    
    // Render all available slices
    this.renderAvailableSlices();
    
    gl.bindVertexArray(null);
    
    // Check for WebGL errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error('[TileBasedSeismicRenderer] WebGL error during render:', error);
    }
  }

  private renderAvailableSlices(): void {
    const gl = this.gl;
    
    // SIMPLIFIED: Just render the tiles we actually have
    this.tileTextures.forEach((texture, key) => {
      const [planeStr, sliceStr] = key.split('-');
      const plane = parseInt(planeStr);
      const slice = parseInt(sliceStr);
      
      this.renderSliceType(plane, `plane${plane}`, slice);
    });
  }

  private renderSliceType(plane: number, planeName: string, sliceIndex: number): void {
    const gl = this.gl;
    const tileKey = `${plane}-${sliceIndex}`;
    const texture = this.tileTextures.get(tileKey);
    
    console.log('[TileBasedSeismicRenderer] 🔍 RENDER LOOKUP:', {
      plane,
      sliceIndex,
      tileKey,
      textureFound: !!texture,
      totalCachedTextures: this.tileTextures.size,
      cachedKeys: Array.from(this.tileTextures.keys())
    });
    
    if (!texture) {
      console.log('[TileBasedSeismicRenderer] ❌ MISSING TEXTURE for key:', tileKey);
      return;
    }
    
    // Bind seismic texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const textureLocation = gl.getUniformLocation(this.program, 'seismicTexture');
    gl.uniform1i(textureLocation, 0);
    
    // Set slice-specific uniforms
    const planeLocation = gl.getUniformLocation(this.program, 'plane');
    const sliceLocation = gl.getUniformLocation(this.program, 'sliceIndex');
    gl.uniform1i(planeLocation, plane);
    gl.uniform1f(sliceLocation, sliceIndex);
    
    // Calculate slice transformation matrix - SIMPLIFIED FOR TESTING
    const sliceMatrix = new Float32Array(16);
    this.createIdentityMatrix(sliceMatrix);
    
    // Position slices near camera center (100, 100, 100)
    switch (plane) {
      case 0: // Inline - place in front of camera
        sliceMatrix[12] = 100;  // X position (camera center)
        sliceMatrix[13] = 100;  // Y position (camera center)
        sliceMatrix[14] = 100;  // Z position (camera center)
        sliceMatrix[0] = 50;    // X scale
        sliceMatrix[5] = 50;    // Y scale
        sliceMatrix[10] = 1;    // Z scale
        break;
        
      case 1: // Crossline - place in front of camera  
        sliceMatrix[12] = 100;  // X position (camera center)
        sliceMatrix[13] = 100;  // Y position (camera center)
        sliceMatrix[14] = 100;  // Z position (camera center)
        sliceMatrix[0] = 50;    // X scale
        sliceMatrix[5] = 50;    // Y scale
        sliceMatrix[10] = 1;    // Z scale
        break;
        
      case 2: // Time slice - place in front of camera
        sliceMatrix[12] = 100;  // X position (camera center)
        sliceMatrix[13] = 100;  // Y position (camera center)
        sliceMatrix[14] = 100;  // Z position (camera center)
        sliceMatrix[0] = 50;    // X scale
        sliceMatrix[5] = 1;     // Y scale
        sliceMatrix[10] = 50;   // Z scale
        break;
    }
    
    const matrixLocation = gl.getUniformLocation(this.program, 'sliceMatrix');
    gl.uniformMatrix4fv(matrixLocation, false, sliceMatrix);
    
    // VERIFY BEFORE DRAWING
    console.log('[TileBasedSeismicRenderer] 🎨 DRAWING SLICE:', {
      plane,
      sliceIndex,
      texturebound: !!texture,
      vaoActive: !!this.vao,
      programActive: !!this.program
    });
    
    // Draw the slice
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    
    // Check for draw errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error(`[TileBasedSeismicRenderer] WebGL error drawing ${planeName}:`, error);
    }
  }

  private createSliceMatrix(matrix: Float32Array, plane: number, sliceIndex: number): void {
    // Create identity matrix
    this.createIdentityMatrix(matrix);
    
    // Scale to survey dimensions
    const scaleX = this.surveyDimensions[0] * this.surveySpacing[0];
    const scaleY = this.surveyDimensions[2] * this.surveySpacing[2]; 
    const scaleZ = this.surveyDimensions[1] * this.surveySpacing[1];
    
    // Position slice based on plane type
    let translation = [0, 0, 0];
    let rotation = [0, 0, 0];
    let scale = [1, 1, 1];
    
    switch (plane) {
      case 0: // Inline plane (YZ plane)
        translation = [sliceIndex * this.surveySpacing[0], scaleY * 0.5, scaleZ * 0.5];
        rotation = [0, Math.PI / 2, 0]; // Rotate to YZ plane
        scale = [1, scaleY, scaleZ];
        break;
        
      case 1: // Crossline plane (XZ plane)  
        translation = [scaleX * 0.5, scaleY * 0.5, sliceIndex * this.surveySpacing[1]];
        rotation = [0, 0, 0]; // Already in XZ orientation
        scale = [scaleX, scaleY, 1];
        break;
        
      case 2: // Time slice (XY plane)
        translation = [scaleX * 0.5, sliceIndex * this.surveySpacing[2], scaleZ * 0.5];
        rotation = [Math.PI / 2, 0, 0]; // Rotate to XY plane
        scale = [scaleX, 1, scaleZ];
        break;
    }
    
    // Apply transformations
    this.applyTransforms(matrix, translation, rotation, scale);
  }

  public dispose(): void {
    console.log('[TileBasedSeismicRenderer] 🧹 Disposing renderer');
    
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    const gl = this.gl;
    
    // Delete all tile textures
    this.tileTextures.forEach(texture => gl.deleteTexture(texture));
    this.tileTextures.clear();
    
    // Delete WebGL resources
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }

  // Matrix utility methods
  private createIdentityMatrix(matrix: Float32Array): void {
    matrix.fill(0);
    matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
  }

  private createPerspectiveMatrix(matrix: Float32Array, fovy: number, aspect: number, near: number, far: number): void {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    
    matrix.fill(0);
    matrix[0] = f / aspect;
    matrix[5] = f;
    matrix[10] = (far + near) * nf;
    matrix[11] = -1;
    matrix[14] = 2 * far * near * nf;
  }

  private createLookAtMatrix(matrix: Float32Array, eye: number[], center: number[], up: number[]): void {
    const ex = eye[0], ey = eye[1], ez = eye[2];
    const cx = center[0], cy = center[1], cz = center[2];
    const ux = up[0], uy = up[1], uz = up[2];
    
    // Forward vector
    const fx = cx - ex, fy = cy - ey, fz = cz - ez;
    const flen = Math.sqrt(fx*fx + fy*fy + fz*fz);
    const fnx = fx/flen, fny = fy/flen, fnz = fz/flen;
    
    // Right vector  
    const rx = fny*uz - fnz*uy, ry = fnz*ux - fnx*uz, rz = fnx*uy - fny*ux;
    const rlen = Math.sqrt(rx*rx + ry*ry + rz*rz);
    const rnx = rx/rlen, rny = ry/rlen, rnz = rz/rlen;
    
    // Up vector
    const upx = rny*fnz - rnz*fny, upy = rnz*fnx - rnx*fnz, upz = rnx*fny - rny*fnx;
    
    matrix[0] = rnx; matrix[1] = upx; matrix[2] = -fnx; matrix[3] = 0;
    matrix[4] = rny; matrix[5] = upy; matrix[6] = -fny; matrix[7] = 0;  
    matrix[8] = rnz; matrix[9] = upz; matrix[10] = -fnz; matrix[11] = 0;
    matrix[12] = -(rnx*ex + rny*ey + rnz*ez);
    matrix[13] = -(upx*ex + upy*ey + upz*ez);
    matrix[14] = fnx*ex + fny*ey + fnz*ez;
    matrix[15] = 1;
  }

  private applyTransforms(matrix: Float32Array, translation: number[], rotation: number[], scale: number[]): void {
    // Apply translation
    matrix[12] = translation[0];
    matrix[13] = translation[1]; 
    matrix[14] = translation[2];
    
    // Apply scale
    matrix[0] *= scale[0];
    matrix[5] *= scale[1];
    matrix[10] *= scale[2];
    
    // Apply rotation (simplified - would need full rotation matrices for complex rotations)
    // For now, just basic rotations around axes
  }
}