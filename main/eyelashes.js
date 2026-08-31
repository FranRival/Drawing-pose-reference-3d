import * as THREE from 'three'
import { getEyeUpperLidPoints, getEyeLowerLidPoints } from './eyes.js'

// Pestañas: dos piezas independientes, cada una autosuficiente (nunca
// cruzan geometría de la otra — eso era lo que causaba el entrelazado):
//   - Pestaña SUPERIOR: banda de espesor variable sobre el párpado
//     superior, fina en el lagrimal, gruesa en el canto. En estilo
//     'spikes' además tiene dentado a lo largo y un pico grande fusionado
//     en el canto — pero el pico SIEMPRE cierra contra su propio párpado
//     superior, nunca intenta alcanzar el inferior.
//   - Pestaña INFERIOR: banda delgada independiente sobre el párpado
//     inferior, con su propio espesor.

let lashParams = {
    style: 'shadow', // 'shadow' | 'spikes'
    innerThickness: 0.02, // espesor cerca del lagrimal (superior)
    outerThickness: 0.05, // espesor cerca del canto (superior)

    // --- pestaña inferior, independiente ---
    lowerLashInnerThickness: 0.008, // espesor cerca del lagrimal (inferior) - normalmente muy fina
    lowerLashOuterThickness: 0.018, // espesor cerca del canto (inferior)

    // --- estilo 'spikes': pico del canto, fusionado al final de la banda
    // superior, SIEMPRE autosuficiente (cierra contra sí misma) ---
    cantoSpikeLength: 0.09,
    cantoSpikeCurve: 0.02,
    cantoSpikeScale: 1.0,
    cantoSpikeTipRotation: 0,

    // --- estilo 'spikes': dentado a lo largo de la banda superior ---
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

// modulación en zigzag: crea `count` picos a lo largo de t (0 a 1), con
// un triángulo por pico (sube y baja), sesgado hacia el canto (t=1).
function spikeModulation(t, count){
    const phase = (t * count) % 1
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2
    const bias = THREE.MathUtils.lerp(0.25, 1.0, t)
    return tri * bias
}

// perpendicular local a una polilínea, en el punto i, apuntando siempre
// "hacia arriba" (y >= 0) — mismo truco que en eyes.js/eyebrows.js.
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

// ✅ Pestaña SUPERIOR: banda + (si aplica) pico del canto — TODO cierra
// contra su PROPIO párpado superior. Nunca referencia el párpado inferior,
// así que nunca puede entrelazarse con él.
function buildUpperLashPoints(baseRadius, lidPoints){
    const n = lidPoints.length
    if(n < 2) return []

    const useSpikes = lashParams.style === 'spikes'
    const spikeAmp = baseRadius * lashParams.lashSpikeAmplitude

    const offsetPts = lidPoints.map((p, i) => {
        const { px, py } = localPerpUp(lidPoints, i)
        const t = i / (n - 1) // 0 = lagrimal, 1 = canto
        let thickness = THREE.MathUtils.lerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius
        if(useSpikes){
            thickness += spikeAmp * spikeModulation(t, lashParams.lashSpikeCount)
        }
        return { x: p.x + px * thickness, y: p.y + py * thickness, z: p.z }
    })

    const pts = [...offsetPts]

    // pico del canto, fusionado — cierra contra lidPoints[n-1] (el propio
    // párpado superior en su extremo), NUNCA contra el párpado inferior.
    if(useSpikes){
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

    // cierre: la curva del párpado superior misma, canto→lagrimal
    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])

    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

// ✅ Pestaña INFERIOR: independiente, banda delgada sobre el párpado
// inferior — no depende del superior ni lo toca.
function buildLowerLashPoints(baseRadius, lidPoints){
    const n = lidPoints.length
    if(n < 2) return []

    const offsetPts = lidPoints.map((p, i) => {
        const { px, py } = localPerpUp(lidPoints, i)
        // lidPoints del párpado inferior van canto(0)→lagrimal(1) en su
        // propia convención (ver eyes.js) - se usa tal cual para el degradado
        const t = i / (n - 1)
        const thickness = THREE.MathUtils.lerp(lashParams.lowerLashOuterThickness, lashParams.lowerLashInnerThickness, t) * baseRadius
        // el párpado inferior se dibuja "hacia arriba" (px,py apunta
        // arriba); para que la pestaña quede DEBAJO del ojo, se invierte
        return { x: p.x - px * thickness, y: p.y - py * thickness, z: p.z }
    })

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

    rightLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })
    leftLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })

    const rightUpperPts = buildUpperLashPoints(baseRadius, upperRight)
    rightUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightUpperPts), rightLashMat)
    rightUpperLine.renderOrder = 999
    lashGroup.add(rightUpperLine)

    const leftUpperPts = buildUpperLashPoints(baseRadius, upperLeft)
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
export function setLashStyle(style){ lashParams.style = (style === 'spikes') ? 'spikes' : 'shadow'; rebuild() }
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

// ✅ silueta 2D (vista frontal) — ahora devuelve upper/lower por separado
// para cada lado, ya que son dos piezas independientes.
export function getEyelashOutlines2D(){
    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(1)
    const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(1)

    const flat = v => ({ x: v.x, y: v.y, z: v.z })

    return {
        right: {
            upper: buildUpperLashPoints(1, upperRight).map(flat),
            lower: buildLowerLashPoints(1, lowerRight).map(flat)
        },
        left: {
            upper: buildUpperLashPoints(1, upperLeft).map(flat),
            lower: buildLowerLashPoints(1, lowerLeft).map(flat)
        }
    }
}
