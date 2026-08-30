import * as THREE from 'three'

// Modelo de ojo en 3 capas, construido con curvas Bezier cubicas reales
// (como los manejadores de la pluma de Illustrator), sobre un eje
// lagrimal-canto. Cuelga del mismo loomisGroup que la cabeza.

// Valores iniciales estimados a ojo desde la referencia frontal
// (IMG_3395). Punto de partida para calibrar en vivo con los sliders.
let eyeParams = {
    // --- CAPA 1: el eje (lagrimal fijo, canto se mueve) ---
    cantoLengthMult: 0.40,  // distancia lagrimal-canto, fraccion del radio de cabeza
    cantoAngleDeg: 8,       // angulo del canto respecto al lagrimal - positivo = canto sube hacia la ceja

    // --- CAPA 2: la carne sobre ese eje (manejadores Bezier) ---
    upperLidBulge: 0.14,    // altura del manejador del parpado superior, fraccion del radio de cabeza
    lowerLidBulge: 0.08,    // altura del manejador del parpado inferior (normalmente menor que el superior)
    innerSharp: 0.30,       // 0 = manejador lejos del lagrimal (redondeado), 1 = manejador cerca (picudo)
    outerSharp: 0.60,       // 0 = manejador lejos del canto (redondeado), 1 = manejador cerca (picudo)

    // ✅ NUEVO: el parpado inferior ya NO comparte obligatoriamente el
    // lagrimal/canto con el superior - tiene su PROPIO inicio y final,
    // insertados hacia adentro del eje. 0 = toca la esquina exacta (como
    // antes); valores mayores lo acortan y lo "sueltan" de la esquina,
    // como un trazo independiente flotando debajo.
    lowerLidInnerInset: 0.15, // fraccion del largo lagrimal-canto, desde el lagrimal
    lowerLidOuterInset: 0.15, // fraccion del largo lagrimal-canto, desde el canto

    // ✅ NUEVO: base plana del párpado inferior - en 0 el ojo es una
    // almendra (la curva actual, sin tramo recto). Al subir el valor se
    // inserta un tramo horizontal en el medio de la curva, "aplanando"
    // la base y alejándose de la forma almendrada.
    lowerLidBaseWidth: 0,

    // ✅ NUEVO: "flick" del canto - el párpado superior sigue de largo más
    // allá del punto donde el inferior termina, como un trazo de
    // delineador que no cierra justo en la esquina. En 0 no hay flick
    // (cierra exacto en el canto, como antes).
    outerFlickLength: 0,

    // --- CAPA 3: estiramiento final, independiente de las otras dos ---
    verticalStretch: 1.0,   // alarga/achica el ojo YA CONSTRUIDO en vertical
    horizontalStretch: 1.0, // alarga/achica el ojo YA CONSTRUIDO en horizontal

    // --- posicion del par de ojos en la cara ---
    gapMult: 1.0,           // separacion lagrimal-a-lagrimal, en "longitudes de canto"
    vertOffsetMult: 0.06,   // desplazamiento vertical bajo la linea de ojos, fraccion del radio

    // --- CAPA 4: profundidad en 3D (pegado a la curvatura del rostro) ---
    // 0 = sigue exactamente la curvatura natural de la esfera craneal en
    // ese punto. Positivo = se aleja hacia adelante (mas cerca de camara
    // en vista frontal); negativo = se hunde hacia atras. Cada uno es
    // independiente, para poder "envolver" el ojo sobre la cara en vez de
    // dejarlo como una calcomania plana.
    lagrimalDepth: 0,
    centerDepth: 0,
    cantoDepth: 0,

    // --- CAPA 5: volumen de perfil (SOLO afecta la vista de perfil — la
    // vista frontal ignora Z por completo, así que estos valores nunca se
    // ven ahí). Antes el párpado superior e inferior compartían la misma
    // Z en cada punto, así que en perfil el ojo colapsaba casi a una
    // línea plana. Estos dos valores le dan volumen real a cada párpado
    // por separado, con un arco posicionable.
    profileUpperDepth: 0.05, // qué tanto se abulta hacia adelante el párpado superior, fracción del radio
    profileLowerDepth: 0.03, // qué tanto se abulta el párpado inferior (normalmente menos que el superior)
    profileArchPosition: 0.5 // dónde se ubica el pico de ese abultamiento (0=lagrimal, 1=canto)
}

