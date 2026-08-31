import * as THREE from 'three'
import { getEyeUpperLidPoints, getEyeLowerLidPoints } from './eyes.js'

// Pestañas: TRES estilos.
//   'shadow'  - banda sobre el párpado superior + banda delgada inferior,
//               ambas independientes, sin pico.
//   'spikes'  - igual, pero con dentado + pico grande en el canto (se
//               cierra sobre SÍ MISMO — nunca toca la pestaña inferior).
//   'fusion'  - UN SOLO contorno cerrado que envuelve todo el ojo: nace
//               fino en el lagrimal, se engruesa con dentado hacia el
//               canto, remata en una PUNTA afilada ahí, y desde esa misma
//               punta baja envolviendo el párpado inferior hasta cerrar
//               de vuelta cerca del lagrimal. Nunca son dos piezas — es
//               una sola línea de principio a fin.

let lashParams = {
    style: 'shadow', // 'shadow' | 'spikes' | 'fusion'
    innerThickness: 0.02,
    outerThickness: 0.05,

    lowerLashInnerThickness: 0.008,
    lowerLashOuterThickness: 0.018,

    cantoSpikeLength: 0.09,
    cantoSpikeCurve: 0.02,
    cantoSpikeScale: 1.0,
    cantoSpikeTipRotation: 0,

    lashSpikeCount: 5,
    lashSpikeAmplitude: 0.03
}

let lashGroup = null
let rightUpperLine = null
let leftUpperLine = null
let rightLowerLine = null
let leftLowerLine = null
let rightLashMat = null
let leftLashMat = null
let currentBaseRadius = 0

function quadraticBezierPoint(p0, p1, p2, t){
    const mt = 1 - t
    return {
        x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
        y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
    }
}

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

function spikeModulation(t, count){
    const phase = (t * count) % 1
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2
    const bias = THREE.MathUtils.lerp(0.25, 1.0, t)
    return tri * bias
}

function localPerpUp(points, i){
    const n = points.length
    const prev = points[Math.max(i - 1, 0)]
    const next = points[Math.min(i + 1, n - 1)]
    let tx = next.x - prev.x
    let ty = next.y - prev.y
    const len = Math.sqrt(tx * tx + ty * ty) || 1
    tx /= len
    ty /= len
    let px = -ty
    let py = tx
    if(py < 0){ px = -px; py = -py }
    return { px, py }
}

// ✅ Pestaña SUPERIOR autosuficiente (estilos 'shadow' y 'spikes'). Cierra
// siempre contra su propio párpado superior — nunca toca el inferior.
// mirrorX indica si es el ojo espejado (izquierdo), necesario para que la
// orientación absoluta de la punta funcione igual en ambos ojos.
function buildUpperLashPoints(baseRadius, lidPoints, mirrorX){
    const n = lidPoints.length
    if(n < 2) return []

    const useSpike = lashParams.style === 'spikes'
    const spikeAmp = baseRadius * lashParams.lashSpikeAmplitude

    const offsetPts = lidPoints.map((p, i) => {
        const { px, py } = localPerpUp(lidPoints, i)
        const t = i / (n - 1)
        let thickness = THREE.MathUtils.lerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius
        if(useSpike){
            thickness += spikeAmp * spikeModulation(t, lashParams.lashSpikeCount)
        }
        return { x: p.x + px * thickness, y: p.y + py * thickness, z: p.z }
    })

    const pts = [...offsetPts]

    if(useSpike){
        const cantoBase = offsetPts[offsetPts.length - 1]
        const trueCanto = lidPoints[n - 1]

        // ✅ CORREGIDO: orientación ABSOLUTA, no relativa a la tangente del
        // párpado (eso era lo que causaba el cruce de líneas). 0° = hacia
        // la oreja (horizontal); positivo = hacia la coronilla; negativo
        // = hacia el cuello. Igual para ambos ojos gracias a dirSign.
        const dirSign = mirrorX ? -1 : 1
        const rotRad = THREE.MathUtils.degToRad(lashParams.cantoSpikeTipRotation)
        const tipDirX = dirSign * Math.cos(rotRad)
        const tipDirY = Math.sin(rotRad)

        const perpX = -tipDirY
        const perpY = tipDirX

        const length = baseRadius * lashParams.cantoSpikeLength * lashParams.cantoSpikeScale
        const curve = baseRadius * lashParams.cantoSpikeCurve

        const tip = { x: cantoBase.x + tipDirX * length, y: cantoBase.y + tipDirY * length }

        const controlTop = {
            x: (cantoBase.x + tip.x) / 2 + perpX * curve,
            y: (cantoBase.y + tip.y) / 2 + perpY * curve
        }
        const controlBottom = {
            x: (tip.x + trueCanto.x) / 2 - perpX * curve,
            y: (tip.y + trueCanto.y) / 2 - perpY * curve
        }

        const segs = 8
        for(let i = 1; i <= segs; i++) pts.push(quadraticBezierPoint(cantoBase, controlTop, tip, i / segs))
        for(let i = 1; i <= segs; i++) pts.push(quadraticBezierPoint(tip, controlBottom, trueCanto, i / segs))
    }

    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])

    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

