import * as THREE from 'three'
import { getEyeUpperLidPoints, getEyeLowerLidPoints } from './eyes.js'

// Pestañas: dos estilos posibles.
//   'shadow' (el que ya tenías) - banda de espesor variable apoyada sobre
//   la curva del párpado superior, fina en el lagrimal, gruesa en el canto.
//   'spikes' (nuevo, estilo anime) - por ahora solo el pico del canto: un
//   trazo largo y fino que nace justo entre donde terminan el párpado
//   superior e inferior, apuntando hacia afuera. La cantidad/aleatoriedad
//   de pestañas a lo largo del ojo (punto 1) queda pendiente.

let lashParams = {
    style: 'shadow', // 'shadow' | 'spikes'
    innerThickness: 0.02, // espesor cerca del lagrimal, fracción del radio de cabeza (estilo 'shadow')
    outerThickness: 0.05, // espesor cerca del canto (estilo 'shadow')

    // --- estilo 'spikes': pico del canto ---
    cantoSpikeLength: 0.09,  // largo del pico, fracción del radio de cabeza
    cantoSpikeWidth: 0.012,  // ancho de la base del pico, fracción del radio de cabeza
    cantoSpikeCurve: 0.02,   // curvatura de los bordes superior/inferior (0 = triángulo recto)
    cantoSpikeScale: 1.0,    // escala general del pico completo ("agrandar")
    cantoSpikeTipRotation: 0, // rota la punta respecto a la dirección natural, en grados

    // --- estilo 'spikes': dentado a lo largo de toda la banda (además
    // del pico grande del canto) - "la pestaña existe alrededor del ojo,
    // aún cuando está en punta" ---
    lashSpikeCount: 5,      // cuántos picos entran a lo largo del párpado superior
    lashSpikeAmplitude: 0.03 // qué tanto sobresalen los picos, fracción del radio de cabeza
}

let lashGroup = null
let rightLashLine = null
let leftLashLine = null
let rightLashMat = null
let leftLashMat = null
let rightCantoSpikeLine = null // solo se usa en estilo 'spikes', junto con la banda
let leftCantoSpikeLine = null
let currentBaseRadius = 0

// Construye la banda: el borde INTERNO es la propia curva del párpado
// (tal cual, sin modificar); el borde EXTERNO es esa misma curva
// desplazada hacia afuera por el espesor en cada punto, usando la
// perpendicular local a la curva (no una dirección fija), para que la
// banda se doble naturalmente en las esquinas del ojo.
// modulación en zigzag: crea `count` picos a lo largo de t (0 a 1), con
// un triángulo por pico (sube y baja), sesgado para que sean más
// pronunciados hacia el canto (t=1) que hacia el lagrimal (t=0) — igual
// que en la referencia.
function spikeModulation(t, count){
    const phase = (t * count) % 1
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2 // triángulo 0→1→0 por pico
    const bias = THREE.MathUtils.lerp(0.25, 1.0, t) // picos chicos cerca del lagrimal, grandes cerca del canto
    return tri * bias
}

function buildLashPoints(baseRadius, lidPoints){
    const n = lidPoints.length
    if(n < 2) return []

    const useSpikes = lashParams.style === 'spikes'
    const spikeAmp = baseRadius * lashParams.lashSpikeAmplitude

    const offsetPts = lidPoints.map((p, i) => {
        const prev = lidPoints[Math.max(i - 1, 0)]
        const next = lidPoints[Math.min(i + 1, n - 1)]
        let tx = next.x - prev.x
        let ty = next.y - prev.y
        const len = Math.sqrt(tx * tx + ty * ty) || 1
        tx /= len
        ty /= len

        // perpendicular a la tangente local, siempre apuntando "hacia
        // arriba" (y >= 0) — mismo truco que en eyes.js/eyebrows.js
        let px = -ty
        let py = tx
        if(py < 0){ px = -px; py = -py }

        const t = i / (n - 1) // 0 = lagrimal, 1 = canto
        let thickness = THREE.MathUtils.lerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius

        // ✅ NUEVO: el dentado se SUMA al espesor base, así la pestaña
        // sigue existiendo "alrededor del ojo" (banda continua) aún
        // cuando cada pico sobresale en punta.
        if(useSpikes){
            thickness += spikeAmp * spikeModulation(t, lashParams.lashSpikeCount)
        }

        return new THREE.Vector3(p.x + px * thickness, p.y + py * thickness, p.z)
    })

    // lazo cerrado: borde externo (lagrimal→canto) + borde interno (la
    // curva del párpado misma, canto→lagrimal, para cerrar la forma)
    const pts = [...offsetPts]
    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])
    return pts
}

// ✅ ACTUALIZADO: el pico ya no es un triángulo recto — tiene curvatura
// real en el borde superior e inferior (dos Bezier cuadráticas), la punta
// se puede rotar respecto a la dirección natural, y todo el pico se puede
// escalar de un solo control ("agrandar").
function quadraticBezierPoint(p0, p1, p2, t){
    const mt = 1 - t
    return {
        x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
        y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
    }
}

