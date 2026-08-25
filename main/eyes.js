import * as THREE from 'three'

// ✅ REESCRITO: modelo de ojo en 3 capas, según construcción anatómica real
// (lagrimal → canto como eje base, párpados como "carne" sobre ese eje,
// estiramiento final aparte) en vez de una elipse con una sola inclinación
// global. Sigue colgando del mismo loomisGroup que la cabeza — mismo
// patrón que antes, solo cambia CÓMO se genera la forma.

// ⚠️ Valores iniciales estimados a ojo desde la referencia frontal
// (IMG_3395). Punto de partida para calibrar en vivo con los sliders.
let eyeParams = {
    // --- CAPA 1: el eje (lagrimal fijo, canto se mueve) ---
    cantoLengthMult: 0.40,  // distancia lagrimal→canto, fracción del radio de cabeza
    cantoAngleDeg: 8,       // ángulo del canto respecto al lagrimal — positivo = canto sube hacia la ceja

    // --- CAPA 2: la carne sobre ese eje ---
    upperLidBulge: 0.14,    // qué tanto se infla el párpado superior, fracción del radio de cabeza (anime = alto)
    lowerLidBulge: 0.08,    // qué tanto se infla el párpado inferior (normalmente menor que el superior)
    innerSharp: 0.30,       // 0 = lagrimal redondeado, 1 = lagrimal picudo
    outerSharp: 0.60,       // 0 = canto redondeado, 1 = canto picudo (el canto suele ser más picudo que el lagrimal)

    // --- CAPA 3: estiramiento final, independiente de las otras dos ---
    verticalStretch: 1.0,   // alarga/achica el ojo YA CONSTRUIDO en vertical
    horizontalStretch: 1.0, // alarga/achica el ojo YA CONSTRUIDO en horizontal

    // --- posición del par de ojos en la cara (sin cambios de antes) ---
    gapMult: 1.0,           // separación lagrimal-a-lagrimal, en "longitudes de canto"
    vertOffsetMult: 0.06    // desplazamiento vertical bajo la línea de ojos, fracción del radio
}

// mismo truco anti z-fighting que las líneas de superficie en viewer.js
const EYE_SURFACE_OFFSET = 1.02

let eyesGroup = null
let rightEyeLine = null
let leftEyeLine = null
let rightEyeMat = null
let leftEyeMat = null
let currentBaseRadius = 0

// convierte "picudez" (0-1) en un exponente para la función de inflado:
// exponente bajo (≈1) = la curva se separa del eje de inmediato → esquina
// redondeada. Exponente alto (≈5) = la curva se queda pegada al eje y
// recién se separa tarde → esquina picuda.
function sharpToExponent(sharp){
    return 1 + THREE.MathUtils.clamp(sharp, 0, 1) * 4
}

// función de "inflado" a lo largo del eje (t: 0 = lagrimal, 1 = canto),
// normalizada para que su punto más alto valga exactamente 1 — así el
// parámetro de bulge (upperLidBulge/lowerLidBulge) es la altura real, sin
// tener que adivinar cómo se relaciona con los exponentes de picudez.
function bulgeShape(t, innerExp, outerExp){
    const tPeak = innerExp / (innerExp + outerExp)
    const peak = Math.pow(tPeak, innerExp) * Math.pow(1 - tPeak, outerExp)
    if(peak <= 0) return 0
    const raw = Math.pow(t, innerExp) * Math.pow(1 - t, outerExp)
    return raw / peak
}

