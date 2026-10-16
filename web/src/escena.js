// ─────────────────────────────────────────────────────────────
//  Escena: estudio fotográfico, luz principal, piso de papel con
//  sombra suave (PCSS) y oclusión de contacto.
//
//  Aprendido de la referencia (Material Studies No. 009):
//  · fondo de papel cálido #E2DFDA que también es el piso;
//  · un estudio procedural (cicloramas, softbox, tira y rebote) que
//    sólo existe para reflejarse en las superficies brillantes;
//  · sombra de la luz principal con penumbra que crece con la
//    distancia al objeto, más oclusión de contacto leída de un mapa
//    de alturas tomado desde abajo;
//  · tone mapping neutro de Khronos y dithering.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

export const FONDO_SRGB = 0xe2dfda;
// dirección hacia la luz principal (arriba a la izquierda de la pantalla)
export const LUZ = new THREE.Vector3(-0.36, 1, -0.42).normalize();

const GLSL_SOFTBOX = /* glsl */ `
float softbox(vec3 d, vec3 c, vec3 up, vec2 size, float blur) {
  float cd = dot(d, c);
  if (cd <= 0.0) return 0.0;
  vec3 t1 = normalize(cross(up, c));
  vec3 t2 = cross(c, t1);
  vec2 uv = vec2(dot(d, t1), dot(d, t2)) / cd;
  vec2 q = abs(uv) - size;
  float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - 0.04;
  return 1.0 - smoothstep(-blur, blur, sd);
}
`;

// El estudio: una esfera grande vista desde adentro, pintada por un
// shader. PMREM la convierte en el mapa de entorno.
// relleno: intensidad del cartón de relleno de abajo a la derecha
// luz: dirección hacia la luz principal (por defecto la de los dados)
export function crearEstudio(renderer, { fondo: fondoSrgb = FONDO_SRGB, relleno = 0.7, luz = LUZ } = {}) {
  const fondo = new THREE.Color(fondoSrgb); // three lo pasa a lineal
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uFondo: { value: new THREE.Vector3(fondo.r, fondo.g, fondo.b) }, uLuz: { value: luz.clone().normalize() }, uRelleno: { value: relleno } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFondo;
      uniform vec3 uLuz;
      uniform float uRelleno;
      varying vec3 vDir;
      ${GLSL_SOFTBOX}
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        // estudio en penumbra: el piso de papel rebota abajo, el resto es oscuro
        vec3 col = mix(uFondo * 0.42, uFondo * 0.5, smoothstep(-0.3, 0.1, y));
        col += uFondo * 0.22 * (1.0 - smoothstep(0.0, 0.3, abs(y - 0.04)));
        col = mix(col, uFondo * 0.38, smoothstep(0.3, 1.0, y));
        float b = 0.02;
        // softbox principal, en la dirección de la luz
        col += vec3(1.0, 0.975, 0.94) * 4.2 * softbox(d, uLuz, vec3(0.0, 0.0, -1.0), vec2(0.5, 0.36), b);
        // tira alta a la derecha: rayas de brillo en las aristas
        col += vec3(1.0, 0.98, 0.95) * 5.0 * softbox(d, normalize(vec3(0.92, 0.32, 0.1)), vec3(0.0, 1.0, 0.0), vec2(0.06, 0.6), b);
        // cenital grande con el borde muy difuso cruzando el cenit: cada cara
        // de arriba lo refleja con un degradado distinto según dónde esté
        col += vec3(1.0, 0.99, 0.97) * 2.4 * softbox(d, normalize(vec3(-0.3, 1.0, -0.42)), vec3(0.0, 0.0, -1.0), vec2(0.32, 0.28), 0.45);
        // cartón de relleno abajo a la derecha, apenas frío
        col += vec3(0.93, 0.96, 1.0) * uRelleno * softbox(d, normalize(vec3(0.5, 0.35, 0.8)), vec3(0.0, 1.0, 0.0), vec2(0.6, 0.3), b * 3.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0);
  pmrem.dispose();
  mat.dispose();
  return rt.texture;
}

