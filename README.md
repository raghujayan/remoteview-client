# RemoteView Client

Web-based binary-tile streaming seismic viewer client built with React and TypeScript.

## Architecture Overview

The client implements a tiered rendering system with adaptive quality based on device capabilities:

1. **WebGPU** (if available): Best performance, modern GPU compute
2. **WebGL2** (default): Wide compatibility, fragment shader LUTs
3. **CPU** (fallback): WASM + Canvas2D for unsupported devices

## Key Features

- **Real-time tile streaming** via WebRTC DataChannel
- **Three-plane intersection** viewer (inline, crossline, time/depth)
- **Interactive controls** with seismic LUTs, windowing, AGC
- **Adaptive quality** based on network and GPU performance
- **Live HUD** with performance metrics and statistics

## Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run type checking
npm run type-check

# Run tests
npm test

# Run E2E tests
npm run test:e2e
```

## Project Structure

```
src/
├── types/           # TypeScript type definitions
├── protocol/        # Binary tile and JSON control protocol
├── renderer/        # WebGPU/WebGL2/CPU rendering tiers
├── controls/        # UI controls and interaction
├── net/            # WebRTC networking and tile handling  
├── hud/            # Performance overlay and statistics
├── App.tsx         # Main application component
└── main.tsx        # Entry point
```

## Protocol Implementation

Matches server wire protocol exactly:

### Control Messages (JSON over DataChannel)
- `set_slice`: Update intersection point
- `set_view`: Change active plane with drag hints
- `set_lut`: Seismic colormap and windowing
- `quality`: Request data type and downsample level
- `ping/pong`: Latency measurement

### Binary Tiles (24-byte header + payload)
- Compressed LZ4/Zstd tile data
- Multiple data types: u8, u16, f32, μ-law
- Unordered delivery with drop-oldest policy

## Rendering Pipeline

1. **Capability Detection**: Probe WebGPU → WebGL2 → CPU
2. **Tile Assembly**: Decompress and upload to GPU textures
3. **Shader Pipeline**: Apply LUT, windowing, AGC transforms
4. **Three-Plane Display**: Orthogonal slices with crosshair overlay
5. **HUD Overlay**: Performance metrics and controls

## Network Configuration

Development uses SSH port forwarding to remote server:

```bash
ssh -i ~/.ssh/key.pem rocky@10.7.4.116 \
  -L 8443:127.0.0.1:8443 \
  -L 9090:127.0.0.1:9090
```

- **8443**: WebRTC signaling (WSS)
- **9090**: Metrics endpoint

## Seismic LUTs

Built-in color maps:
- **SeismicRWB**: Red-White-Blue (default)
- **Gray**: Grayscale
- **BlueWhiteRed**: Blue-White-Red  
- **Viridis**: Perceptually uniform
- **Turbo**: Google Turbo colormap

## Performance Targets

- **Smooth dragging** on integrated GPU laptops
- **Instant LUT changes** (client-side processing)
- **<250ms** tile arrival latency p95
- **Graceful degradation** on weak hardware

## Testing Strategy

- **Unit tests**: Vitest for protocol, utilities, components
- **E2E tests**: Playwright for full viewer workflow
- **Visual tests**: Offscreen canvas rendering validation
- **Performance tests**: Frame timing and memory usage

## Build Configuration

- **Target**: ES2020 for modern browser support
- **Bundling**: Vite with chunk splitting per renderer
- **TypeScript**: Strict mode with path mapping
- **Optimization**: Tree shaking and dynamic imports