// mismo truco anti z-fighting que las lineas de superficie en viewer.js
const EYE_SURFACE_OFFSET = 1.02

let eyesGroup = null
let rightEyeUpperLine = null
let rightEyeLowerLine = null
let leftEyeUpperLine = null
let leftEyeLowerLine = null
let rightEyeMat = null
let leftEyeMat = null
let currentBaseRadius = 0

// ✅ NUEVO: ajuste POR OJO (antes vivía solo en mode2d.js, como una capa
// aparte que no tocaba el modelo real — por eso los cambios en 2D no se
// veían en 3D). Ahora vive AQUÍ, y se aplica dentro de buildEyePoints, que
// es lo que usan TANTO el 3D (buildEyes) COMO el 2D (getEyeOutlines2D) —
// una sola fuente de verdad, así que ajustar en cualquiera de los dos
// modos mueve el mismo dato. Pivotea sobre el propio lagrimal (el ancla).
let eyeShapeAdjust = {
    right: { x: 0, y: -0.03, scale: 1.36, rotationDeg: -5 },
    left:  { x: -0.05, y: -0.05, scale: 1.28, rotationDeg: 0 }
}

// Curvas Bezier cubicas de verdad, como los manejadores de la pluma de
// Illustrator: cada esquina (lagrimal, canto) es un ancla FIJA; de cada una
// sale un manejador cuya posicion controla la forma:
//   - manejador CERCA de su esquina (a lo largo del eje) -> esquina picuda:
//     el parpado superior y el inferior llegan casi perpendiculares al eje
//     y se encuentran en punta.
//   - manejador LEJOS de su esquina -> esquina redondeada: ambas curvas
//     casi se funden en una, sin quiebre visible.
// innerSharp/outerSharp mueven la POSICION del manejador a lo largo del
// eje. upperLidBulge/lowerLidBulge controlan su ALTURA (que tan inflado
// se ve). Las cuatro combinadas dan control total sobre la forma, igual
// que arrastrar los dos tipos de manejador en Illustrator.

function cubicBezierPoint(p0, p1, p2, p3, t){
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const d = t * t * t
    return {
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
    }
}

// que tan lejos de su esquina se coloca el manejador, como fraccion del
// largo lagrimal-canto - picudo (sharp=1) -> manejador cerca (0.12);
// redondeado (sharp=0) -> manejador lejos (0.45)
function handleAxisFraction(sharp){
    return THREE.MathUtils.lerp(0.45, 0.12, THREE.MathUtils.clamp(sharp, 0, 1))
}

// interpola la profundidad entre las 3 anclas (lagrimal en axisT=0, centro
// en axisT=0.5, canto en axisT=1) - lineal por tramos, simple y predecible:
// mover un ancla solo afecta la mitad del ojo mas cercana a ella.
function depthOffsetAt(axisT){
    const p = eyeParams
    if(axisT <= 0.5){
        return THREE.MathUtils.lerp(p.lagrimalDepth, p.centerDepth, axisT / 0.5)
    }
    return THREE.MathUtils.lerp(p.centerDepth, p.cantoDepth, (axisT - 0.5) / 0.5)
}

// bulto simple (triangular) para el volumen de perfil: 0 en las esquinas,
// 1 en peakT - a diferencia de depthOffsetAt (que interpola profundidad
// GENERAL del ojo), este bulto es el que le da a cada párpado su propio
// abultamiento hacia adelante, con pico posicionable.
function lidDepthBump(axisT, peakT){
    const p = THREE.MathUtils.clamp(peakT, 0.02, 0.98)
    if(axisT <= p) return axisT / p
    return (1 - axisT) / (1 - p)
}

