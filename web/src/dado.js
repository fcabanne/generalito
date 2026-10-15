// ─────────────────────────────────────────────────────────────
//  El dado: geometría redondeada, texturas procedurales (marfil,
//  puntos hundidos) y material.
//
//  Las caras usan la misma convención que fisica.js (CARAS):
//  +y:1  −y:6  +z:2  −z:5  +x:3  −x:4
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

// Cada cara: normal, eje u (derecha en la textura), eje v (arriba) y valor.
// u × v = n para que el triángulo mire hacia afuera.
const CARAS = [
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], valor: 1 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], valor: 6 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], valor: 2 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], valor: 5 },
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], valor: 3 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], valor: 4 },
];

// Posición de cada cara en el atlas (3 columnas × 2 filas)
const CELDA_ATLAS = { 1: [0, 0], 2: [1, 0], 3: [2, 0], 4: [0, 1], 5: [1, 1], 6: [2, 1] };

// Puntos de cada cara en coords de cara (−1..1), separados `s` del centro.
function puntos(valor, s) {
  const P = {
    1: [[0, 0]],
    2: [[-s, -s], [s, s]],
    3: [[-s, -s], [0, 0], [s, s]],
    4: [[-s, -s], [s, -s], [-s, s], [s, s]],
    5: [[-s, -s], [s, -s], [0, 0], [-s, s], [s, s]],
    6: [[-s, -s], [-s, 0], [-s, s], [s, -s], [s, 0], [s, s]],
  };
  return P[valor];
}