// ✅ Pestaña INFERIOR autosuficiente (estilos 'shadow' y 'spikes').
function buildLowerLashPoints(baseRadius, lidPoints){
    const n = lidPoints.length
    if(n < 2) return []

    const offsetPts = lidPoints.map((p, i) => {
        const { px, py } = localPerpUp(lidPoints, i)
        const t = i / (n - 1) // 0 = canto, 1 = lagrimal
        const thickness = THREE.MathUtils.lerp(lashParams.lowerLashOuterThickness, lashParams.lowerLashInnerThickness, t) * baseRadius
        return { x: p.x - px * thickness, y: p.y - py * thickness, z: p.z }
    })

    const pts = [...offsetPts]
    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])
    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

// ✅ NUEVO — modo 'fusion': UN SOLO contorno cerrado, sin bordes internos.
// Recorrido: lagrimal (fino) → borde exterior superior (dentado, se
// engruesa) → canto → PICO en punta → baja hasta el borde exterior
// inferior (en su lado del canto) → borde exterior inferior (se afina) →
// cierra de vuelta cerca del lagrimal. Nunca usa las curvas "verdaderas"
// del párpado como borde interno — por eso no puede entrelazarse consigo
// misma.
function buildFusedLashPoints(baseRadius, upperLidPoints, lowerLidPoints, mirrorX){
    const nu = upperLidPoints.length
    const nl = lowerLidPoints.length
    if(nu < 2 || nl < 2) return []

    const spikeAmp = baseRadius * lashParams.lashSpikeAmplitude

    // borde exterior superior: lagrimal → canto (con dentado)
    const upperOuter = upperLidPoints.map((p, i) => {
        const { px, py } = localPerpUp(upperLidPoints, i)
        const t = i / (nu - 1)
        const thickness = THREE.MathUtils.lerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius
            + spikeAmp * spikeModulation(t, lashParams.lashSpikeCount)
        return { x: p.x + px * thickness, y: p.y + py * thickness, z: p.z }
    })

    // pico del canto: cantoBase → punta afilada
    const cantoBase = upperOuter[upperOuter.length - 1]

    // ✅ CORREGIDO: orientación ABSOLUTA (igual que en buildUpperLashPoints)
    // — 0° = hacia la oreja, positivo = hacia la coronilla, negativo =
    // hacia el cuello. Ya no depende de la tangente del párpado.
    const dirSign = mirrorX ? -1 : 1
    const rotRad = THREE.MathUtils.degToRad(lashParams.cantoSpikeTipRotation)
    const tipDirX = dirSign * Math.cos(rotRad)
    const tipDirY = Math.sin(rotRad)

    const perpX = -tipDirY
    const perpY = tipDirX

    const length = baseRadius * lashParams.cantoSpikeLength * lashParams.cantoSpikeScale
    const curve = baseRadius * lashParams.cantoSpikeCurve

    const tip = { x: cantoBase.x + tipDirX * length, y: cantoBase.y + tipDirY * length, z: cantoBase.z }

    // borde exterior inferior: canto → lagrimal (se afina)
    const lowerOuter = lowerLidPoints.map((p, i) => {
        const { px, py } = localPerpUp(lowerLidPoints, i)
        const t = i / (nl - 1) // 0 = canto, 1 = lagrimal
        const thickness = THREE.MathUtils.lerp(lashParams.lowerLashOuterThickness, lashParams.lowerLashInnerThickness, t) * baseRadius
        return { x: p.x - px * thickness, y: p.y - py * thickness, z: p.z }
    })

    const controlTop = {
        x: (cantoBase.x + tip.x) / 2 + perpX * curve,
        y: (cantoBase.y + tip.y) / 2 + perpY * curve
    }

    // ✅ la bajada de la punta hacia la pestaña inferior es una Bezier
    // CÚBICA (dos manejadores), no una cuadrática con un solo punto de
    // control fijo. El manejador de llegada se alinea con la dirección
    // REAL en la que continúa la pestaña inferior (hacia lowerOuter[1]) —
    // eso es lo que garantiza que no haya un ángulo recto ahí: la curva
    // "entra" ya apuntando hacia donde sigue el trazo.
    let lowerTanX = lowerOuter[1].x - lowerOuter[0].x
    let lowerTanY = lowerOuter[1].y - lowerOuter[0].y
    const lowerTanLen = Math.sqrt(lowerTanX * lowerTanX + lowerTanY * lowerTanY) || 1
    lowerTanX /= lowerTanLen
    lowerTanY /= lowerTanLen

    const gapDist = Math.sqrt(
        (tip.x - lowerOuter[0].x) * (tip.x - lowerOuter[0].x) +
        (tip.y - lowerOuter[0].y) * (tip.y - lowerOuter[0].y)
    )
    const handleLen = gapDist * 0.4

    const handleOut = {
        x: tip.x + tipDirX * handleLen + perpX * curve,
        y: tip.y + tipDirY * handleLen + perpY * curve
    }
    const handleIn = {
        x: lowerOuter[0].x - lowerTanX * handleLen - perpX * curve,
        y: lowerOuter[0].y - lowerTanY * handleLen - perpY * curve
    }

    const pts = [...upperOuter]

    const segs = 8
    // cantoBase → punta
    for(let i = 1; i <= segs; i++) pts.push(quadraticBezierPoint(cantoBase, controlTop, tip, i / segs))
    // punta → borde exterior inferior, lado canto (cúbica, tangente alineada)
    for(let i = 1; i <= segs; i++) pts.push(cubicBezierPoint(tip, handleOut, handleIn, lowerOuter[0], i / segs))

    // borde exterior inferior completo (ya empieza en lowerOuter[0])
    pts.push(...lowerOuter.slice(1))

    // cierre final: del extremo lagrimal inferior de vuelta al lagrimal
    // superior (un segmento corto, cierra el lazo)
    pts.push(upperOuter[0])

    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

function buildLashes(baseRadius){
    if(!lashGroup || !baseRadius) return

    while(lashGroup.children.length){
        lashGroup.remove(lashGroup.children[0])
    }

    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(baseRadius)
    const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(baseRadius)

    rightLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })
    leftLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })

    if(lashParams.style === 'fusion'){
        const rightPts = buildFusedLashPoints(baseRadius, upperRight, lowerRight, false)
        rightUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightLashMat)
        rightUpperLine.renderOrder = 999
        lashGroup.add(rightUpperLine)
        rightLowerLine = null

        const leftPts = buildFusedLashPoints(baseRadius, upperLeft, lowerLeft, true)
        leftUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), leftLashMat)
        leftUpperLine.renderOrder = 999
        lashGroup.add(leftUpperLine)
        leftLowerLine = null
        return
    }

    const rightUpperPts = buildUpperLashPoints(baseRadius, upperRight, false)
    rightUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightUpperPts), rightLashMat)
    rightUpperLine.renderOrder = 999
    lashGroup.add(rightUpperLine)

    const leftUpperPts = buildUpperLashPoints(baseRadius, upperLeft, true)
    leftUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftUpperPts), leftLashMat)
    leftUpperLine.renderOrder = 999
    lashGroup.add(leftUpperLine)

    const rightLowerPts = buildLowerLashPoints(baseRadius, lowerRight)
    rightLowerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightLowerPts), rightLashMat)
    rightLowerLine.renderOrder = 999
    lashGroup.add(rightLowerLine)

    const leftLowerPts = buildLowerLashPoints(baseRadius, lowerLeft)
    leftLowerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftLowerPts), leftLashMat)
    leftLowerLine.renderOrder = 999
    lashGroup.add(leftLowerLine)
}