// Construye el contorno de UN ojo, ya en coordenadas absolutas dentro de
// loomisGroup (no relativas a un origen que luego se traduce aparte) -
// porque cada punto necesita su PROPIA profundidad Z, calculada sobre la
// curvatura real de la esfera en su X/Y exacto, mas el ajuste de las 3
// anclas de profundidad. mirrorX=true -> el canto se abre hacia la
// izquierda (ojo izquierdo); mirrorX=false -> hacia la derecha (ojo
// derecho). anchorX/anchorY ubican el lagrimal (el ancla, en el origen
// LOCAL del ojo antes de este paso) dentro de la cara.
function buildEyePoints(baseRadius, mirrorX, anchorX, anchorY){
    const p = eyeParams
    const segs = 24

    const angleRad = THREE.MathUtils.degToRad(p.cantoAngleDeg)
    const dirSign = mirrorX ? -1 : 1
    const dx = dirSign * Math.cos(angleRad)
    const dy = Math.sin(angleRad)

    const cantoLength = baseRadius * p.cantoLengthMult
    const outer = { x: dx * cantoLength, y: dy * cantoLength }
    const inner = { x: 0, y: 0 }

    // perpendicular al eje, elegida para que SIEMPRE apunte "hacia arriba"
    // (y >= 0) sin importar el signo de mirrorX - evita que el parpado
    // superior termine apuntando hacia abajo en el ojo espejado.
    let perpUpX = -dy
    let perpUpY = dx
    if(perpUpY < 0){
        perpUpX = dy
        perpUpY = -dx
    }
    const perpDownX = -perpUpX
    const perpDownY = -perpUpY

    const upperAmp = baseRadius * p.upperLidBulge
    const lowerAmp = baseRadius * p.lowerLidBulge

    // --- parpado superior: ancho completo, lagrimal (P0) -> canto (P3),
    // igual que antes ---
    const innerFrac = handleAxisFraction(p.innerSharp) * cantoLength
    const outerFrac = handleAxisFraction(p.outerSharp) * cantoLength

    const upP1 = {
        x: dx * innerFrac + perpUpX * upperAmp,
        y: dy * innerFrac + perpUpY * upperAmp
    }
    const upP2 = {
        x: outer.x - dx * outerFrac + perpUpX * upperAmp,
        y: outer.y - dy * outerFrac + perpUpY * upperAmp
    }

    const upperRaw = []
    for(let i = 0; i <= segs; i++){
        const t = i / segs // 0 = lagrimal, 1 = canto
        const pt = cubicBezierPoint(inner, upP1, upP2, outer, t)
        upperRaw.push({ x: pt.x, y: pt.y, axisT: t, side: 'upper' })
    }

    // ✅ NUEVO: "flick" del canto - continúa el párpado superior en línea
    // recta más allá de "outer", siguiendo la tangente de la curva en ese
    // punto (la dirección en la que ya venía "saliendo"), en vez de cerrar
    // justo en la esquina donde termina el párpado inferior.
    if(p.outerFlickLength > 0){
        let tanX = outer.x - upP2.x
        let tanY = outer.y - upP2.y
        const tanLen = Math.sqrt(tanX * tanX + tanY * tanY) || 1
        tanX /= tanLen
        tanY /= tanLen
        const flickLen = p.outerFlickLength * cantoLength
        upperRaw.push({
            x: outer.x + tanX * flickLen,
            y: outer.y + tanY * flickLen,
            axisT: 1,
            side: 'upper'
        })
    }

    // --- parpado inferior: YA NO comparte el lagrimal/canto exactos - su
    // propio inicio (inner2) y final (outer2) quedan insertados hacia
    // adentro del eje, según lowerLidInnerInset/lowerLidOuterInset. Un
    // trazo mas corto, independiente, en vez de la segunda mitad del
    // mismo lazo. ---
    const innerInsetLen = THREE.MathUtils.clamp(p.lowerLidInnerInset, 0, 0.45) * cantoLength
    const outerInsetLen = THREE.MathUtils.clamp(p.lowerLidOuterInset, 0, 0.45) * cantoLength
    const inner2 = { x: dx * innerInsetLen, y: dy * innerInsetLen }
    const outer2 = { x: outer.x - dx * outerInsetLen, y: outer.y - dy * outerInsetLen }
    const lowerAxisLen = Math.max(cantoLength - innerInsetLen - outerInsetLen, 0.0001)

    const lowerInnerFrac = handleAxisFraction(p.innerSharp) * lowerAxisLen
    const lowerOuterFrac = handleAxisFraction(p.outerSharp) * lowerAxisLen

    const loP1 = {
        x: outer2.x - dx * lowerOuterFrac + perpDownX * lowerAmp,
        y: outer2.y - dy * lowerOuterFrac + perpDownY * lowerAmp
    }
    const loP2 = {
        x: inner2.x + dx * lowerInnerFrac + perpDownX * lowerAmp,
        y: inner2.y + dy * lowerInnerFrac + perpDownY * lowerAmp
    }

    // ✅ CORREGIDO: la base plana NACE en el lagrimal (inner2) y, a medida
    // que crece, "se come" la curva hacia el lado del canto — no es un
    // tramo simétrico desde el centro. En baseWidth=0 es la curva normal
    // completa (almendra actual); en baseWidth=1 toda la curva se vuelve
    // una línea recta de outer2 a inner2.
    const cutFraction = lowerAxisLen > 0
        ? THREE.MathUtils.clamp((p.lowerLidBaseWidth * cantoLength) / lowerAxisLen, 0, 1)
        : 0
    const tCut = 1 - cutFraction
    const cutPoint = cutFraction > 0 ? cubicBezierPoint(outer2, loP1, loP2, inner2, tCut) : null

    const lowerRaw = []
    for(let i = 0; i <= segs; i++){
        const t = i / segs // 0 = canto2, 1 = lagrimal2 (orden invertido)
        let pt
        if(cutFraction > 0 && t > tCut){
            // más allá del punto de corte: línea recta hasta el lagrimal
            const localT = (t - tCut) / (1 - tCut)
            pt = {
                x: cutPoint.x + (inner2.x - cutPoint.x) * localT,
                y: cutPoint.y + (inner2.y - cutPoint.y) * localT
            }
        } else {
            pt = cubicBezierPoint(outer2, loP1, loP2, inner2, t)
        }
        // axisT se recalcula en la escala ORIGINAL (0=lagrimal real,
        // 1=canto real) para que depthOffsetAt/lidDepthBump sigan
        // interpolando correctamente contra las anclas de profundidad.
        const realAxisT = (cantoLength - outerInsetLen - t * lowerAxisLen) / cantoLength
        lowerRaw.push({ x: pt.x, y: pt.y, axisT: realAxisT, side: 'lower' })
    }

    // CAPA 3: estiramiento final, aplicado alrededor del centro del eje
    // (punto medio lagrimal-canto) para que estire la forma ya construida
    // sin desplazar el conjunto - independiente de como se construyo arriba.
    const centerX = outer.x / 2
    const centerY = outer.y / 2

    // CAPA 4: profundidad por punto - cada uno se "pega" a la curvatura de
    // la esfera en su X/Y exacto (como las demas lineas de superficie),
    // mas el ajuste interpolado entre las 3 anclas de profundidad.
    const surfaceR = baseRadius * EYE_SURFACE_OFFSET

    // ✅ ajuste por ojo (compartido con el modo 2D) - pivotea sobre
    // el lagrimal (origen local, ANTES de sumar el ancla en la cara). Los
    // offsets se escalan por baseRadius para comportarse igual en 2D
    // (baseRadius=1) y en 3D (baseRadius=loomisBaseRadius).
    const adjust = mirrorX ? eyeShapeAdjust.left : eyeShapeAdjust.right
    const adjRad = THREE.MathUtils.degToRad(adjust.rotationDeg)
    const cosAdj = Math.cos(adjRad)
    const sinAdj = Math.sin(adjRad)

    function transformPoint({ x, y, axisT, side }){
        const sx = centerX + (x - centerX) * p.horizontalStretch
        const sy = centerY + (y - centerY) * p.verticalStretch

        const ax = (sx * cosAdj - sy * sinAdj) * adjust.scale + adjust.x * baseRadius
        const ay = (sx * sinAdj + sy * cosAdj) * adjust.scale + adjust.y * baseRadius

        const worldX = anchorX + ax
        const worldY = anchorY + ay

        const naturalZ = Math.sqrt(Math.max(surfaceR * surfaceR - worldX * worldX - worldY * worldY, 0.0001))
        const lidAmp = side === 'upper' ? p.profileUpperDepth : p.profileLowerDepth
        const lidBulge = lidAmp * lidDepthBump(axisT, p.profileArchPosition) * baseRadius
        const z = naturalZ + depthOffsetAt(axisT) * baseRadius + lidBulge

        return new THREE.Vector3(worldX, worldY, z)
    }

    return {
        upper: upperRaw.map(transformPoint),
        lower: lowerRaw.map(transformPoint)
    }
}


