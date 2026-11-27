import React, { useEffect, useRef } from 'react';

export const AtmosphericShader: React.FC<{ className?: string }> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const syncSize = () => {
      const w = canvas.clientWidth || 640;
      const h = canvas.clientHeight || 320;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
    observer?.observe(canvas);
    syncSize();

    const gl = canvas.getContext('webgl');
    if (!gl) {
      return () => observer?.disconnect();
    }

    const vs = `attribute vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

    const fs = `precision highp float;
    uniform float u_time;
    uniform vec2 u_resolution;
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m; m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }
    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float t = u_time * 0.25;
      vec2 p = uv * 3.0;
      float n1 = snoise(p + vec2(t * 0.3, t * 0.15));
      float n2 = snoise(p * 2.0 - vec2(t * 0.2, -t * 0.25) + vec2(n1 * 0.7));
      float flow = n1 * 0.55 + n2 * 0.45;
      vec3 deepNavy = vec3(0.043, 0.067, 0.137);
      vec3 royalIndigo = vec3(0.086, 0.102, 0.231);
      vec3 emeraldGlow = vec3(0.02, 0.35, 0.25);
      vec3 goldMist = vec3(0.72, 0.52, 0.16);
      vec3 col = mix(deepNavy, royalIndigo, uv.y + flow * 0.2);
      col = mix(col, emeraldGlow, clamp(flow * 0.65 + 0.2, 0.0, 1.0) * 0.42);
      col += goldMist * pow(max(0.0, flow + 0.3), 3.2) * 0.32;
      float vig = 16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
      col *= clamp(pow(vig, 0.25), 0.0, 1.0);
      gl_FragColor = vec4(col, 1.0);
    }`;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');

    let rafId = 0;
    const draw = (t: number) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, reducedMotion ? 1.5 : t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!reducedMotion) {
        rafId = requestAnimationFrame(draw);
      }
    };
    draw(0);

    return () => {
      observer?.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`block w-full h-full pointer-events-none ${className}`}
    />
  );
};