function buildCantoSpike(baseRadius, upperPts, lowerPts){
    if(upperPts.length < 2 || lowerPts.length < 1) return []

    const upperCanto = upperPts[upperPts.length - 1] // extremo del párpado superior (canto, o punta del flick si hay)
    const lowerCanto = lowerPts[0]                    // extremo del párpado inferior en el canto (t=0 en su convención)

    const origin = {
        x: (upperCanto.x + lowerCanto.x) / 2,
        y: (upperCanto.y + lowerCanto.y) / 2,
        z: (upperCanto.z + lowerCanto.z) / 2
    }

    // dirección natural: la tangente del párpado superior en su extremo
    const prevPt = upperPts[upperPts.length - 2]
    let dirX = upperCanto.x - prevPt.x
    let dirY = upperCanto.y - prevPt.y
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1
    dirX /= dirLen
    dirY /= dirLen

    // rotar la dirección de la PUNTA respecto a la natural, según el slider
    const rotRad = THREE.MathUtils.degToRad(lashParams.cantoSpikeTipRotation)
    const cosR = Math.cos(rotRad)
    const sinR = Math.sin(rotRad)
    const tipDirX = dirX * cosR - dirY * sinR
    const tipDirY = dirX * sinR + dirY * cosR

    const perpX = -dirY
    const perpY = dirX

    const halfWidth = (baseRadius * lashParams.cantoSpikeWidth) / 2
    const length = baseRadius * lashParams.cantoSpikeLength
    const curve = baseRadius * lashParams.cantoSpikeCurve

    const baseA = { x: origin.x + perpX * halfWidth, y: origin.y + perpY * halfWidth }
    const baseB = { x: origin.x - perpX * halfWidth, y: origin.y - perpY * halfWidth }
    const tip = { x: origin.x + tipDirX * length, y: origin.y + tipDirY * length }

    // puntos de control: al medio de cada borde, empujados hacia afuera
    // por la curvatura - borde superior hacia +perp, inferior hacia -perp
    const controlTop = {
        x: (baseA.x + tip.x) / 2 + perpX * curve,
        y: (baseA.y + tip.y) / 2 + perpY * curve
    }
    const controlBottom = {
        x: (tip.x + baseB.x) / 2 - perpX * curve,
        y: (tip.y + baseB.y) / 2 - perpY * curve
    }

    const segs = 10
    const raw = []
    for(let i = 0; i <= segs; i++){
        raw.push(quadraticBezierPoint(baseA, controlTop, tip, i / segs))
    }
    for(let i = 0; i <= segs; i++){
        raw.push(quadraticBezierPoint(tip, controlBottom, baseB, i / segs))
    }
    raw.push(baseA) // cierra el lazo (borde de la base)

    // "agrandar": escala todo el pico alrededor de su propio origen
    const scale = lashParams.cantoSpikeScale
    return raw.map(p => new THREE.Vector3(
        origin.x + (p.x - origin.x) * scale,
        origin.y + (p.y - origin.y) * scale,
        origin.z
    ))
}

function buildLashes(baseRadius){
    if(!lashGroup || !baseRadius) return

    while(lashGroup.children.length){
        lashGroup.remove(lashGroup.children[0])
    }

    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(baseRadius)

    rightLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })
    leftLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })

    // ✅ la banda (con dentado si el estilo es 'spikes') SIEMPRE se dibuja
    // — "la pestaña existe alrededor del ojo, aún cuando está en punta".
    const rightPts = buildLashPoints(baseRadius, upperRight)
    rightLashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightLashMat)
    rightLashLine.renderOrder = 999
    lashGroup.add(rightLashLine)

    const leftPts = buildLashPoints(baseRadius, upperLeft)
    leftLashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), leftLashMat)
    leftLashLine.renderOrder = 999
    lashGroup.add(leftLashLine)

    // ✅ en estilo 'spikes', además el pico grande y largo del canto,
    // compartiendo el mismo material (así el toggle de oclusión afecta a
    // ambas piezas juntas).
    if(lashParams.style === 'spikes'){
        const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(baseRadius)

        const rightSpike = buildCantoSpike(baseRadius, upperRight, lowerRight)
        rightCantoSpikeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightSpike), rightLashMat)
        rightCantoSpikeLine.renderOrder = 999
        lashGroup.add(rightCantoSpikeLine)

        const leftSpike = buildCantoSpike(baseRadius, upperLeft, lowerLeft)
        leftCantoSpikeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftSpike), leftLashMat)
        leftCantoSpikeLine.renderOrder = 999
        lashGroup.add(leftCantoSpikeLine)
    } else {
        rightCantoSpikeLine = null
        leftCantoSpikeLine = null
    }
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
    rightLashLine = null
    leftLashLine = null
    rightLashMat = null
    leftLashMat = null
    rightCantoSpikeLine = null
    leftCantoSpikeLine = null
}

function rebuild(){
    if(currentBaseRadius) buildLashes(currentBaseRadius)
}

export function setLashInnerThickness(value){ lashParams.innerThickness = value; rebuild() }
export function setLashOuterThickness(value){ lashParams.outerThickness = value; rebuild() }
export function setLashStyle(style){ lashParams.style = (style === 'spikes') ? 'spikes' : 'shadow'; rebuild() }
export function setCantoSpikeLength(value){ lashParams.cantoSpikeLength = value; rebuild() }
export function setCantoSpikeWidth(value){ lashParams.cantoSpikeWidth = value; rebuild() }
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

// ✅ silueta 2D (vista frontal) — mismo patrón que el resto. Respeta el
// estilo elegido (sombra o pico de canto).
export function getEyelashOutlines2D(){
    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(1)

    const result = {
        right: buildLashPoints(1, upperRight).map(v => ({ x: v.x, y: v.y, z: v.z })),
        left: buildLashPoints(1, upperLeft).map(v => ({ x: v.x, y: v.y, z: v.z })),
        rightSpike: null,
        leftSpike: null
    }

    if(lashParams.style === 'spikes'){
        const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(1)
        result.rightSpike = buildCantoSpike(1, upperRight, lowerRight).map(v => ({ x: v.x, y: v.y, z: v.z }))
        result.leftSpike = buildCantoSpike(1, upperLeft, lowerLeft).map(v => ({ x: v.x, y: v.y, z: v.z }))
    }

    return result
}