function buildEyes(baseRadius){
    if(!eyesGroup || !baseRadius) return

    while(eyesGroup.children.length){
        eyesGroup.remove(eyesGroup.children[0])
    }

    const cantoLength = baseRadius * eyeParams.cantoLengthMult
    const gap = cantoLength * eyeParams.gapMult
    const anchorX = gap / 2 // distancia del lagrimal al centro de la cara
    const anchorY = -baseRadius * eyeParams.vertOffsetMult

    // ✅ cada punto ya trae su X/Y/Z absolutos (ver buildEyePoints), así que
    // las líneas se agregan sin traducción extra. El párpado superior e
    // inferior son AHORA DOS trazos abiertos independientes (no un lazo
    // cerrado) — comparten material por ojo, ya que se ocultan/muestran
    // juntos con el mismo toggle de oclusión.
    rightEyeMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: true, depthWrite: false })
    const rightPts = buildEyePoints(baseRadius, false, anchorX, anchorY)
    rightEyeUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts.upper), rightEyeMat)
    rightEyeUpperLine.renderOrder = 999
    eyesGroup.add(rightEyeUpperLine)
    rightEyeLowerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts.lower), rightEyeMat)
    rightEyeLowerLine.renderOrder = 999
    eyesGroup.add(rightEyeLowerLine)

    leftEyeMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: true, depthWrite: false })
    const leftPts = buildEyePoints(baseRadius, true, -anchorX, anchorY)
    leftEyeUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts.upper), leftEyeMat)
    leftEyeUpperLine.renderOrder = 999
    eyesGroup.add(leftEyeUpperLine)
    leftEyeLowerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts.lower), leftEyeMat)
    leftEyeLowerLine.renderOrder = 999
    eyesGroup.add(leftEyeLowerLine)
}

