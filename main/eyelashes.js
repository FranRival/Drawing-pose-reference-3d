import * as THREE from 'three'
import { getEyeUpperLidPoints, getEyeLowerLidPoints } from './eyes.js'

// Pestañas: dos estilos posibles.
//   'shadow' - banda de espesor variable apoyada sobre la curva del
//   párpado superior, fina en el lagrimal, gruesa en el canto.
//   'spikes' (estilo anime) - la misma banda (con dentado opcional a lo
//   largo), pero el borde exterior, al llegar al canto, se prolonga en un
//   pico curvo antes de cerrar contra el párpado inferior — TODO como una
//   sola línea continua, no como dos formas separadas que se superponen.

let lashParams = {
    style: 'shadow', // 'shadow' | 'spikes'
    innerThickness: 0.02, // espesor cerca del lagrimal, fracción del radio de cabeza
    outerThickness: 0.05, // espesor cerca del canto

    // --- estilo 'spikes': pico del canto (fusionado en el borde) ---
    cantoSpikeLength: 0.09,  // largo del pico, fracción del radio de cabeza
    cantoSpikeCurve: 0.02,   // curvatura del pico (0 = recto)
    cantoSpikeScale: 1.0,    // escala general del pico ("agrandar")
    cantoSpikeTipRotation: 0, // rota la punta respecto a la dirección natural, en grados

    // --- estilo 'spikes': dentado a lo largo de toda la banda ---
    lashSpikeCount: 5,       // cuántos picos entran a lo largo del párpado superior
    lashSpikeAmplitude: 0.03 // qué tanto sobresalen los picos, fracción del radio de cabeza
}

let lashGroup = null
let rightLashLine = null
let leftLashLine = null
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
// un triángulo por pico (sube y baja), sesgado para que sean más
// pronunciados hacia el canto (t=1) que hacia el lagrimal (t=0).
function spikeModulation(t, count){
    const phase = (t * count) % 1
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2
    const bias = THREE.MathUtils.lerp(0.25, 1.0, t)
    return tri * bias
}

// Construye la banda COMPLETA como una sola línea continua: borde externo
// (lagrimal→canto, con dentado si aplica) → si es estilo 'spikes', un
// pico curvo fusionado justo al final de ese borde, que baja hasta el
// punto donde arranca el párpado inferior → borde interno (la curva del
// párpado, canto→lagrimal), cerrando el lazo. Nunca son dos formas
// separadas — todo un mismo trazo.
function buildLashPoints(baseRadius, lidPoints, lowerCantoPoint){
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

        let px = -ty
        let py = tx
        if(py < 0){ px = -px; py = -py }

        const t = i / (n - 1) // 0 = lagrimal, 1 = canto
        let thickness = THREE.MathUtils.lerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius

        if(useSpikes){
            thickness += spikeAmp * spikeModulation(t, lashParams.lashSpikeCount)
        }

        return { x: p.x + px * thickness, y: p.y + py * thickness, z: p.z }
    })

    const pts = [...offsetPts]

    // ✅ pico del canto, FUSIONADO al final del borde exterior — no es una
    // forma aparte, son más puntos en la misma secuencia.
    if(useSpikes && lowerCantoPoint){
        const cantoBase = offsetPts[offsetPts.length - 1]
        const prevPt = offsetPts[offsetPts.length - 2] || cantoBase

        let dirX = cantoBase.x - prevPt.x
        let dirY = cantoBase.y - prevPt.y
        const dirLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1
        dirX /= dirLen
        dirY /= dirLen

        // rotar la dirección de la punta respecto a la natural
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
            x: (tip.x + lowerCantoPoint.x) / 2 - perpX * curve,
            y: (tip.y + lowerCantoPoint.y) / 2 - perpY * curve
        }

        const segs = 8
        for(let i = 1; i <= segs; i++) pts.push(quadraticBezierPoint(cantoBase, controlTop, tip, i / segs))
        for(let i = 1; i <= segs; i++) pts.push(quadraticBezierPoint(tip, controlBottom, lowerCantoPoint, i / segs))
    }

    // borde interno: la curva del párpado misma, canto→lagrimal, cerrando
    // el lazo (mismo cierre de siempre, con o sin pico)
    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])

    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

function buildLashes(baseRadius){
    if(!lashGroup || !baseRadius) return

    while(lashGroup.children.length){
        lashGroup.remove(lashGroup.children[0])
    }

    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(baseRadius)

    let rightLowerCanto = null
    let leftLowerCanto = null
    if(lashParams.style === 'spikes'){
        const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(baseRadius)
        rightLowerCanto = lowerRight[0] || null
        leftLowerCanto = lowerLeft[0] || null
    }

    rightLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })
    const rightPts = buildLashPoints(baseRadius, upperRight, rightLowerCanto)
    rightLashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightLashMat)
    rightLashLine.renderOrder = 999
    lashGroup.add(rightLashLine)

    leftLashMat = new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: true, depthWrite: false })
    const leftPts = buildLashPoints(baseRadius, upperLeft, leftLowerCanto)
    leftLashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), leftLashMat)
    leftLashLine.renderOrder = 999
    lashGroup.add(leftLashLine)
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
}

function rebuild(){
    if(currentBaseRadius) buildLashes(currentBaseRadius)
}

export function setLashInnerThickness(value){ lashParams.innerThickness = value; rebuild() }
export function setLashOuterThickness(value){ lashParams.outerThickness = value; rebuild() }
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

// ✅ silueta 2D (vista frontal) — mismo patrón que el resto, mismo trazo
// único fusionado (banda + pico si aplica).
export function getEyelashOutlines2D(){
    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(1)

    let rightLowerCanto = null
    let leftLowerCanto = null
    if(lashParams.style === 'spikes'){
        const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(1)
        rightLowerCanto = lowerRight[0] || null
        leftLowerCanto = lowerLeft[0] || null
    }

    return {
        right: buildLashPoints(1, upperRight, rightLowerCanto).map(v => ({ x: v.x, y: v.y, z: v.z })),
        left: buildLashPoints(1, upperLeft, leftLowerCanto).map(v => ({ x: v.x, y: v.y, z: v.z }))
    }
}