// ── geometría ──
// Cubo de lado 1 con aristas redondeadas de radio r. Cada cara es una
// grilla cuyos vértices se reparten en ángulo dentro de la zona curva,
// así el redondeo queda liso con pocos vértices.
export function geometriaDado(r = 0.13, k = 6) {
  const H = 0.5, a = H - r;
  // coordenadas a lo largo de un eje de la cara (de −H a H)
  const ts = [];
  for (let i = k; i >= 1; i--) ts.push(-(a + r * Math.tan((i / k) * Math.PI / 4)));
  ts.push(-a, a);
  for (let i = 1; i <= k; i++) ts.push(a + r * Math.tan((i / k) * Math.PI / 4));
  const n = ts.length;
  const pos = [], nor = [], uv = [], idx = [];
  const [ancho, alto] = [3, 2];
  for (const cara of CARAS) {
    const base = pos.length / 3;
    const [ci, cj] = CELDA_ATLAS[cara.valor];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const su = ts[i], sv = ts[j];
      const P = [0, 1, 2].map((c) => cara.n[c] * H + cara.u[c] * su + cara.v[c] * sv);
      const C = P.map((x) => Math.max(-a, Math.min(a, x)));
      const D = P.map((x, c) => x - C[c]);
      const L = Math.hypot(...D);
      const N = D.map((x) => x / L);
      pos.push(...C.map((x, c) => x + N[c] * r));
      nor.push(...N);
      // uv dentro de la celda del atlas (v hacia arriba)
      const fu = (su / H + 1) / 2, fv = (sv / H + 1) / 2;
      uv.push((ci + fu) / ancho, 1 - (cj + 1 - fv) / alto);
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const p = base + j * n + i;
      idx.push(p, p + 1, p + n + 1, p, p + n + 1, p + n);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ── texturas ──
// Ruido de valor suave, determinístico.
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function ruido(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += amp * ruido(x * f, y * f); amp *= 0.5; f *= 2.03; }
  return s;
}

const srgbALineal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linealASrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export const ESTILO = {
  marfil: [0.955, 0.945, 0.92],   // sRGB: hueso, apenas cálido
  pintura: [0.085, 0.075, 0.07],  // sRGB, negro cálido
  separacion: 0.5,     // distancia de los puntos al centro, en coords de cara (−1..1)
  radioPunto: 0.165,   // radio del punto (coords de cara)
  radioUno: 0.2,       // el 1 un poco más grande, como en los dados de cubilete
  profundidad: 0.55,   // qué tan hundido se ve el punto (escala del mapa normal)
};

// Genera albedo, normal y ORM (oclusión, rugosidad, metal) en un atlas
// de 3×2 caras de T píxeles.
export function texturasDado(T = 512, estilo = ESTILO) {
  const W = 3 * T, Hh = 2 * T;
  const color = new Uint8Array(W * Hh * 4);
  const normal = new Uint8Array(W * Hh * 4);
  const orm = new Uint8Array(W * Hh * 4);
  const capa = new Uint8Array(W * Hh * 4); // R: laca, A: especular
  const marfil = estilo.marfil.map(srgbALineal);
  const pintura = estilo.pintura.map(srgbALineal);
  const px = 2 / T; // tamaño de un texel en coords de cara

  for (const cara of CARAS) {
    const [ci, cj] = CELDA_ATLAS[cara.valor];
    const R = cara.valor === 1 ? estilo.radioUno : estilo.radioPunto;
    const P = puntos(cara.valor, estilo.separacion);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      // coords de cara: u a la derecha, v hacia arriba
      const u = ((x + 0.5) / T) * 2 - 1;
      const v = ((y + 0.5) / T) * 2 - 1;
      // punto más cercano
      let dmin = 9, du = 0, dv = 0;
      for (const [pu, pv] of P) {
        const d = Math.hypot(u - pu, v - pv);
        if (d < dmin) { dmin = d; du = u - pu; dv = v - pv; }
      }
      const rho = dmin / R; // 0 en el centro del punto, 1 en el borde
      // perfil: cuenco esférico con un labio apenas redondeado. Pendiente
      // radial dh/dρ ≥ 0: la superficie sube desde el fondo del punto hacia
      // el borde, así la normal se inclina hacia el centro del hueco.
      let pend = 0;
      if (rho < 1.12) {
        const bowl = rho < 1 ? rho / Math.sqrt(Math.max(1 - rho * rho * 0.82, 0.05)) : 0;
        const labio = Math.exp(-(((rho - 1) / 0.07) ** 2));
        pend = (bowl * 0.45 + labio * 1.25) * (rho < 1 ? 1 : 0.6);
      }
      const gu = dmin > 1e-6 ? (du / dmin) * pend : 0;
      const gv = dmin > 1e-6 ? (dv / dmin) * pend : 0;
      let nx = -gu * estilo.profundidad, ny = -gv * estilo.profundidad, nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl; ny /= nl; nz /= nl;

      // mezcla pintura/marfil con borde antialiasado (un poco adentro del borde)
      const borde = R * 0.94;
      const t = Math.min(1, Math.max(0, (borde - dmin) / px + 0.5));
      // marfil con vetas muy suaves, como hueso/resina
      const vet = fbm(u * 3.1 + cara.valor * 7.3, v * 1.4 - cara.valor * 3.1);
      const grano = ruido(u * 90 + cara.valor * 11, v * 90) - 0.5;
      const mv = 1 + (vet - 0.5) * 0.045 + grano * 0.012;
      // la pintura se acumula más oscura al fondo del cuenco
      const pv = 1 - 0.15 * (1 - rho);
      const out = (ci * T + x + (Hh - 1 - (cj * T + (T - 1 - y))) * W) * 4;
      for (let c = 0; c < 3; c++) {
        const lin = marfil[c] * mv * (1 - t) + pintura[c] * pv * t;
        color[out + c] = Math.round(linealASrgb(Math.max(0, Math.min(1, lin))) * 255);
      }
      color[out + 3] = 255;
      normal[out] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[out + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[out + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[out + 3] = 255;
      // oclusión: el hueco se oscurece hacia las paredes
      const ao = rho < 1.05 ? 1 - 0.55 * Math.exp(-(((rho - 0.95) / 0.22) ** 2)) : 1;
      // rugosidad: marfil pulido, pintura algo más brillante
      const rug = 0.4 * (1 - t) + 0.5 * t + grano * 0.04;
      orm[out] = Math.round(ao * 255);
      orm[out + 1] = Math.round(Math.max(0, Math.min(1, rug)) * 255);
      orm[out + 2] = 0;
      orm[out + 3] = 255;
      // la pintura de los puntos no lleva laca y refleja poco: queda negra
      capa[out] = Math.round((1 - t) * 255);
      capa[out + 1] = 0;
      capa[out + 2] = 0;
      capa[out + 3] = Math.round((1 - t * 0.7) * 255);
    }
  }
  const crear = (data, sRGB) => {
    const tx = new THREE.DataTexture(data, W, Hh, THREE.RGBAFormat);
    tx.colorSpace = sRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.magFilter = THREE.LinearFilter;
    tx.anisotropy = 4;
    tx.needsUpdate = true;
    return tx;
  };
  return { color: crear(color, true), normal: crear(normal, false), orm: crear(orm, false), capa: crear(capa, false) };
}

// ── material ──
// Marfil: dieléctrico con laca (clearcoat) y una translucidez fingida:
// la luz "envuelve" un poco el terminador con un tono cálido, como pasa
// en el hueso o la resina gruesa.
export function materialDado(tex, opciones = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    map: tex.color,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: tex.orm,
    aoMap: tex.orm,
    aoMapIntensity: 1,
    roughness: 1,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatMap: tex.capa,
    clearcoatRoughness: 0.1,
    specularIntensity: 1,
    specularIntensityMap: tex.capa,
    envMapIntensity: 1,
    dithering: true,
  });
  const u = {
    uEnvoltura: { value: opciones.envoltura ?? 0.45 },
    uColorSSS: { value: new THREE.Color(...(opciones.colorSSS ?? [0.9, 0.6, 0.42])) },
    // cuánto ilumina en difuso el estudio: sus softboxes están para reflejarse
    uDifusaEnv: { value: opciones.difusaEnv ?? 0.12 },
    // sombra de la luz principal (la misma que usa el piso): un dado en el
    // aire oscurece a los que tiene abajo
    uSombra: { value: null },
    uLuzVP: { value: new THREE.Matrix4() },
  };
  m.userData.uniforms = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;',
      'vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance * uDifusaEnv;'
    ).replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
      `irradiance *= gSombra;
	float nlCrudo = dot( geometryNormal, directLight.direction );
	float nlEnv = saturate( ( nlCrudo + uEnvoltura ) / ( 1.0 + uEnvoltura ) );
	vec3 sss = directLight.color * max( nlEnv - saturate( nlCrudo ), 0.0 ) * uColorSSS * gSombra;
	reflectedLight.directDiffuse += ( irradiance + sss ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`
    );
    // En la sombra de otro dado también se tapa buena parte del estudio:
    // el softbox principal es la misma luz que la directa.
    const conSombra = chunk.replace(
      'vec3 ccIrradiance = dotNLcc * directLight.color;',
      'vec3 ccIrradiance = dotNLcc * directLight.color * gSombra;'
    ).replace(
      'clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );',
      'clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness ) * mix( 0.25, 1.0, gSombra );'
    ).replace(
      'reflectedLight.indirectSpecular += indirectSpecular;',
      'reflectedLight.indirectSpecular += indirectSpecular * mix( 0.25, 1.0, gSombra );'
    ).replace(
      'reflectedLight.indirectDiffuse += indirectDiffuse;',
      'reflectedLight.indirectDiffuse += indirectDiffuse * mix( 0.7, 1.0, gSombra );'
    );
    if (!conSombra.includes('mix( 0.25, 1.0, gSombra )')) console.warn('dado: no se pudo inyectar la sombra en el entorno');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMundo;\nvarying vec3 vNormalMundo;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vMundo = worldPosition.xyz;
        #ifdef USE_INSTANCING
          vNormalMundo = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
        #else
          vNormalMundo = normalize( mat3( modelMatrix ) * objectNormal );
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uEnvoltura;
        uniform vec3 uColorSSS;
        uniform float uDifusaEnv;
        uniform sampler2D uSombra;
        uniform mat4 uLuzVP;
        varying vec3 vMundo;
        varying vec3 vNormalMundo;
        float gSombra = 1.0;
        // comparación con interpolación bilineal (como el PCF por hardware)
        float pcf( vec2 uv, float z, vec2 t ) {
          vec2 p = uv / t - 0.5;
          vec2 f = fract( p );
          vec2 b = ( floor( p ) + 0.5 ) * t;
          float s00 = step( z, texture2D( uSombra, b ).r );
          float s10 = step( z, texture2D( uSombra, b + vec2( t.x, 0.0 ) ).r );
          float s01 = step( z, texture2D( uSombra, b + vec2( 0.0, t.y ) ).r );
          float s11 = step( z, texture2D( uSombra, b + t ).r );
          return mix( mix( s00, s10, f.x ), mix( s01, s11, f.x ), f.y );
        }
        float sombraDados() {
          // corrimiento sobre la normal para que el dado no se sombree a sí mismo
          vec4 lp = uLuzVP * vec4( vMundo + normalize( vNormalMundo ) * 0.045, 1.0 );
          vec2 uv = lp.xy * 0.5 + 0.5;
          float z = lp.z * 0.5 + 0.5 - 0.0004;
          vec2 t = vec2( 1.0 ) / vec2( textureSize( uSombra, 0 ) );
          float r = 1.1;
          return 0.25 * ( pcf( uv + vec2( -r, -r ) * t, z, t ) + pcf( uv + vec2( r, -r ) * t, z, t )
                        + pcf( uv + vec2( -r, r ) * t, z, t ) + pcf( uv + vec2( r, r ) * t, z, t ) );
        }`)
      .replace('#include <lights_physical_pars_fragment>', conSombra)
      .replace('#include <lights_fragment_begin>', 'gSombra = sombraDados();\n#include <lights_fragment_begin>');
  };
  m.customProgramCacheKey = () => 'dado-marfil';
  return m;
}
