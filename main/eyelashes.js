import * as THREE from 'three'
import { getEyeUpperLidPoints, getEyeLowerLidPoints } from './eyes.js'

// Pestañas: TRES estilos.
//   'shadow'  - banda sobre el párpado superior + banda delgada inferior,
//               ambas independientes, sin pico.
//   'spikes'  - igual, pero con dentado + pico grande en el canto (se
//               cierra sobre SÍ MISMO — nunca toca la pestaña inferior).
//   'fusion'  - el pico del canto y la pestaña inferior quedan UNIDOS: la
//               pestaña inferior arranca exactamente en la punta del pico,
//               así que rotar la punta controla el arco completo de una
//               sola vez (hacia la ceja = arco más pronunciado; hacia el
//               pómulo = menos pronunciado).

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

// ✅ Pestaña SUPERIOR: banda + (si 'spikes' o 'fusion') pico del canto.
// SIEMPRE cierra sobre su propio párpado superior — es un trazo
// autosuficiente, nunca depende de la geometría del párpado inferior.
// Además de los puntos, devuelve `tip` (la punta del pico) para que, en
// modo 'fusion', la pestaña inferior sepa dónde anclarse.
function buildUpperLashPoints(baseRadius, lidPoints){
    const n = lidPoints.length
    if(n < 2) return { points: [], tip: null }

    const style = lashParams.style
    const useZigzag = style === 'spikes'
    const useSpike = style === 'spikes' || style === 'fusion'
    const spikeAmp = baseRadius * lashParams.lashSpikeAmplitude

    const offsetPts = lidPoints.map((p, i) => {
        const { px, py } = localPerpUp(lidPoints, i)
        const t = i / (n - 1) // 0 = lagrimal, 1 = canto
        let thickness = THREE.MathUtils.lerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius
        if(useZigzag){
            thickness += spikeAmp * spikeModulation(t, lashParams.lashSpikeCount)
        }
        return { x: p.x + px * thickness, y: p.y + py * thickness, z: p.z }
    })

    const pts = [...offsetPts]
    let tip = null

    if(useSpike){
        const cantoBase = offsetPts[offsetPts.length - 1]
        const prevPt = offsetPts[offsetPts.length - 2] || cantoBase
        const trueCanto = lidPoints[n - 1] // punto real del párpado, sin desplazar

        let dirX = cantoBase.x - prevPt.x
        let dirY = cantoBase.y - prevPt.y
        const dirLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1
        dirX /= dirLen
        dirY /= dirLen

        const rotRad = THREE.MathUtils.degToRad(lashParams.cantoSpikeTipRotation)
        const cosR = Math.cos(rotRad)
        const sinR = Math.sin(rotRad)
        const tipDirX = dirX * cosR - dirY * sinR
        const tipDirY = dirX * sinR + dirY * cosR

        const perpX = -dirY
        const perpY = dirX

        const length = baseRadius * lashParams.cantoSpikeLength * lashParams.cantoSpikeScale
        const curve = baseRadius * lashParams.cantoSpikeCurve

        tip = { x: cantoBase.x + tipDirX * length, y: cantoBase.y + tipDirY * length, z: cantoBase.z }

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
        // ✅ el pico SIEMPRE se cierra contra su propio párpado (trueCanto)
        // — esto es lo que evita el entrelazado, en 'spikes' Y en 'fusion'.
        for(let i = 1; i <= segs; i++) pts.push(quadraticBezierPoint(tip, controlBottom, trueCanto, i / segs))
    }

    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])

    return {
        points: pts.map(p => new THREE.Vector3(p.x, p.y, p.z)),
        tip
    }
}

// ✅ Pestaña INFERIOR: banda independiente sobre el párpado inferior. Si
// se pasa `connectTip` (modo 'fusion'), su extremo del lado del canto se
// ancla EXACTAMENTE en la punta del pico superior — así ambas piezas
// quedan unidas en ese único punto, sin fusionarse en una sola forma
// gigante (evita el riesgo de auto-intersección).
function buildLowerLashPoints(baseRadius, lidPoints, connectTip){
    const n = lidPoints.length
    if(n < 2) return []

    const offsetPts = lidPoints.map((p, i) => {
        const { px, py } = localPerpUp(lidPoints, i)
        const t = i / (n - 1) // 0 = canto, 1 = lagrimal (convención del párpado inferior)
        const thickness = THREE.MathUtils.lerp(lashParams.lowerLashOuterThickness, lashParams.lowerLashInnerThickness, t) * baseRadius
        return { x: p.x - px * thickness, y: p.y - py * thickness, z: p.z }
    })

    if(connectTip && offsetPts.length > 0){
        offsetPts[0] = { x: connectTip.x, y: connectTip.y, z: offsetPts[0].z }
    }

    const pts = [...offsetPts]
    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])
    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

function buildLashes(baseRadius){
    if(!lashGroup || !baseRadius) return

    while(lashGroup.children.length){
        lashGroup.remove(lashGroup.children[0])
    }

    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(baseRadius)
    const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(baseRadius)

    const isFusion = lashParams.style === 'fusion'

    rightLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })
    leftLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })

    const rightUpper = buildUpperLashPoints(baseRadius, upperRight)
    rightUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightUpper.points), rightLashMat)
    rightUpperLine.renderOrder = 999
    lashGroup.add(rightUpperLine)

    const leftUpper = buildUpperLashPoints(baseRadius, upperLeft)
    leftUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftUpper.points), leftLashMat)
    leftUpperLine.renderOrder = 999
    lashGroup.add(leftUpperLine)

    const rightLowerPts = buildLowerLashPoints(baseRadius, lowerRight, isFusion ? rightUpper.tip : null)
    rightLowerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightLowerPts), rightLashMat)
    rightLowerLine.renderOrder = 999
    lashGroup.add(rightLowerLine)

    const leftLowerPts = buildLowerLashPoints(baseRadius, lowerLeft, isFusion ? leftUpper.tip : null)
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

// ✅ silueta 2D (vista frontal) — upper/lower por separado para cada lado,
// respetando el modo 'fusion' (anclaje del inferior a la punta del pico).
export function getEyelashOutlines2D(){
    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(1)
    const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(1)

    const isFusion = lashParams.style === 'fusion'
    const flat = v => ({ x: v.x, y: v.y, z: v.z })

    const rightUpper = buildUpperLashPoints(1, upperRight)
    const leftUpper = buildUpperLashPoints(1, upperLeft)

    return {
        right: {
            upper: rightUpper.points.map(flat),
            lower: buildLowerLashPoints(1, lowerRight, isFusion ? rightUpper.tip : null).map(flat)
        },
        left: {
            upper: leftUpper.points.map(flat),
            lower: buildLowerLashPoints(1, lowerLeft, isFusion ? leftUpper.tip : null).map(flat)
        }
    }
}