// Llamar desde viewer.js, dentro/despues de createLoomisGuide, pasando el
// loomisGroup (para que los ojos hereden posicion/rotacion de la cabeza
// automaticamente) y el loomisBaseRadius ya calculado.
export function createEyeGuides(loomisGroup, loomisBaseRadius){
    removeEyeGuides()
    if(!loomisGroup || !loomisBaseRadius) return

    currentBaseRadius = loomisBaseRadius
    eyesGroup = new THREE.Group()
    loomisGroup.add(eyesGroup)

    buildEyes(currentBaseRadius)
}

export function removeEyeGuides(){
    if(eyesGroup && eyesGroup.parent) eyesGroup.parent.remove(eyesGroup)
    eyesGroup = null
    rightEyeUpperLine = null
    rightEyeLowerLine = null
    leftEyeUpperLine = null
    leftEyeLowerLine = null
    rightEyeMat = null
    leftEyeMat = null
}

function rebuild(){
    if(currentBaseRadius) buildEyes(currentBaseRadius)
}

// setters - CAPA 1 (eje)
export function setCantoLength(mult){ eyeParams.cantoLengthMult = mult; rebuild() }
export function setCantoAngle(degrees){ eyeParams.cantoAngleDeg = degrees; rebuild() }

// setters - CAPA 2 (manejadores Bezier)
export function setUpperLidBulge(mult){ eyeParams.upperLidBulge = mult; rebuild() }
export function setLowerLidBulge(mult){ eyeParams.lowerLidBulge = mult; rebuild() }
export function setInnerSharp(value){ eyeParams.innerSharp = value; rebuild() }
export function setOuterSharp(value){ eyeParams.outerSharp = value; rebuild() }
export function setLowerLidInnerInset(value){ eyeParams.lowerLidInnerInset = value; rebuild() }
export function setLowerLidOuterInset(value){ eyeParams.lowerLidOuterInset = value; rebuild() }
export function setLowerLidBaseWidth(value){ eyeParams.lowerLidBaseWidth = value; rebuild() }
export function setOuterFlickLength(value){ eyeParams.outerFlickLength = value; rebuild() }

// setters - CAPA 3 (estiramiento final)
export function setEyeVerticalStretch(mult){ eyeParams.verticalStretch = mult; rebuild() }
export function setEyeHorizontalStretch(mult){ eyeParams.horizontalStretch = mult; rebuild() }

// setters - posicion del par en la cara
export function setEyeGap(mult){ eyeParams.gapMult = mult; rebuild() }
export function setEyeVerticalOffset(mult){ eyeParams.vertOffsetMult = mult; rebuild() }

// setters/getter - ajuste POR OJO (derecho/izquierdo), compartido entre
// el modo 2D y el 3D — side es 'right' o 'left'.
export function setEyeShapeOffsetX(side, value){ if(eyeShapeAdjust[side]){ eyeShapeAdjust[side].x = value; rebuild() } }
export function setEyeShapeOffsetY(side, value){ if(eyeShapeAdjust[side]){ eyeShapeAdjust[side].y = value; rebuild() } }
export function setEyeShapeScale(side, value){ if(eyeShapeAdjust[side]){ eyeShapeAdjust[side].scale = value; rebuild() } }
export function setEyeShapeRotation(side, degrees){ if(eyeShapeAdjust[side]){ eyeShapeAdjust[side].rotationDeg = degrees; rebuild() } }
export function getEyeShapeAdjust(side){ return eyeShapeAdjust[side] || eyeShapeAdjust.right }

