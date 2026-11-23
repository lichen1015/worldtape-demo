const vertexSource = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D geom, shTex;
uniform int geomWidth, shWidth, shDegree, shStride;
uniform vec3 eye, right, down, forward;
uniform vec4 calibration;
uniform vec2 size;
uniform float time, nearPlane;
in uint pointIndex;
out vec2 gaussianUV;
flat out vec4 rgba;

vec4 readTex(sampler2D tex, int width, int i) {
  return texelFetch(tex, ivec2(i % width, i / width), 0);
}
vec3 sh(int coeff) {
  int base = int(pointIndex) * shStride + 3 * coeff;
  vec4 first = readTex(shTex, shWidth, base / 4);
  int slot = base % 4;
  if (slot == 0) return first.xyz;
  if (slot == 1) return first.yzw;
  vec4 second = readTex(shTex, shWidth, base / 4 + 1);
  if (slot == 2) return vec3(first.zw, second.x);
  return vec3(first.w, second.xy);
}
vec3 radiance(vec3 d) {
  float x = d.x, y = d.y, z = d.z;
  float xx = x*x, yy = y*y, zz = z*z;
  vec3 color = vec3(.5) + .28209479177387814 * sh(0);
  if (shDegree >= 1) {
    color += .4886025119029199 * (-y*sh(1) + z*sh(2) - x*sh(3));
  }
  if (shDegree >= 2) {
    color += 1.0925484305920792*x*y*sh(4)
           - 1.0925484305920792*y*z*sh(5)
           + .31539156525252005*(2.*zz-xx-yy)*sh(6)
           - 1.0925484305920792*x*z*sh(7)
           + .5462742152960396*(xx-yy)*sh(8);
  }
  if (shDegree >= 3) {
    color += -.5900435899266435*y*(3.*xx-yy)*sh(9)
           + 2.890611442640554*x*y*z*sh(10)
           - .4570457994644658*y*(4.*zz-xx-yy)*sh(11)
           + .3731763325901154*z*(2.*zz-3.*xx-3.*yy)*sh(12)
           - .4570457994644658*x*(4.*zz-xx-yy)*sh(13)
           + 1.445305721320277*z*(xx-yy)*sh(14)
           - .5900435899266435*x*(xx-3.*yy)*sh(15);
  }
  return color;
}
void main() {
  int i = 4 * int(pointIndex);
  vec4 centerOpacity = readTex(geom, geomWidth, i);
  vec4 velocityTime = readTex(geom, geomWidth, i+1);
  vec4 cov0 = readTex(geom, geomWidth, i+2);
  vec4 cov1 = readTex(geom, geomWidth, i+3);
  float dt = time - velocityTime.w;
  vec3 world = centerOpacity.xyz + dt*velocityTime.xyz - eye;
  mat3 W = transpose(mat3(right, down, forward));
  vec3 p = W*world;
  if (p.z <= nearPlane) { gl_Position = vec4(3., 3., 0., 1.); return; }
  float invZ = 1./p.z;
  vec2 focal = calibration.xy;
  vec2 pixel = p.xy * focal * invZ + calibration.zw;

  mat3 C = mat3(cov0.x,cov0.y,cov0.z,
                cov0.y,cov0.w,cov1.x,
                cov0.z,cov1.x,cov1.y);
  mat3 cov = W*C*transpose(W);
  vec2 lim = 1.3*max(calibration.zw, size-calibration.zw)/focal;
  vec2 q = clamp(p.xy*invZ, -lim, lim);
  vec3 jx = focal.x * invZ * vec3(1., 0., -q.x);
  vec3 jy = focal.y * invZ * vec3(0., 1., -q.y);
  float a = dot(jx,cov*jx)+.3;
  float b = dot(jx,cov*jy);
  float c = dot(jy,cov*jy)+.3;
  float discriminant = length(vec2(.5*(a-c),b));
  float e1 = .5*(a+c)+discriminant;
  float e2 = max(.5*(a+c)-discriminant,.001);
  vec2 major = abs(b) > 1.e-7 ? normalize(vec2(b,e1-a)) :
    (a >= c ? vec2(1.,0.) : vec2(0.,1.));
  vec2 minor = vec2(-major.y, major.x);
  gaussianUV = 3.25 * vec2((gl_VertexID&1)==0 ? -1. : 1.,
                           (gl_VertexID&2)==0 ? -1. : 1.);
  vec2 shift = sqrt(e1)*major*gaussianUV.x + sqrt(e2)*minor*gaussianUV.y;
  vec2 ndc = 2.*(pixel+shift)/size-1.;
  gl_Position = vec4(ndc.x,-ndc.y,0.,1.);
  float t = dt/max(cov1.z,1.e-8);
  rgba = vec4(radiance(normalize(world)),
              centerOpacity.w*(cov1.w+(1.-cov1.w)*exp(-.5*t*t)));
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec2 gaussianUV;
flat in vec4 rgba;
out vec4 outputColor;
void main() {
  float alpha = min(.999, rgba.a * exp(-.5*dot(gaussianUV,gaussianUV)));
  if (alpha < 1./255.) discard;
  outputColor = vec4(max(rgba.rgb,0.),alpha);
}`;

export class Renderer {
  constructor(canvas, asset, geometry, harmonics) {
    const gl = canvas.getContext("webgl2", {alpha:false, antialias:false, preserveDrawingBuffer:true});
    if (!gl) throw new Error("WebGL 2 is unavailable in this browser.");
    this.gl = gl;
    this.canvas = canvas;
    this.program = gl.createProgram();
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(this.program, shader);
    }
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);
    this.uniform = Object.fromEntries(
      ["geom","shTex","geomWidth","shWidth","shDegree","shStride","eye","right","down","forward","calibration","size","time","nearPlane"]
        .map(name => [name, gl.getUniformLocation(this.program, name)]),
    );
    this.texture(0, geometry, gl.RGBA32F, gl.FLOAT, this.uniform.geomWidth);
    this.texture(1, harmonics, gl.RGBA16F, gl.HALF_FLOAT, this.uniform.shWidth);
    gl.uniform1i(this.uniform.geom, 0);
    gl.uniform1i(this.uniform.shTex, 1);
    gl.uniform1i(this.uniform.shDegree, asset.shDegree);
    gl.uniform1f(this.uniform.nearPlane, asset.nearPlane ?? .02);
    gl.uniform1i(this.uniform.shStride, 3*(asset.shDegree+1)**2);

    this.indices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indices);
    gl.bufferData(gl.ARRAY_BUFFER, asset.count*4, gl.DYNAMIC_DRAW);
    const location = gl.getAttribLocation(this.program, "pointIndex");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribIPointer(location, 1, gl.UNSIGNED_INT, 0, 0);
    gl.vertexAttribDivisor(location, 1);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,1);
    this.count = 0;
    if (gl.getExtension("EXT_color_buffer_float")) {
      const target = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D,target);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,canvas.width,canvas.height,0,gl.RGBA,gl.HALF_FLOAT,null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        this.framebuffer = framebuffer;
      } else {
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(target);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
  }

  texture(unit, data, format, type, sizeUniform) {
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const width = Math.min(max, 4096);
    const height = Math.ceil(data.length/(4*width));
    if (height > max) throw new Error("This scene exceeds the GPU texture limit.");
    const packed = new data.constructor(width*height*4);
    packed.set(data);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, type, packed);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Could not upload scene textures.");
    gl.uniform1i(sizeUniform, width);
  }

  setOrder(indices) {
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.indices);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, indices);
    this.count = indices.length;
  }

  draw(camera, time) {
    const gl = this.gl;
    const u = this.uniform;
    const {width, height} = this.canvas;
    const sx = width/camera.width, sy = height/camera.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer ?? null);
    gl.viewport(0,0,width,height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3fv(u.eye, camera.eye);
    gl.uniform3fv(u.right, camera.right);
    gl.uniform3fv(u.down, camera.down);
    gl.uniform3fv(u.forward, camera.forward);
    gl.uniform4f(u.calibration, camera.k[0][0]*sx, camera.k[1][1]*sy,
      camera.k[0][2]*sx, camera.k[1][2]*sy);
    gl.uniform2f(u.size,width,height);
    gl.uniform1f(u.time,time);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,this.count);
    if (this.framebuffer) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);
      gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);
    }
  }
}
