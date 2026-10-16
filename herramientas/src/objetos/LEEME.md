# Objetos: contrato

Cada herramienta es un módulo en esta carpeta (`lapiz.js`, `regla.js`, …) que la escena principal y el visor (`../../visor.html`) cargan de la misma forma. No dependen entre sí.

## Unidades y ejes

- **1 unidad = 1 cm.** Medidas reales (un lápiz mide ~17,5 cm de largo y 0,75 cm entre caras).
- **y apunta hacia arriba** (hacia la cámara, que mira desde arriba). La luz principal viene de arriba a la izquierda de la pantalla (−x, +y, −z), así que las sombras caen hacia abajo a la derecha.
- **El eje largo del objeto va en x.** El objeto se arma en su pose de reposo natural: apoyado sobre el piso con −y hacia abajo.
- **El origen local es el centro del cuerpo de colisión** (ver abajo), que se toma como centro de masa.

## Lo que exporta cada módulo

```js
export const nombre = 'lapiz';                  // igual al nombre del archivo
export const variantes = ['rojo'];              // al menos una
export function crear(variante = variantes[0]) {
  return {
    malla,   // THREE.Object3D (Mesh o Group), en coords locales del cuerpo
    cuerpo: {
      medias: [hx, hy, hz], // semiejes del núcleo de la caja (cm), cada uno ≥ 0
      radio: r,             // redondeo (cm) > 0: la forma de colisión es la caja
                            // núcleo "inflada" r en todas direcciones (suma de
                            // Minkowski con una esfera). Un lápiz redondo es
                            // medias [L/2, 0, 0] con radio = su radio.
      masa: 5,              // gramos, realista
      material: 'madera',   // 'madera' | 'metal' | 'goma' | 'plastico' (sonido y fricción)
    },
  };
}
```

La forma de colisión es **una sola caja redondeada**: elegí `medias` y `radio` para que envuelva bien la malla (la punta afilada de un lápiz o las cerdas de un pincel pueden quedar un poco adentro o afuera; no hace falta exactitud). El visor la dibuja con `vista=colision` para comprobarlo.

## Materiales

- `MeshStandardMaterial` o `MeshPhysicalMaterial`, siempre pasados por `recibirSombra(material, opciones)` de `../util.js`. Sin eso el objeto no recibe la sombra de los demás y se ve pegado encima. Para goma, madera clara o plástico grueso podés usar `envoltura` (0,2–0,5) y `colorSSS` para una translucidez cálida.
- El entorno es un estudio con softboxes: los materiales brillantes (laca, metal, plástico) los reflejan. Usá `roughness`, `clearcoat` y `metalness` creíbles.
- Texturas generadas por código (sin archivos ni red): `lienzo`, `texturaDeLienzo`, `texturaDeDatos`, `normalDesdeAltura`, `ruido`, `fbm` de `../util.js`. Texturas de 1024 px de lado como máximo. Si generar algo es caro, cachealo a nivel de módulo para que varias instancias lo compartan.
- Colores: partir de `PALETA` en `../paleta.js` (sacada de la foto de referencia).

## Presupuesto

- Hasta ~20.000 triángulos por objeto. Que generar uno tarde menos de 150 ms en una compu común.
- Sin sombras de three (`castShadow`/`receiveShadow` no se usan): la sombra la calcula el escenario sobre todo lo que está en la escena.

## Visor

`visor.html?objeto=lapiz&variante=rojo&vista=arriba|cerca|colision|todas&lista=lapiz,regla`

- `arriba`: cámara cenital como en la página final.
- `cerca`: tres cuartos, de cerca, para ver detalles.
- `colision`: la forma de colisión en alambre sobre la malla.
- `todas`: todos los objetos de `lista` (con todas sus variantes) uno al lado del otro, para comparar escala y estilo.

Cuando termina de dibujar pone `window.__listo = true`.