// Construye el contorno de UN ojo. mirrorX=true → el canto se abre hacia
// la izquierda (para el ojo izquierdo); mirrorX=false → hacia la derecha.
// El lagrimal SIEMPRE queda fijo en el origen local (0,0) — es el ancla;
// todo lo demás (canto, párpados, estiramiento) se construye a partir de él.
function buildEyePoints(baseRadius, mirrorX){
    const p = eyeParams
    const segs = 24

    const angleRad = THREE.MathUtils.degToRad(p.cantoAngleDeg)
    const dirSign = mirrorX ? -1 : 1
    const dx = dirSign * Math.cos(angleRad)
    const dy = Math.sin(angleRad)

    const cantoLength = baseRadius * p.cantoLengthMult
    const outer = { x: dx * cantoLength, y: dy * cantoLength }

    // perpendicular al eje, elegida para que SIEMPRE apunte "hacia arriba"
    // (y >= 0) sin importar el signo de mirrorX — evita que el párpado
    // superior termine apuntando hacia abajo en el ojo espejado.
    let perpUpX = -dy
    let perpUpY = dx
    if(perpUpY < 0){
        perpUpX = dy
        perpUpY = -dx
    }
    const perpDownX = -perpUpX
    const perpDownY = -perpUpY

    const innerExp = sharpToExponent(p.innerSharp)
    const outerExp = sharpToExponent(p.outerSharp)
    const upperAmp = baseRadius * p.upperLidBulge
    const lowerAmp = baseRadius * p.lowerLidBulge

    const raw = []

    // párpado superior: lagrimal (t=0) → canto (t=1)
    for(let i = 0; i <= segs; i++){
        const t = i / segs
        const amp = upperAmp * bulgeShape(t, innerExp, outerExp)
        raw.push({
            x: t * outer.x + perpUpX * amp,
            y: t * outer.y + perpUpY * amp
        })
    }

    // párpado inferior: canto (t=1) → lagrimal (t=0), cerrando el lazo
    for(let i = segs; i >= 0; i--){
        const t = i / segs
        const amp = lowerAmp * bulgeShape(t, innerExp, outerExp)
        raw.push({
            x: t * outer.x + perpDownX * amp,
            y: t * outer.y + perpDownY * amp
        })
    }

    // ✅ CAPA 3: estiramiento final, aplicado alrededor del centro del eje
    // (punto medio lagrimal-canto) para que estire la forma ya construida
    // sin desplazar el conjunto — independiente de cómo se construyó arriba.
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

// ✅ llamar desde viewer.js, dentro/después de createLoomisGuide, pasando
// el loomisGroup (para que los ojos hereden posición/rotación de la cabeza
// automáticamente) y el loomisBaseRadius ya calculado.
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

// ✅ setters — CAPA 1 (eje)
export function setCantoLength(mult){ eyeParams.cantoLengthMult = mult; rebuild() }
export function setCantoAngle(degrees){ eyeParams.cantoAngleDeg = degrees; rebuild() }

// ✅ setters — CAPA 2 (carne)
export function setUpperLidBulge(mult){ eyeParams.upperLidBulge = mult; rebuild() }
export function setLowerLidBulge(mult){ eyeParams.lowerLidBulge = mult; rebuild() }
export function setInnerSharp(value){ eyeParams.innerSharp = value; rebuild() }
export function setOuterSharp(value){ eyeParams.outerSharp = value; rebuild() }

// ✅ setters — CAPA 3 (estiramiento final)
export function setEyeVerticalStretch(mult){ eyeParams.verticalStretch = mult; rebuild() }
export function setEyeHorizontalStretch(mult){ eyeParams.horizontalStretch = mult; rebuild() }

// ✅ setters — posición del par en la cara (sin cambios respecto a antes)
export function setEyeGap(mult){ eyeParams.gapMult = mult; rebuild() }
export function setEyeVerticalOffset(mult){ eyeParams.vertOffsetMult = mult; rebuild() }

// ✅ para conectar con el toggle "respetar oclusión" existente en
// viewer.js — llamar setEyeOcclusion(respectOcclusion) junto con
// setLoomisRespectOcclusion, ya que los materiales de ojos viven en este
// archivo y no están dentro del array loomisMaterials de viewer.js.
export function setEyeOcclusion(respectOcclusion){
    ;[rightEyeMat, leftEyeMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}
