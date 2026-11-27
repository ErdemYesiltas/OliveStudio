import { Filter, GlProgram, GpuProgram, Matrix, Sprite, Texture, UniformGroup, defaultFilterVert,
  type FilterSystem, type RenderSurface } from 'pixi.js';

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uCurveSurface;
uniform float uCurveStrength;
void main() {
    vec2 point = (vTextureCoord * uInputSize.xy - uCurveSurface.xy) / uCurveSurface.zw;
    float edge = max(0.0, 1.0 - dot(point, point));
    vec2 coord = vTextureCoord - point * (uCurveStrength * edge * edge) * uCurveSurface.zw * uInputSize.zw;
    if (any(lessThan(coord, uInputClamp.xy)) || any(greaterThan(coord, uInputClamp.zw))) finalColor = vec4(0.0);
    else finalColor = texture(uTexture, coord);
}`;

const gpu = `
struct FilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};
struct CurveUniforms { uCurveSurface: vec4<f32>, uCurveStrength: f32 };
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var<uniform> frame: FilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var imageSampler: sampler;
@group(1) @binding(0) var<uniform> curveUniforms: CurveUniforms;

@vertex fn vertexMain(@location(0) position: vec2<f32>) -> VertexOut {
  let p = position * frame.uOutputFrame.zw + frame.uOutputFrame.xy;
  let out = frame.uOutputTexture;
  return VertexOut(vec4<f32>(p.x * 2.0 / out.x - 1.0, p.y * 2.0 * out.z / out.y - out.z, 0.0, 1.0),
    position * frame.uOutputFrame.zw * frame.uInputSize.zw);
}

@fragment fn fragmentMain(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let surface = curveUniforms.uCurveSurface;
  let point = (uv * frame.uInputSize.xy - surface.xy) / surface.zw;
  let edge = max(0.0, 1.0 - dot(point, point));
  let coord = uv - point * (curveUniforms.uCurveStrength * edge * edge) * surface.zw * frame.uInputSize.zw;
  let color = textureSample(uTexture, imageSampler, coord);
  return select(color, vec4<f32>(0.0),
    any(coord < frame.uInputClamp.xy) || any(coord > frame.uInputClamp.zw));
}`;

type Viewport = { width: number; height: number };

export class CameraCurveFilter extends Filter {
  // An untransformed sprite lets Pixi map filter UVs to screen pixels, even for a nested filter pass.
  private readonly screenOrigin = new Sprite(Texture.WHITE);
  private readonly mapping = new Matrix();
  constructor(private readonly viewport: () => Viewport | undefined, angle: number) {
    const curveUniforms = new UniformGroup({
      uCurveSurface: { value: new Float32Array(4), type: 'vec4<f32>' },
      uCurveStrength: { value: 0, type: 'f32' },
    });
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'olive-camera-curve',
        preferredFragmentPrecision: 'highp' }),
      gpuProgram: GpuProgram.from({
        vertex: { source: gpu, entryPoint: 'vertexMain' },
        fragment: { source: gpu, entryPoint: 'fragmentMain' },
      }),
      resources: { curveUniforms },
    });
    this.curveUniforms = curveUniforms;
    this.setAngle(angle);
  }

  private readonly curveUniforms: UniformGroup<{
    uCurveSurface: { value: Float32Array; type: 'vec4<f32>' };
    uCurveStrength: { value: number; type: 'f32' };
  }>;

  setAngle(angle: number) {
    const strength = Math.sin(angle * Math.PI / 180) * 0.46;
    this.curveUniforms.uniforms.uCurveStrength = strength;
    const bounds = this.viewport();
    // The maximum of r(1-r²)² is below 0.287. Reserve room on both axes for the displaced pixels.
    this.padding = bounds?.width && bounds.height ?
      Math.ceil(Math.max(bounds.width, bounds.height) * 0.144 * Math.abs(strength)) + 2 : 48;
  }

  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean) {
    const viewport = this.viewport();
    const surface = this.curveUniforms.uniforms.uCurveSurface;
    const radiusX = Math.max(1, (viewport?.width || input.frame.width) / 2);
    const radiusY = Math.max(1, (viewport?.height || input.frame.height) / 2);
    if (viewport?.width && viewport.height) {
      const mapping = manager.calculateSpriteMatrix(this.mapping, this.screenOrigin);
      surface[0] = radiusX - mapping.tx * this.screenOrigin.texture.orig.width;
      surface[1] = radiusY - mapping.ty * this.screenOrigin.texture.orig.height;
    } else {
      surface[0] = radiusX;
      surface[1] = radiusY;
    }
    surface[2] = radiusX;
    surface[3] = radiusY;
    this.curveUniforms.update();
    super.apply(manager, input, output, clear);
  }

  override destroy(destroyPrograms?: boolean) {
    this.screenOrigin.destroy();
    super.destroy(destroyPrograms);
  }
}
