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
    cantoSpikeLength: 0.09, // largo del pico, fracción del radio de cabeza
    cantoSpikeWidth: 0.012  // ancho de la base del pico, fracción del radio de cabeza
}

let lashGroup = null
let rightLashLine = null
let leftLashLine = null
let rightLashMat = null
let leftLashMat = null
let currentBaseRadius = 0

// Construye la banda: el borde INTERNO es la propia curva del párpado
// (tal cual, sin modificar); el borde EXTERNO es esa misma curva
// desplazada hacia afuera por el espesor en cada punto, usando la
// perpendicular local a la curva (no una dirección fija), para que la
// banda se doble naturalmente en las esquinas del ojo.
function buildLashPoints(baseRadius, lidPoints){
    const n = lidPoints.length
    if(n < 2) return []

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
        const thickness = THREE.MathUtils.lerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius

        return new THREE.Vector3(p.x + px * thickness, p.y + py * thickness, p.z)
    })

    // lazo cerrado: borde externo (lagrimal→canto) + borde interno (la
    // curva del párpado misma, canto→lagrimal, para cerrar la forma)
    const pts = [...offsetPts]
    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])
    return pts
}

// ✅ NUEVO: pico de pestaña del canto (estilo 'spikes') — nace justo en
// medio de donde terminan el párpado superior e inferior (el canto), y
// apunta hacia afuera siguiendo la misma dirección con la que ya venía
// saliendo el párpado superior en ese punto (su tangente final).
function buildCantoSpike(baseRadius, upperPts, lowerPts){
    if(upperPts.length < 2 || lowerPts.length < 1) return []

    const upperCanto = upperPts[upperPts.length - 1] // extremo del párpado superior (canto, o punta del flick si hay)
    const lowerCanto = lowerPts[0]                    // extremo del párpado inferior en el canto (t=0 en su convención)

    const origin = {
        x: (upperCanto.x + lowerCanto.x) / 2,
        y: (upperCanto.y + lowerCanto.y) / 2,
        z: (upperCanto.z + lowerCanto.z) / 2
    }

    // dirección: la tangente del párpado superior en su extremo, para que
    // el pico "siga de largo" en la misma dirección natural de esa curva
    const prevPt = upperPts[upperPts.length - 2]
    let dirX = upperCanto.x - prevPt.x
    let dirY = upperCanto.y - prevPt.y
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1
    dirX /= dirLen
    dirY /= dirLen

    const perpX = -dirY
    const perpY = dirX

    const halfWidth = (baseRadius * lashParams.cantoSpikeWidth) / 2
    const length = baseRadius * lashParams.cantoSpikeLength

    const baseA = new THREE.Vector3(origin.x + perpX * halfWidth, origin.y + perpY * halfWidth, origin.z)
    const baseB = new THREE.Vector3(origin.x - perpX * halfWidth, origin.y - perpY * halfWidth, origin.z)
    const tip = new THREE.Vector3(origin.x + dirX * length, origin.y + dirY * length, origin.z)

    return [baseA, tip, baseB, baseA] // triángulo cerrado (fino, tipo pestaña)
}

function buildLashes(baseRadius){
    if(!lashGroup || !baseRadius) return

    while(lashGroup.children.length){
        lashGroup.remove(lashGroup.children[0])
    }

    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(baseRadius)

    if(lashParams.style === 'spikes'){
        const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(baseRadius)

        rightLashMat = new THREE.LineBasicMaterial({ color: 0x222222, depthTest: true, depthWrite: false })
        const rightSpike = buildCantoSpike(baseRadius, upperRight, lowerRight)
        rightLashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightSpike), rightLashMat)
        rightLashLine.renderOrder = 999
        lashGroup.add(rightLashLine)

        leftLashMat = new THREE.LineBasicMaterial({ color: 0x222222, depthTest: true, depthWrite: false })
        const leftSpike = buildCantoSpike(baseRadius, upperLeft, lowerLeft)
        leftLashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftSpike), leftLashMat)
        leftLashLine.renderOrder = 999
        lashGroup.add(leftLashLine)
        return
    }

    // estilo 'shadow' (el original)
    rightLashMat = new THREE.LineBasicMaterial({ color: 0x222222, depthTest: true, depthWrite: false })
    const rightPts = buildLashPoints(baseRadius, upperRight)
    rightLashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightLashMat)
    rightLashLine.renderOrder = 999
    lashGroup.add(rightLashLine)

    leftLashMat = new THREE.LineBasicMaterial({ color: 0x222222, depthTest: true, depthWrite: false })
    const leftPts = buildLashPoints(baseRadius, upperLeft)
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
export function setCantoSpikeWidth(value){ lashParams.cantoSpikeWidth = value; rebuild() }

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

    if(lashParams.style === 'spikes'){
        const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(1)
        return {
            right: buildCantoSpike(1, upperRight, lowerRight).map(v => ({ x: v.x, y: v.y, z: v.z })),
            left: buildCantoSpike(1, upperLeft, lowerLeft).map(v => ({ x: v.x, y: v.y, z: v.z }))
        }
    }

    return {
        right: buildLashPoints(1, upperRight).map(v => ({ x: v.x, y: v.y, z: v.z })),
        left: buildLashPoints(1, upperLeft).map(v => ({ x: v.x, y: v.y, z: v.z }))
    }
}
