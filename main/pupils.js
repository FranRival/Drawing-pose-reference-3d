import * as THREE from 'three'
import { getEyeFullPoints } from './eyes.js'

// Iris y pupila: dos círculos centrados en la caja del ojo REAL (calculada
// a partir de su contorno completo, no de un eje propio) — así se ajustan
// solos si cambia cualquier cosa del ojo (canto, arco, ajuste fino, etc).
// Mismo patrón que eyelashes.js: se apoyan en la geometría de eyes.js en
// vez de duplicar cálculos de eje/ancla.

let pupilParams = {
    irisRadiusMult: 0.42,   // radio del iris, fracción del semi-ancho del ojo
    pupilRadiusMult: 0.45,  // radio de la pupila, fracción del radio del iris
    horizontalBias: 0,      // desplaza el iris hacia el lagrimal (-) o el canto (+), fracción del ancho del ojo
    verticalBias: 0         // desplaza el iris hacia arriba (+) o abajo (-), fracción del alto del ojo
}

// mismo truco anti z-fighting que el resto de las guías de superficie
const PUPIL_SURFACE_OFFSET = 1.02

let pupilGroup = null
let rightIrisLine = null
let leftIrisLine = null
let rightPupilLine = null
let leftPupilLine = null
let rightIrisMat = null
let leftIrisMat = null
let rightPupilMat = null
let leftPupilMat = null
let currentBaseRadius = 0

function circleLocalPoints(radius, segs = 32){
    const pts = []
    for(let i = 0; i <= segs; i++){
        const t = (i / segs) * Math.PI * 2
        pts.push({ x: Math.cos(t) * radius, y: Math.sin(t) * radius })
    }
    return pts
}

// calcula el centro y semi-ancho/semi-alto de la caja del ojo a partir de
// su contorno completo (no asume nada sobre su forma exacta)
function computeEyeBox(points){
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    points.forEach(p => {
        if(p.x < minX) minX = p.x
        if(p.x > maxX) maxX = p.x
        if(p.y < minY) minY = p.y
        if(p.y > maxY) maxY = p.y
    })
    return {
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        halfWidth: (maxX - minX) / 2,
        halfHeight: (maxY - minY) / 2
    }
}

function buildEyeDisks(baseRadius, eyePoints){
    const box = computeEyeBox(eyePoints)
    const cx = box.cx + pupilParams.horizontalBias * box.halfWidth * 2
    const cy = box.cy + pupilParams.verticalBias * box.halfHeight * 2

    const surfaceR = baseRadius * PUPIL_SURFACE_OFFSET
    const cz = Math.sqrt(Math.max(surfaceR * surfaceR - cx * cx - cy * cy, 0.0001))

    const irisRadius = box.halfWidth * pupilParams.irisRadiusMult
    const pupilRadius = irisRadius * pupilParams.pupilRadiusMult

    const irisPts = circleLocalPoints(irisRadius).map(p => new THREE.Vector3(cx + p.x, cy + p.y, cz))
    const pupilPts = circleLocalPoints(pupilRadius).map(p => new THREE.Vector3(cx + p.x, cy + p.y, cz))

    return { irisPts, pupilPts }
}

function buildPupils(baseRadius){
    if(!pupilGroup || !baseRadius) return

    while(pupilGroup.children.length){
        pupilGroup.remove(pupilGroup.children[0])
    }

    const { right, left } = getEyeFullPoints(baseRadius)

    const rightDisks = buildEyeDisks(baseRadius, right)
    rightIrisMat = new THREE.LineBasicMaterial({ color: 0x8888ff, depthTest: true, depthWrite: false })
    rightIrisLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightDisks.irisPts), rightIrisMat)
    rightIrisLine.renderOrder = 999
    pupilGroup.add(rightIrisLine)

    rightPupilMat = new THREE.LineBasicMaterial({ color: 0x000000, depthTest: true, depthWrite: false })
    rightPupilLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightDisks.pupilPts), rightPupilMat)
    rightPupilLine.renderOrder = 999
    pupilGroup.add(rightPupilLine)

    const leftDisks = buildEyeDisks(baseRadius, left)
    leftIrisMat = new THREE.LineBasicMaterial({ color: 0x8888ff, depthTest: true, depthWrite: false })
    leftIrisLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftDisks.irisPts), leftIrisMat)
    leftIrisLine.renderOrder = 999
    pupilGroup.add(leftIrisLine)

    leftPupilMat = new THREE.LineBasicMaterial({ color: 0x000000, depthTest: true, depthWrite: false })
    leftPupilLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftDisks.pupilPts), leftPupilMat)
    leftPupilLine.renderOrder = 999
    pupilGroup.add(leftPupilLine)
}

// Llamar desde viewer.js, después de createEyeGuides (necesita la
// geometría del ojo ya construida para calcular su caja).
export function createPupilGuides(loomisGroup, loomisBaseRadius){
    removePupilGuides()
    if(!loomisGroup || !loomisBaseRadius) return

    currentBaseRadius = loomisBaseRadius
    pupilGroup = new THREE.Group()
    loomisGroup.add(pupilGroup)

    buildPupils(currentBaseRadius)
}

export function removePupilGuides(){
    if(pupilGroup && pupilGroup.parent) pupilGroup.parent.remove(pupilGroup)
    pupilGroup = null
    rightIrisLine = null
    leftIrisLine = null
    rightPupilLine = null
    leftPupilLine = null
    rightIrisMat = null
    leftIrisMat = null
    rightPupilMat = null
    leftPupilMat = null
}

function rebuild(){
    if(currentBaseRadius) buildPupils(currentBaseRadius)
}

export function setIrisRadius(mult){ pupilParams.irisRadiusMult = mult; rebuild() }
export function setPupilRadius(mult){ pupilParams.pupilRadiusMult = mult; rebuild() }
export function setIrisHorizontalBias(value){ pupilParams.horizontalBias = value; rebuild() }
export function setIrisVerticalBias(value){ pupilParams.verticalBias = value; rebuild() }

export function setPupilOcclusion(respectOcclusion){
    ;[rightIrisMat, leftIrisMat, rightPupilMat, leftPupilMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}

// ✅ silueta 2D (vista frontal) — mismo patrón que el resto.
export function getPupilOutlines2D(){
    const { right, left } = getEyeFullPoints(1)
    const rightDisks = buildEyeDisks(1, right)
    const leftDisks = buildEyeDisks(1, left)
    return {
        rightIris: rightDisks.irisPts.map(v => ({ x: v.x, y: v.y })),
        rightPupil: rightDisks.pupilPts.map(v => ({ x: v.x, y: v.y })),
        leftIris: leftDisks.irisPts.map(v => ({ x: v.x, y: v.y })),
        leftPupil: leftDisks.pupilPts.map(v => ({ x: v.x, y: v.y }))
    }
}
