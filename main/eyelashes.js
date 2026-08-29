import * as THREE from 'three'
import { getEyeUpperLidPoints } from './eyes.js'

// Pestañas: una banda de espesor variable apoyada DIRECTAMENTE sobre la
// curva del párpado superior del ojo (no un eje propio) — la pestaña es
// literalmente la sombra que corre justo encima de esa línea. Fina cerca
// del lagrimal, gruesa hacia el canto, como en la referencia (model sheet).
// Mismo patrón que eyes.js/eyebrows.js: cuelga del mismo loomisGroup.

let lashParams = {
    innerThickness: 0.02, // espesor cerca del lagrimal, fracción del radio de cabeza
    outerThickness: 0.05  // espesor cerca del canto (más grueso — así se ve en la referencia)
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

function buildLashes(baseRadius){
    if(!lashGroup || !baseRadius) return

    while(lashGroup.children.length){
        lashGroup.remove(lashGroup.children[0])
    }

    const { right, left } = getEyeUpperLidPoints(baseRadius)

    rightLashMat = new THREE.LineBasicMaterial({ color: 0x222222, depthTest: true, depthWrite: false })
    const rightPts = buildLashPoints(baseRadius, right)
    rightLashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightLashMat)
    rightLashLine.renderOrder = 999
    lashGroup.add(rightLashLine)

    leftLashMat = new THREE.LineBasicMaterial({ color: 0x222222, depthTest: true, depthWrite: false })
    const leftPts = buildLashPoints(baseRadius, left)
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

export function setEyelashOcclusion(respectOcclusion){
    ;[rightLashMat, leftLashMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}

// ✅ silueta 2D, mismo patrón que getEyeOutlines2D/getBrowOutlines2D —
// reutiliza getEyeUpperLidPoints con baseRadius=1.
export function getEyelashOutlines2D(){
    const { right, left } = getEyeUpperLidPoints(1)
    return {
        right: buildLashPoints(1, right).map(v => ({ x: v.x, y: v.y, z: v.z })),
        left: buildLashPoints(1, left).map(v => ({ x: v.x, y: v.y, z: v.z }))
    }
}
