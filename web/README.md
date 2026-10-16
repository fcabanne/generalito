# web · dados

Recursos visuales para la presentación del experimento. Hoy hay una sola pieza: una **grilla de dados de marfil en 3D**, pensada para el celular, que reacciona al dedo y a las sacudidas.

**Publicada en:** https://fcabanne.github.io/generalito/

No forma parte del motor ni del entrenamiento: no comparte código con la IA y no influye en lo que aprende.

## Qué se puede hacer

| Gesto | Qué pasa |
| --- | --- |
| Pasar el dedo | Cada dado que toca el dedo rueda o gira según la dirección y la velocidad del trazo. Un trazo lento lo hace volcar sobre la arista; uno rápido lo hace girar en el aire. |
| Tocar un dado | Salta y se vuelve a tirar en su lugar. |
| Mantener apretado un dado | Lo levanta colgando del dedo; se puede arrastrar por encima de los otros y al soltarlo sale disparado. |
| Sacudir el celular, suave | Los dados tiemblan y se vuelven a tirar en su celda. |
| Sacudir el celular, fuerte | Se sueltan, chocan como en una caja y, cuando se calma, vuelven de un salto a la grilla, mezclados. |

En iOS la sacudida necesita permiso: el botón **Activar sacudida** lo pide. En la compu, el botón **Sacudir** o la barra espaciadora simulan una sacudida fuerte. La tecla `S` prende o apaga el sonido.

### Parámetros de la URL

- `?ui=0`: sin interfaz, el lienzo limpio para capturar o grabar.
- `?cols=7`: cambia la cantidad de columnas (de 2 a 12; por defecto 5).
- `?captura`: conserva el último cuadro dibujado, para sacar capturas del canvas desde código.

## Cómo está hecho

- **three.js r186**, incluido en `vendor/` (sin CDN ni paso de build: se sirve tal cual).
- **Física propia** (`src/fisica.js`): cuerpos rígidos con XPBD, muchos substeps y una iteración por substep, como la gelatina de la referencia. Hay contacto con el piso, las paredes y un techo invisible, choques entre dados con fricción y rebote, un resorte suave que ata cada dado a su celda y un "imán" que lo deja alineado cuando se queda quieto. No depende de three.js y se testea en node.
- **El dado** (`src/dado.js`): cubo redondeado con texturas generadas por código: marfil con vetas muy suaves y puntos hundidos (mapa normal, oclusión y rugosidad). La pintura de los puntos no lleva laca, así se mantiene negra. El marfil tiene una translucidez fingida: la luz envuelve el terminador con un tono cálido.
- **La escena** (`src/escena.js`): un estudio fotográfico hecho por shader, que sólo existe para reflejarse en los dados; una luz principal; el piso de papel con sombra suave de penumbra variable (PCSS) y oclusión de contacto leída de un mapa de alturas tomado desde abajo; tone mapping neutro de Khronos. Los dados también reciben la sombra de los otros dados.
- **Entrada** (`src/entrada.js`): el dedo es un rayo desde la cámara que la física sigue durante el cuadro; el acelerómetro se lee con `devicemotion`.
- **Sonido** (`src/sonido.js`): golpes sintetizados con WebAudio, sin archivos.
- Sólo se dibuja cuando algo se mueve, y si el teléfono no llega a ~45 fps baja la resolución de a poco.

## Herramientas (en construcción)

**Publicada en:** https://fcabanne.github.io/generalito/herramientas/

Útiles de dibujo en 3D, con la paleta de la foto de referencia (papel salvia, rojo anaranjado, verde botella, petróleo, mostaza), dentro de una caja que es la pantalla. Al sacudir el celular se mueven como de verdad: saltan, giran, ruedan y se cruzan. Pasar el dedo los empuja, tocar uno lo hace saltar y **Ordenar** (o la tecla `O`) los devuelve volando a la composición prolija.

- Hoy hay: lápiz de grafito (rojo y verde), cinco lápices de colores, portaminas, regla de madera de 30 cm y regla de acero de 20 cm.
- Pendientes: gomas, sacapuntas y pinceles.
- `herramientas/src/fisica.js`: la física de los dados generalizada a cuerpos largos (cajas redondeadas de cualquier proporción, inercia propia, materiales por par, rodadura, cinemáticos para Ordenar). Tests: `node --test web/herramientas/test/*.test.mjs`.
- `herramientas/src/objetos/`: un módulo por objeto, con el contrato en `LEEME.md`. `herramientas/visor.html?objeto=lapiz&vista=cerca` muestra uno suelto (vistas `arriba`, `cerca`, `colision`, `todas`).
- Mismos parámetros que los dados: `?ui=0` para el lienzo limpio, `?captura`; además `?fondo=crema`.

## Correrlo local

```bash
cd web
python3 -m http.server 8000
# abrir http://localhost:8000
```

Para probar el acelerómetro en el celular hace falta HTTPS (lo da GitHub Pages).

## Tests

```bash
node --test web/test/*.test.mjs
```

Prueban la física: que un dado caiga plano y quieto en su celda, que no atraviese el piso, que el toque cambie la cara, que una sacudida fuerte con 55 dados termine con todo prolijo, que el dedo haga rodar al dado en la dirección del trazo y que el agarre funcione.

## Publicar

El sitio se publica desde la rama `gh-pages`, que contiene una copia de esta carpeta en la raíz:

```bash
git worktree add /tmp/gh-pages gh-pages
rsync -a --delete --exclude .git --exclude test --exclude README.md web/ /tmp/gh-pages/
touch /tmp/gh-pages/.nojekyll
cd /tmp/gh-pages && git add -A && git commit -m "Publicar dados" && git push origin gh-pages
```
