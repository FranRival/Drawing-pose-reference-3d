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

    // --- CAPA 3: estiramiento final, independiente de las otras dos ---
    verticalStretch: 1.0,   // alarga/achica el ojo YA CONSTRUIDO en vertical
    horizontalStretch: 1.0, // alarga/achica el ojo YA CONSTRUIDO en horizontal

    // --- posicion del par de ojos en la cara ---
    gapMult: 1.0,           // separacion lagrimal-a-lagrimal, en "longitudes de canto"
    vertOffsetMult: 0.06    // desplazamiento vertical bajo la linea de ojos, fraccion del radio
}

// mismo truco anti z-fighting que las lineas de superficie en viewer.js
const EYE_SURFACE_OFFSET = 1.02

let eyesGroup = null
let rightEyeLine = null
let leftEyeLine = null
let rightEyeMat = null
let leftEyeMat = null
let currentBaseRadius = 0

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

// Construye el contorno de UN ojo. mirrorX=true -> el canto se abre hacia
// la izquierda (para el ojo izquierdo); mirrorX=false -> hacia la derecha.
// El lagrimal SIEMPRE queda fijo en el origen local (0,0) - es el ancla;
// todo lo demas (canto, manejadores, estiramiento) se construye a partir
// de el.
function buildEyePoints(baseRadius, mirrorX){
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

    const innerFrac = handleAxisFraction(p.innerSharp) * cantoLength
    const outerFrac = handleAxisFraction(p.outerSharp) * cantoLength
    const upperAmp = baseRadius * p.upperLidBulge
    const lowerAmp = baseRadius * p.lowerLidBulge

    const raw = []

    // --- parpado superior: Bezier cubica lagrimal (P0) -> canto (P3) ---
    const upP1 = {
        x: dx * innerFrac + perpUpX * upperAmp,
        y: dy * innerFrac + perpUpY * upperAmp
    }
    const upP2 = {
        x: outer.x - dx * outerFrac + perpUpX * upperAmp,
        y: outer.y - dy * outerFrac + perpUpY * upperAmp
    }
    for(let i = 0; i <= segs; i++){
        raw.push(cubicBezierPoint(inner, upP1, upP2, outer, i / segs))
    }

    // --- parpado inferior: Bezier cubica canto (P0) -> lagrimal (P3) ---
    // (arranca donde termino el parpado superior, para cerrar el lazo)
    const loP1 = {
        x: outer.x - dx * outerFrac + perpDownX * lowerAmp,
        y: outer.y - dy * outerFrac + perpDownY * lowerAmp
    }
    const loP2 = {
        x: dx * innerFrac + perpDownX * lowerAmp,
        y: dy * innerFrac + perpDownY * lowerAmp
    }
    for(let i = 0; i <= segs; i++){
        raw.push(cubicBezierPoint(outer, loP1, loP2, inner, i / segs))
    }

    // CAPA 3: estiramiento final, aplicado alrededor del centro del eje
    // (punto medio lagrimal-canto) para que estire la forma ya construida
    // sin desplazar el conjunto - independiente de como se construyo arriba.
    const centerX = outer.x / 2
    const centerY = outer.y / 2

    return raw.map(pt => new THREE.Vector3(
        centerX + (pt.x - centerX) * p.horizontalStretch,
        centerY + (pt.y - centerY) * p.verticalStretch,
        0
    ))
}

function computeEyeZ(baseRadius, x, y){
    const surfaceR = baseRadius * EYE_SURFACE_OFFSET
    return Math.sqrt(Math.max(surfaceR * surfaceR - x * x - y * y, 0.0001))
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

    rightEyeMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: true, depthWrite: false })
    const rightPts = buildEyePoints(baseRadius, false)
    rightEyeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightEyeMat)
    rightEyeLine.position.set(anchorX, anchorY, computeEyeZ(baseRadius, anchorX, anchorY))
    rightEyeLine.renderOrder = 999
    eyesGroup.add(rightEyeLine)

    leftEyeMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: true, depthWrite: false })
    const leftPts = buildEyePoints(baseRadius, true)
    leftEyeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), leftEyeMat)
    leftEyeLine.position.set(-anchorX, anchorY, computeEyeZ(baseRadius, -anchorX, anchorY))
    leftEyeLine.renderOrder = 999
    eyesGroup.add(leftEyeLine)
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
    rightEyeLine = null
    leftEyeLine = null
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

// setters - CAPA 3 (estiramiento final)
export function setEyeVerticalStretch(mult){ eyeParams.verticalStretch = mult; rebuild() }
export function setEyeHorizontalStretch(mult){ eyeParams.horizontalStretch = mult; rebuild() }

// setters - posicion del par en la cara
export function setEyeGap(mult){ eyeParams.gapMult = mult; rebuild() }
export function setEyeVerticalOffset(mult){ eyeParams.vertOffsetMult = mult; rebuild() }

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