// Llamar desde viewer.js, después de createEyeGuides (necesita que el ojo
// ya exista para poder apoyarse en su curva).
export function createEyelashGuides(loomisGroup, loomisBaseRadius){
    removeEyelashGuides()
    if(!loomisGroup || !loomisBaseRadius) return

    currentBaseRadius = loomisBaseRadius
    lashGroup = new THREE.Group()
    loomisGroup.add(lashGroup)

    buildLashes(currentBaseRadius)
}

export function removeEyelashGuides(){
    if(lashGroup && lashGroup.parent) lashGroup.parent.remove(lashGroup)
    lashGroup = null
    rightUpperLine = null
    leftUpperLine = null
    rightLowerLine = null
    leftLowerLine = null
    rightLashMat = null
    leftLashMat = null
}

function rebuild(){
    if(currentBaseRadius) buildLashes(currentBaseRadius)
}

export function setLashInnerThickness(value){ lashParams.innerThickness = value; rebuild() }
export function setLashOuterThickness(value){ lashParams.outerThickness = value; rebuild() }
export function setLowerLashInnerThickness(value){ lashParams.lowerLashInnerThickness = value; rebuild() }
export function setLowerLashOuterThickness(value){ lashParams.lowerLashOuterThickness = value; rebuild() }
export function setLashStyle(style){
    lashParams.style = (style === 'spikes' || style === 'fusion') ? style : 'shadow'
    rebuild()
}
export function setCantoSpikeLength(value){ lashParams.cantoSpikeLength = value; rebuild() }
export function setCantoSpikeCurve(value){ lashParams.cantoSpikeCurve = value; rebuild() }
export function setCantoSpikeScale(value){ lashParams.cantoSpikeScale = value; rebuild() }
export function setCantoSpikeTipRotation(degrees){ lashParams.cantoSpikeTipRotation = degrees; rebuild() }
export function setLashSpikeCount(value){ lashParams.lashSpikeCount = Math.round(value); rebuild() }
export function setLashSpikeAmplitude(value){ lashParams.lashSpikeAmplitude = value; rebuild() }

export function setEyelashOcclusion(respectOcclusion){
    ;[rightLashMat, leftLashMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}

// ✅ silueta 2D (vista frontal). En 'fusion', todo el contorno único va en
// `upper` y `lower` queda vacío (mode2d.js ya ignora arreglos vacíos, así
// que no hace falta tocar ese archivo).
export function getEyelashOutlines2D(){
    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(1)
    const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(1)

    const flat = v => ({ x: v.x, y: v.y, z: v.z })

    if(lashParams.style === 'fusion'){
        return {
            right: { upper: buildFusedLashPoints(1, upperRight, lowerRight, false).map(flat), lower: [] },
            left: { upper: buildFusedLashPoints(1, upperLeft, lowerLeft, true).map(flat), lower: [] }
        }
    }

    return {
        right: {
            upper: buildUpperLashPoints(1, upperRight, false).map(flat),
            lower: buildLowerLashPoints(1, lowerRight).map(flat)
        },
        left: {
            upper: buildUpperLashPoints(1, upperLeft, true).map(flat),
            lower: buildLowerLashPoints(1, lowerLeft).map(flat)
        }
    }
}
