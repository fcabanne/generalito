// ─────────────────────────────────────────────────────────────
//  Utilidades compartidas por los objetos: ruido, texturas desde
//  lienzos o datos, y la inyección de sombra en los materiales.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

// ── ruido determinístico ──
export function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function ruido(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(x, y, octavas = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octavas; i++) { s += amp * ruido(x * f, y * f); amp *= 0.5; f *= 2.03; }
  return s;
}

// Generador de números al azar con semilla (para variaciones repetibles).
export function azar(semilla = 1) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const srgbALineal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linealASrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// ── texturas ──
export function lienzo(ancho, alto) {
  const c = document.createElement('canvas');
  c.width = ancho; c.height = alto;
  return c;
}

// srgb: true para colores (map), false para datos (normal, rugosidad...)
export function texturaDeLienzo(canvas, { srgb = true, repetir = false, anisotropia = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repetir) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropia;
  t.needsUpdate = true;
  return t;
}

// Datos RGBA de 8 bits; la fila 0 es v = 0 (abajo), como en uv.
export function texturaDeDatos(datos, ancho, alto, { srgb = false, repetir = false, anisotropia = 4 } = {}) {
  const t = new THREE.DataTexture(datos, ancho, alto, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repetir) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropia;
  t.needsUpdate = true;
  return t;
}

// Mapa normal a partir de una función de altura h(u, v) en [0,1]².
// `fuerza` escala la pendiente. Devuelve una DataTexture.
export function normalDesdeAltura(ancho, alto, h, { fuerza = 1, repetir = false } = {}) {
  const datos = new Uint8Array(ancho * alto * 4);
  const du = 1 / ancho, dv = 1 / alto;
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const u = (x + 0.5) / ancho, v = (y + 0.5) / alto;
    const hx = (h(u + du, v) - h(u - du, v)) / (2 * du);
    const hy = (h(u, v + dv) - h(u, v - dv)) / (2 * dv);
    let nx = -hx * fuerza, ny = -hy * fuerza, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    const o = (y * ancho + x) * 4;
    datos[o] = Math.round((nx * 0.5 + 0.5) * 255);
    datos[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    datos[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    datos[o + 3] = 255;
  }
  return texturaDeDatos(datos, ancho, alto, { repetir });
}

// ── sombra en los materiales ──
// Uniforms compartidos por todos los materiales: el escenario los llena
// con el mapa de sombra de la luz principal (el mismo que usa el piso).
export const SOMBRA = {
  uSombra: { value: null },
  uLuzVP: { value: new THREE.Matrix4() },
};

// Prepara un MeshStandardMaterial o MeshPhysicalMaterial para:
// · recibir la sombra de la luz principal (un objeto encima de otro lo
//   oscurece, también en los reflejos del estudio);
// · que el estudio ilumine poco en difuso (sus softboxes están para
//   reflejarse; el relleno lo da la luz hemisférica);
// · opcionalmente, una translucidez fingida (envoltura cálida del
//   terminador), útil para goma, madera clara o plástico.
// Respeta un onBeforeCompile previo del material.
export function recibirSombra(material, { envoltura = 0, colorSSS = [1, 0.7, 0.5], difusaEnv = 0.32, desplazamiento = 0.07, clave = '' } = {}) {
  const u = {
    uEnvoltura: { value: envoltura },
    uColorSSS: { value: new THREE.Color(...colorSSS) },
    uDifusaEnv: { value: difusaEnv },
    uDesplaz: { value: desplazamiento },
    uSombra: SOMBRA.uSombra,
    uLuzVP: SOMBRA.uLuzVP,
  };
  material.userData.uniformsSombra = u;
  const previo = material.onBeforeCompile;
  const clavePrevia = material.customProgramCacheKey;
  material.onBeforeCompile = (sh, r) => {
    if (previo && previo !== THREE.Material.prototype.onBeforeCompile) previo.call(material, sh, r);
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
    ).replace(
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
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMundo;\nvarying vec3 vNormalMundo;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vMundo = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #ifdef USE_INSTANCING
          vMundo = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
          vNormalMundo = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
        #else
          vNormalMundo = normalize( mat3( modelMatrix ) * objectNormal );
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uEnvoltura;
        uniform vec3 uColorSSS;
        uniform float uDifusaEnv;
        uniform float uDesplaz;
        uniform sampler2D uSombra;
        uniform mat4 uLuzVP;
        varying vec3 vMundo;
        varying vec3 vNormalMundo;
        float gSombra = 1.0;
        float pcfSombra( vec2 uv, float z, vec2 t ) {
          vec2 p = uv / t - 0.5;
          vec2 f = fract( p );
          vec2 b = ( floor( p ) + 0.5 ) * t;
          float s00 = step( z, texture2D( uSombra, b ).r );
          float s10 = step( z, texture2D( uSombra, b + vec2( t.x, 0.0 ) ).r );
          float s01 = step( z, texture2D( uSombra, b + vec2( 0.0, t.y ) ).r );
          float s11 = step( z, texture2D( uSombra, b + t ).r );
          return mix( mix( s00, s10, f.x ), mix( s01, s11, f.x ), f.y );
        }
        float sombraLuz() {
          vec4 lp = uLuzVP * vec4( vMundo + normalize( vNormalMundo ) * uDesplaz, 1.0 );
          vec2 uv = lp.xy * 0.5 + 0.5;
          if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) return 1.0;
          float z = lp.z * 0.5 + 0.5 - 0.0004;
          vec2 t = vec2( 1.0 ) / vec2( textureSize( uSombra, 0 ) );
          float r = 1.1;
          return 0.25 * ( pcfSombra( uv + vec2( -r, -r ) * t, z, t ) + pcfSombra( uv + vec2( r, -r ) * t, z, t )
                        + pcfSombra( uv + vec2( -r, r ) * t, z, t ) + pcfSombra( uv + vec2( r, r ) * t, z, t ) );
        }`)
      .replace('#include <lights_physical_pars_fragment>', chunk)
      .replace('#include <lights_fragment_begin>', 'gSombra = sombraLuz();\n#include <lights_fragment_begin>');
  };
  // la clave de caché tiene que distinguir materiales con distintos
  // onBeforeCompile previos, si no three reutiliza el programa equivocado
  const propia = clavePrevia && clavePrevia !== THREE.Material.prototype.customProgramCacheKey;
  const textoPrevio = previo && previo !== THREE.Material.prototype.onBeforeCompile ? previo.toString() : '';
  material.customProgramCacheKey = () => 'sombra|' + clave + '|' + textoPrevio + '|' + (propia ? clavePrevia.call(material) : '');
  return material;
}