// ── piso ──
// El piso se pinta en dos pasos: primero un "mapa de luz" del piso en
// baja resolución (sombra suave + oclusión de contacto), después el piso
// de verdad lo lee con filtrado bilineal. Así lo caro corre en ~¼ de los
// píxeles y sólo cuando algo se movió.
export class Piso {
  // fondo: color del papel (sRGB); tinte: color de la sombra, como factor
  // escala: largo de la escena por "lado de dado" (1 en la página de los
  // dados; con otra unidad, escala los radios de la oclusión y la penumbra)
  constructor(renderer, { calidad = 1, fondo: fondoSrgb = FONDO_SRGB, tinte = [0.7, 0.665, 0.635], escala = 1, oclusion = 0.5, luz = LUZ } = {}) {
    this.renderer = renderer;
    this.luz = luz.clone().normalize();
    const tamSombra = calidad > 1 ? 2048 : 1024;
    this.rtSombra = new THREE.WebGLRenderTarget(tamSombra, tamSombra, {
      depthTexture: new THREE.DepthTexture(tamSombra, tamSombra, THREE.UnsignedIntType),
      depthBuffer: true,
    });
    this.rtSombra.depthTexture.minFilter = this.rtSombra.depthTexture.magFilter = THREE.NearestFilter;
    this.rtAltura = new THREE.WebGLRenderTarget(256, 512, {
      depthTexture: new THREE.DepthTexture(256, 512, THREE.UnsignedIntType),
      depthBuffer: true,
    });
    this.rtAltura.depthTexture.minFilter = this.rtAltura.depthTexture.magFilter = THREE.NearestFilter;
    this.rtLuz = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtLuz.texture.minFilter = this.rtLuz.texture.magFilter = THREE.LinearFilter;
    this.rtLuz2 = this.rtLuz.clone();

    this.camLuz = new THREE.OrthographicCamera();
    this.camAbajo = new THREE.OrthographicCamera();
    this.soloProfundidad = new THREE.MeshBasicMaterial({ colorWrite: false });

    const fondo = new THREE.Color(fondoSrgb);
    this.uniforms = {
      uSombra: { value: this.rtSombra.depthTexture },
      uLuzVP: { value: new THREE.Matrix4() },
      uLuzRango: { value: new THREE.Vector2(1, 30) },   // near, far
      uLuzMundo: { value: new THREE.Vector2(10, 10) },  // ancho y alto del encuadre de la luz
      uAltura: { value: this.rtAltura.depthTexture },
      uAbajoVP: { value: new THREE.Matrix4() },
      uAbajoRango: { value: new THREE.Vector2(0.01, 8) },
      uAbajoMundo: { value: new THREE.Vector2(10, 20) },
      uMin: { value: new THREE.Vector2(-5, -10) },       // rectángulo del piso
      uTam: { value: new THREE.Vector2(10, 20) },
      uTinte: { value: new THREE.Vector3(...tinte) },
      uFondo: { value: new THREE.Vector3(fondo.r, fondo.g, fondo.b) },
      uLuzPiso: { value: this.rtLuz.texture },
      uLuzDir: { value: this.luz.clone() },
      uTamLuz: { value: 0.16 },   // tamaño angular de la luz → penumbra
      // hoja de papel opcional apoyada sobre el fondo (ver ponerPapel)
      uPapelOn: { value: 0 },
      uPapel: { value: new THREE.Vector4(-1000, 0, 0, 0.5) },
      uColorPapel: { value: new THREE.Vector3(1, 1, 1) },
      uPliegue: { value: new THREE.Vector3(0, 0, 0) },
      uEscala: { value: escala },
      uOclusion: { value: oclusion },
    };

    // paso 1: mapa de luz del piso
    this.matMapa = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uSombra;
        uniform mat4 uLuzVP;
        uniform vec2 uLuzRango;
        uniform vec2 uLuzMundo;
        uniform sampler2D uAltura;
        uniform mat4 uAbajoVP;
        uniform vec2 uAbajoRango;
        uniform vec2 uAbajoMundo;
        uniform vec2 uMin;
        uniform vec2 uTam;
        uniform vec3 uTinte;
        uniform float uTamLuz;
        uniform float uEscala;
        uniform float uOclusion;
        varying vec2 vUv;

        const vec2 POISSON[16] = vec2[16](
          vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.094184101, -0.92938870), vec2(0.34495938, 0.29387760),
          vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
          vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
          vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));

        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

        // sombra de la luz principal con penumbra variable (PCSS)
        float sombra(vec3 P) {
          vec4 lp = uLuzVP * vec4(P, 1.0);
          vec2 uv = lp.xy * 0.5 + 0.5;
          float z = lp.z * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
          float rango = uLuzRango.y - uLuzRango.x;
          // 1) buscar bloqueadores en un radio que alcanza a cubrir la penumbra más ancha
          float rBusca = 1.6 * uTamLuz * 2.5 * uEscala / uLuzMundo.x;
          float blk = 0.0, nb = 0.0;
          float ang = ign(gl_FragCoord.xy) * 6.2831853;
          mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
          for (int i = 0; i < 16; i++) {
            float d = texture2D(uSombra, uv + rot * POISSON[i] * rBusca).r;
            if (d < z - 0.0005) { blk += d; nb += 1.0; }
          }
          if (nb < 0.5) return 1.0;
          blk /= nb;
          // 2) penumbra en mundo = distancia al bloqueador × tamaño de la luz
          float pen = clamp((z - blk) * rango * uTamLuz, 0.02 * uEscala, 0.6 * uEscala) / uLuzMundo.x;
          float s = 0.0;
          for (int i = 0; i < 16; i++) {
            float d = texture2D(uSombra, uv + rot * POISSON[i] * pen).r;
            s += d < z - 0.0005 ? 0.0 : 1.0;
          }
          return s / 16.0;
        }

        // oclusión de contacto: qué tan cerca del piso hay un dado alrededor
        float contacto(vec3 P) {
          float occ = 0.0, peso = 0.0;
          for (int anillo = 0; anillo < 3; anillo++) {
            float rad = (0.05 + float(anillo) * 0.13) * uEscala;
            float w = 1.0 - float(anillo) * 0.25;
            for (int i = 0; i < 8; i++) {
              float a = float(i) * 0.785398 + float(anillo) * 0.39;
              vec3 Q = P + vec3(cos(a), 0.0, sin(a)) * rad;
              vec4 hp = uAbajoVP * vec4(Q, 1.0);
              vec2 uv = hp.xy * 0.5 + 0.5;
              float d = texture2D(uAltura, uv).r;
              peso += w;
              if (d < 0.9999) {
                // altura de la cara de abajo del dado sobre el piso
                float h = uAbajoRango.x + d * (uAbajoRango.y - uAbajoRango.x) - 0.5;
                occ += w * (1.0 - smoothstep(0.0, 0.3 * uEscala + rad * 1.6, h));
              }
            }
          }
          return clamp(occ / peso, 0.0, 1.0);
        }

        void main() {
          vec3 P = vec3(uMin.x + vUv.x * uTam.x, 0.0, uMin.y + (1.0 - vUv.y) * uTam.y);
          float s = sombra(P);
          float ao = contacto(P);
          vec3 c = mix(uTinte, vec3(1.0), s);
          c *= 1.0 - ao * uOclusion;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.escenaMapa = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.matMapa);
    this.quad.frustumCulled = false;
    this.escenaMapa.add(this.quad);
    this.camQuad = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // desenfoque gaussiano separable del mapa de luz: borra el ruido del
    // muestreo rotado de la sombra
    this.matBlur = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null }, uPaso: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform vec2 uPaso;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(uTex, vUv).rgb * 0.2270270;
          c += texture2D(uTex, vUv + uPaso * 1.3846154).rgb * 0.3162162;
          c += texture2D(uTex, vUv - uPaso * 1.3846154).rgb * 0.3162162;
          c += texture2D(uTex, vUv + uPaso * 3.2307692).rgb * 0.0702703;
          c += texture2D(uTex, vUv - uPaso * 3.2307692).rgb * 0.0702703;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });

    // paso 2: el piso que ve la cámara
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vP = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFondo;
        uniform sampler2D uLuzPiso;
        uniform vec2 uMin;
        uniform vec2 uTam;
        uniform vec3 uLuzDir;
        uniform float uPapelOn;
        uniform vec4 uPapel;
        uniform vec3 uColorPapel;
        uniform vec3 uPliegue;
        varying vec3 vP;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float ruidoV(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // hoja: de x0 a x1 y de z0 hacia abajo, con las esquinas de arriba redondeadas
        float sdPapel(vec2 p) {
          vec2 c = vec2((uPapel.x + uPapel.z) * 0.5, uPapel.y + 500.0);
          vec2 h = vec2((uPapel.z - uPapel.x) * 0.5, 500.0);
          vec2 q = abs(p - c) - h + uPapel.w;
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uPapel.w;
        }
        // motas de fibra del papel reciclado, chicas y ralas
        float motas(vec2 p, float celda, float prob) {
          vec2 q = p / celda;
          vec2 cel = floor(q), f = q - cel;
          float h = hash(cel);
          if (h > prob) return 0.0;
          vec2 pt = vec2(hash(cel + 7.13), hash(cel + 3.71)) * 0.6 + 0.2;
          float r = 0.06 + 0.12 * hash(cel + 1.37);
          return (1.0 - smoothstep(r * 0.35, r, length(f - pt))) * (0.2 + 0.45 * hash(cel + 9.21));
        }
        void main() {
          vec2 uv = vec2((vP.x - uMin.x) / uTam.x, 1.0 - (vP.z - uMin.y) / uTam.y);
          vec3 luz = texture2D(uLuzPiso, uv).rgb;
          vec3 base = uFondo;
          if (uPapelOn > 0.5) {
            vec2 p = vP.xz;
            float sd = sdPapel(p);
            float aa = fwidth(sd) * 0.8 + 1e-4;
            float dentro = 1.0 - smoothstep(-aa, aa, sd);
            vec2 L = normalize(vec2(uLuzDir.x, uLuzDir.z));
            // el canto de la hoja da sombra sobre el fondo del lado opuesto a la luz
            float sdS = sdPapel(p + L * 0.09);
            float sombra = (1.0 - smoothstep(-0.05, 0.05, sdS)) * (1.0 - dentro) * 0.3;
            // papel: manchado muy suave, fibra fina y motas
            float manchas = (ruidoV(p * 0.9) - 0.5) * 0.05 + (ruidoV(p * 7.0) - 0.5) * 0.025;
            float m = motas(p, 0.21, 0.28) + motas(p + 13.7, 0.55, 0.12) * 0.8;
            vec3 papel = uColorPapel * (1.0 + manchas) * (1.0 - m * 0.55);
            // canto iluminado del lado de la luz
            vec2 e = vec2(0.01, 0.0);
            vec2 n = normalize(vec2(sdPapel(p + e.xy) - sdPapel(p - e.xy), sdPapel(p + e.yx) - sdPapel(p - e.yx)) + 1e-6);
            float canto = (1.0 - smoothstep(0.0, 0.035, -sd)) * max(dot(n, L), 0.0) * dentro * 0.1;
            papel *= 1.0 + canto;
            // borde de la hoja de adelante (una línea fina con su luz)
            if (uPliegue.z > 0.0) {
              // recto hasta x fin y después un cuarto de curva hacia arriba
              float d = 9.0;
              if (p.x < uPliegue.x) d = abs(p.y - uPliegue.y);
              else if (p.y > uPliegue.y - 0.55 && p.y < uPliegue.y + 0.05) d = abs(length(p - vec2(uPliegue.x, uPliegue.y - 0.55)) - 0.55);
              papel *= 1.0 - uPliegue.z * (1.0 - smoothstep(0.0, 0.022, d)) + uPliegue.z * 0.5 * (1.0 - smoothstep(0.0, 0.03, abs(d - 0.04)));
            }
            base = mix(uFondo * (1.0 - sombra), papel, dentro);
          }
          // papel: un leve gradiente desde la luz y una viñeta muy suave
          vec2 c = (uv - 0.5) * vec2(uTam.x / uTam.y, 1.0);
          float grad = 1.0 + 0.035 * dot(normalize(vec2(uLuzDir.x, uLuzDir.z)), -c * 2.0);
          float vin = 1.0 - 0.07 * smoothstep(0.25, 0.75, length(c));
          // grano de papel, apenas perceptible
          float g = (hash(floor(vP.xz * 140.0)) - 0.5) * 0.012;
          vec3 col = base * grad * vin * luz * (1.0 + g);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          // dithering para que el degradado no se vea en escalones
          gl_FragColor.rgb += (hash(gl_FragCoord.xy + fract(vP.xz)) - 0.5) / 255.0;
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
  }

  // Una hoja de papel apoyada sobre el fondo (sólo color del piso, sin
  // física): de x0 a x1 y de z0 hacia abajo, esquinas de radio r, en el
  // color sRGB `color`. pliegue: [x fin, z, intensidad] del borde de una
  // segunda hoja encima (0 para no dibujarlo). null la saca.
  ponerPapel(papel) {
    const u = this.uniforms;
    if (!papel) { u.uPapelOn.value = 0; return; }
    const { x0 = -1000, x1, z0, r = 0.5, color, pliegue = [0, 0, 0] } = papel;
    const c = new THREE.Color(color);
    u.uPapelOn.value = 1;
    u.uPapel.value.set(x0, z0, x1, r);
    u.uColorPapel.value.set(c.r, c.g, c.b);
    u.uPliegue.value.set(...pliegue);
  }

  // Ajusta el encuadre de las cámaras auxiliares al rectángulo del piso
  // [x0, x1] × [z0, z1] y a la altura del techo.
  encuadrar(x0, x1, z0, z1, techo) {
    const W = x1 - x0, D = z1 - z0;
    this.mesh.scale.set(W, D, 1);
    this.mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.uniforms.uMin.value.set(x0, z0);
    this.uniforms.uTam.value.set(W, D);

    // mapa de luz: ~48 texeles por lado de dado (la sombra es suave y
    // después se desenfoca), sin pasarse de 900 de lado
    const dens = Math.min(48, 900 / Math.max(W, D));
    const tx = Math.max(Math.round(W * dens), 16), tz = Math.max(Math.round(D * dens), 16);
    this.rtLuz.setSize(tx, tz);
    this.rtLuz2.setSize(tx, tz);
    this.texel = [1 / tx, 1 / tz];

    // cámara de la luz: ortográfica, mirando a lo largo de LUZ, que encierre
    // la caja completa (piso hasta techo)
    const c = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const cam = this.camLuz;
    cam.position.copy(c).addScaledVector(this.luz, 30);
    cam.up.set(0, 0, -1);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const bb = new THREE.Box3();
    for (const x of [x0, x1]) for (const y of [0, techo]) for (const z of [z0, z1]) {
      bb.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv));
    }
    cam.left = bb.min.x - 0.5; cam.right = bb.max.x + 0.5;
    cam.bottom = bb.min.y - 0.5; cam.top = bb.max.y + 0.5;
    cam.near = Math.max(0.1, -bb.max.z - 1); cam.far = -bb.min.z + 1;
    cam.updateProjectionMatrix();
    this.uniforms.uLuzVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.uniforms.uLuzRango.value.set(cam.near, cam.far);
    this.uniforms.uLuzMundo.value.set(cam.right - cam.left, cam.top - cam.bottom);

    // cámara de abajo: mira hacia arriba desde debajo del piso
    const ca = this.camAbajo;
    ca.position.set(c.x, -0.5, c.z);
    ca.up.set(0, 0, -1);
    ca.lookAt(c.x, 10, c.z);
    ca.left = -W / 2 - 0.5; ca.right = W / 2 + 0.5;
    ca.top = D / 2 + 0.5; ca.bottom = -D / 2 - 0.5;
    ca.near = 0.01; ca.far = techo + 1;
    ca.updateProjectionMatrix();
    ca.updateMatrixWorld();
    this.uniforms.uAbajoVP.value.multiplyMatrices(ca.projectionMatrix, ca.matrixWorldInverse);
    this.uniforms.uAbajoRango.value.set(ca.near, ca.far);
  }

  // Renderiza los mapas auxiliares. `escena` debe tener sólo los dados visibles.
  actualizar(escena) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevOverride = escena.overrideMaterial;
    const prevTM = r.toneMapping;
    escena.overrideMaterial = this.soloProfundidad;
    this.mesh.visible = false;
    r.setRenderTarget(this.rtSombra);
    r.clear(true, true, true);
    r.render(escena, this.camLuz);
    r.setRenderTarget(this.rtAltura);
    r.clear(true, true, true);
    r.render(escena, this.camAbajo);
    escena.overrideMaterial = prevOverride;
    this.mesh.visible = true;
    r.toneMapping = THREE.NoToneMapping;
    this.quad.material = this.matMapa;
    r.setRenderTarget(this.rtLuz);
    r.render(this.escenaMapa, this.camQuad);
    // dos pasadas de desenfoque (horizontal y vertical)
    this.quad.material = this.matBlur;
    const u = this.matBlur.uniforms;
    u.uTex.value = this.rtLuz.texture; u.uPaso.value.set(this.texel[0], 0);
    r.setRenderTarget(this.rtLuz2);
    r.render(this.escenaMapa, this.camQuad);
    u.uTex.value = this.rtLuz2.texture; u.uPaso.value.set(0, this.texel[1]);
    r.setRenderTarget(this.rtLuz);
    r.render(this.escenaMapa, this.camQuad);
    r.toneMapping = prevTM;
    r.setRenderTarget(prevTarget);
  }
}