// expone SOLO la curva del párpado superior — para que eyelashes.js pueda
// apoyar la pestaña directamente sobre esta curva en vez de construir su
// propio eje. Ya incluye TODO lo que afecta al ojo (ajuste por ojo,
// estiramiento, profundidad), así la pestaña queda automáticamente pegada
// al párpado sin duplicar lógica.
export function getEyeUpperLidPoints(baseRadius){
    const cantoLength = baseRadius * eyeParams.cantoLengthMult
    const gap = cantoLength * eyeParams.gapMult
    const anchorX = gap / 2
    const anchorY = -baseRadius * eyeParams.vertOffsetMult

    const rightFull = buildEyePoints(baseRadius, false, anchorX, anchorY)
    const leftFull = buildEyePoints(baseRadius, true, -anchorX, anchorY)

    return {
        right: rightFull.upper,
        left: leftFull.upper
    }
}

// expone el contorno COMPLETO del ojo (párpado superior + inferior juntos,
// aunque ya no sean un lazo cerrado) — para que pupils.js pueda calcular
// el centro y tamaño del iris a partir de la caja del ojo real.
export function getEyeFullPoints(baseRadius){
    const cantoLength = baseRadius * eyeParams.cantoLengthMult
    const gap = cantoLength * eyeParams.gapMult
    const anchorX = gap / 2
    const anchorY = -baseRadius * eyeParams.vertOffsetMult

    const right = buildEyePoints(baseRadius, false, anchorX, anchorY)
    const left = buildEyePoints(baseRadius, true, -anchorX, anchorY)

    return {
        right: [...right.upper, ...right.lower],
        left: [...left.upper, ...left.lower]
    }
}

// setters - CAPA 4 (profundidad en 3D: lagrimal, centro, canto)
export function setLagrimalDepth(mult){ eyeParams.lagrimalDepth = mult; rebuild() }
export function setCenterDepth(mult){ eyeParams.centerDepth = mult; rebuild() }
export function setCantoDepth(mult){ eyeParams.cantoDepth = mult; rebuild() }

// setters - CAPA 5 (volumen de perfil: solo se ve en la vista de perfil)
export function setProfileUpperDepth(mult){ eyeParams.profileUpperDepth = mult; rebuild() }
export function setProfileLowerDepth(mult){ eyeParams.profileLowerDepth = mult; rebuild() }
export function setProfileArchPosition(value){ eyeParams.profileArchPosition = value; rebuild() }

// para conectar con el toggle "respetar oclusion" existente en viewer.js -
// llamar setEyeOcclusion(respectOcclusion) junto con
// setLoomisRespectOcclusion, ya que los materiales de ojos viven en este
// archivo y no estan dentro del array loomisMaterials de viewer.js.
export function setEyeOcclusion(respectOcclusion){
    ;[rightEyeMat, leftEyeMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}

// ✅ silueta 2D de los ojos, para el modo de calibracion contra
// referencia (mode2d.js). Reutiliza EXACTAMENTE la misma funcion de
// construccion que el 3D (buildEyePoints) con baseRadius=1 (unidades
// normalizadas, sin depender de si hay un modelo 3D cargado) - asi el 2D
// y el 3D nunca se desincronizan. Devuelve upper/lower POR SEPARADO (ya
// no es un lazo cerrado) — quien dibuje esto debe trazar dos líneas
// abiertas, no una forma cerrada.
export function getEyeOutlines2D(){
    const baseRadius = 1
    const cantoLength = baseRadius * eyeParams.cantoLengthMult
    const gap = cantoLength * eyeParams.gapMult
    const anchorX = gap / 2
    const anchorY = -baseRadius * eyeParams.vertOffsetMult

    const right = buildEyePoints(baseRadius, false, anchorX, anchorY)
    const left = buildEyePoints(baseRadius, true, -anchorX, anchorY)

    const flat = v => ({ x: v.x, y: v.y, z: v.z })

    return {
        right: { upper: right.upper.map(flat), lower: right.lower.map(flat) },
        left: { upper: left.upper.map(flat), lower: left.lower.map(flat) }
    }
}
