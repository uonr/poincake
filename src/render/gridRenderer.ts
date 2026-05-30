import type { DiskTransform } from '../geometry/mobius';
import type { AnchoredGrid } from '../grid/anchoredGrid';
import type { GridPoint } from '../grid/hyperbolicTiling';
import type { Viewport } from './viewport';

// Drawn almost to the boundary; the tiling itself only extends to 0.99985.
const GRID_DRAW_RADIUS2 = 0.9985 * 0.9985;
const GRID_ALPHA = 0.62;
const GRID_MIN_SIZE = 0.9;
const GRID_SIZE_FACTOR = 1.85;
// Full alpha across the interior, softened only over a thin outer rim.
const GRID_FADE_START = 0.86;
const GRID_FADE_END = 0.997;

// All grid-local points live in a static buffer; each frame only the uniforms change.
// The vertex shader applies the Möbius transform f(z) = (a*z + b)/(conj(b)*z + conj(a))
// and projects to clip space, collapsing culled points to an offscreen zero-size sprite.
const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_point;
uniform vec2 u_a;
uniform vec2 u_b;
uniform vec2 u_scale;
uniform float u_dpr;
uniform float u_maxRadius2;
uniform float u_fadeStart;
uniform float u_fadeEnd;
uniform float u_minSize;
uniform float u_sizeFactor;
out float v_fade;
void main() {
  vec2 z = a_point;
  vec2 num = vec2(u_a.x * z.x - u_a.y * z.y + u_b.x,
                  u_a.x * z.y + u_a.y * z.x + u_b.y);
  vec2 den = vec2(u_b.x * z.x + u_b.y * z.y + u_a.x,
                  u_b.x * z.y - u_b.y * z.x - u_a.y);
  float d2 = den.x * den.x + den.y * den.y;
  if (d2 < 1e-12) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_fade = 0.0;
    return;
  }
  vec2 t = vec2((num.x * den.x + num.y * den.y) / d2,
                (num.y * den.x - num.x * den.y) / d2);
  float r2 = t.x * t.x + t.y * t.y;
  if (r2 > u_maxRadius2) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_fade = 0.0;
    return;
  }
  v_fade = 1.0 - smoothstep(u_fadeStart, u_fadeEnd, sqrt(r2));
  float radius = max(u_minSize, (1.0 - r2) * u_sizeFactor);
  gl_PointSize = radius * 2.0 * u_dpr;
  gl_Position = vec4(t.x * u_scale.x, -t.y * u_scale.y, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in float v_fade;
uniform vec3 u_color;
uniform float u_alpha;
out vec4 fragColor;
void main() {
  vec2 offset = gl_PointCoord - vec2(0.5);
  float dist = length(offset) * 2.0;
  float aa = fwidth(dist);
  float coverage = 1.0 - smoothstep(1.0 - aa, 1.0, dist);
  if (coverage <= 0.0) {
    discard;
  }
  float alpha = u_alpha * v_fade * coverage;
  // Premultiplied output, paired with blendFunc(ONE, ONE_MINUS_SRC_ALPHA).
  fragColor = vec4(u_color * alpha, alpha);
}`;

type Uniforms = Readonly<{
  a: WebGLUniformLocation;
  b: WebGLUniformLocation;
  scale: WebGLUniformLocation;
  dpr: WebGLUniformLocation;
  maxRadius2: WebGLUniformLocation;
  fadeStart: WebGLUniformLocation;
  fadeEnd: WebGLUniformLocation;
  minSize: WebGLUniformLocation;
  sizeFactor: WebGLUniformLocation;
  color: WebGLUniformLocation;
  alpha: WebGLUniformLocation;
}>;

export class GridRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly uniforms: Uniforms;

  private uploadedPoints: readonly GridPoint[] | null = null;
  private pointCount = 0;
  private colorCacheKey = '';
  private colorRgb: readonly [number, number, number] = [0.53, 0.53, 0.53];

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    if (!gl) {
      throw new Error('WebGL2 is not available.');
    }
    this.gl = gl;

    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    this.uniforms = this.locateUniforms(this.program);

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) {
      throw new Error('Failed to allocate WebGL grid buffers.');
    }
    this.vao = vao;
    this.buffer = buffer;

    const location = gl.getAttribLocation(this.program, 'a_point');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  // Releases the GL objects. Not loseContext: StrictMode remounts reuse this
  // canvas's context, and a fresh GridRenderer rebuilds its own program/buffers.
  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  draw(grid: AnchoredGrid, view: DiskTransform, viewport: Viewport, color: string): void {
    const gl = this.gl;
    this.ensurePoints(grid.tiling.coarseGridPoints);
    this.resize(viewport);

    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.pointCount === 0) {
      return;
    }

    const worldView = grid.worldView(view);
    const rgb = this.resolveColor(color);
    const uniforms = this.uniforms;

    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook.
    gl.useProgram(this.program);
    gl.uniform2f(uniforms.a, worldView.a[0], worldView.a[1]);
    gl.uniform2f(uniforms.b, worldView.b[0], worldView.b[1]);
    gl.uniform2f(uniforms.scale, viewport.radius / viewport.cx, viewport.radius / viewport.cy);
    gl.uniform1f(uniforms.dpr, window.devicePixelRatio || 1);
    gl.uniform1f(uniforms.maxRadius2, GRID_DRAW_RADIUS2);
    gl.uniform1f(uniforms.fadeStart, GRID_FADE_START);
    gl.uniform1f(uniforms.fadeEnd, GRID_FADE_END);
    gl.uniform1f(uniforms.minSize, GRID_MIN_SIZE);
    gl.uniform1f(uniforms.sizeFactor, GRID_SIZE_FACTOR);
    gl.uniform3f(uniforms.color, rgb[0], rgb[1], rgb[2]);
    gl.uniform1f(uniforms.alpha, GRID_ALPHA);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.pointCount);
    gl.bindVertexArray(null);
  }

  private resize(viewport: Viewport): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(viewport.width * dpr);
    const targetHeight = Math.round(viewport.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  private ensurePoints(points: readonly GridPoint[]): void {
    if (this.uploadedPoints === points) {
      return;
    }

    const data = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]?.point;
      if (!point) {
        continue;
      }
      data[i * 2] = point[0];
      data[i * 2 + 1] = point[1];
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.uploadedPoints = points;
    this.pointCount = points.length;
  }

  private resolveColor(color: string): readonly [number, number, number] {
    if (color !== this.colorCacheKey) {
      this.colorCacheKey = color;
      this.colorRgb = parseColor(color) ?? this.colorRgb;
    }
    return this.colorRgb;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) {
      throw new Error('Failed to create WebGL program.');
    }

    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      throw new Error(`Failed to link grid shader program: ${log ?? 'unknown error'}`);
    }

    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create WebGL shader.');
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Failed to compile grid shader: ${log ?? 'unknown error'}`);
    }

    return shader;
  }

  private locateUniforms(program: WebGLProgram): Uniforms {
    const gl = this.gl;
    const locate = (name: string): WebGLUniformLocation => {
      const location = gl.getUniformLocation(program, name);
      if (!location) {
        throw new Error(`Missing uniform ${name} in grid shader.`);
      }
      return location;
    };

    return {
      a: locate('u_a'),
      b: locate('u_b'),
      scale: locate('u_scale'),
      dpr: locate('u_dpr'),
      maxRadius2: locate('u_maxRadius2'),
      fadeStart: locate('u_fadeStart'),
      fadeEnd: locate('u_fadeEnd'),
      minSize: locate('u_minSize'),
      sizeFactor: locate('u_sizeFactor'),
      color: locate('u_color'),
      alpha: locate('u_alpha'),
    };
  }
}

// Parse the CSS color forms --grid can yield (#rgb, #rrggbb, rgb()/rgba()) into
// 0..1 RGB; null on anything else so the caller keeps the previous color.
const parseColor = (color: string): readonly [number, number, number] | null => {
  const value = color.trim();

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex.charAt(0).repeat(2), 16);
      const g = Number.parseInt(hex.charAt(1).repeat(2), 16);
      const b = Number.parseInt(hex.charAt(2).repeat(2), 16);
      return [r / 255, g / 255, b / 255];
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return [r / 255, g / 255, b / 255];
    }
    return null;
  }

  const match = value.match(/rgba?\(([^)]+)\)/i);
  const body = match?.[1];
  if (body) {
    const [r, g, b] = body.split(',').map((part) => Number.parseFloat(part.trim()));
    if (
      r !== undefined &&
      g !== undefined &&
      b !== undefined &&
      Number.isFinite(r) &&
      Number.isFinite(g) &&
      Number.isFinite(b)
    ) {
      return [r / 255, g / 255, b / 255];
    }
  }

  return null;
};
