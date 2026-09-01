import * as THREE from 'three'
import { getEyeUpperLidPoints } from './eyes.js'

// Párpados: la curva del pliegue que corre POR ENCIMA del ojo (el doble
// párpado), más una línea corta que baja a conectar con el lagrimal.
// Mismo patrón que eyes.js / eyebrows.js / eyelashes.js: cuelga del mismo
// loomisGroup, se apoya en la curva real del párpado superior del ojo (no
// construye su propio eje), y expone su silueta 2D para el modo de
// calibración.

let lidParams = {
    // separación del pliegue respecto al párpado superior del ojo
    offsetInner: 0.030,   // separación cerca del lagrimal, fracción del radio de cabeza
    offsetOuter: 0.055,   // separación cerca del canto

    // ✅ "pronunciación" de la curva: qué tan arqueado va el pliegue
    // respecto al párpado. 0 = sigue el párpado tal cual (paralelo);
    // valores mayores lo abomban hacia arriba en su parte media.
    archAmount: 0.025,
    archPosition: 0.50,   // dónde se ubica el pico del arco (0 = lagrimal, 1 = canto)

    // ✅ línea que baja al lagrimal: nace del inicio del pliegue y va a
    // buscar el lagrimal del ojo. `tailLength` controla qué tanto de ese
    // recorrido se dibuja (0 = no aparece; 1 = llega hasta el lagrimal).
    tailLength: 0.60,

    // ✅ desvanecimiento en el canto: qué fracción del pliegue se recorta
    // desde el lado del canto (0 = llega completo al canto; 0.5 = se borra
    // la mitad exterior).
    cantoFade: 0.20
}

let lidGroup = null
let rightLidLine = null
let leftLidLine = null
let rightLidMat = null
let leftLidMat = null
let currentBaseRadius = 0

// misma perpendicular estable que usa eyelashes.js: apunta hacia afuera
// del centro del contorno, así no puede invertirse de golpe en curvas
// con mucha variación.
function curveCenter(points){
    let sx = 0
    let sy = 0
    for(const p of points){ sx += p.x; sy += p.y }
    return { x: sx / points.length, y: sy / points.length }
}

function localPerpAway(points, i, center){
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
    const toPointX = points[i].x - center.x
    const toPointY = points[i].y - center.y
    if(px * toPointX + py * toPointY < 0){ px = -px; py = -py }
    return { px, py }
}

// arco posicionable: vale 0 en los extremos y 1 en `position`
function archBump(t, position){
    const p = THREE.MathUtils.clamp(position, 0.01, 0.99)
    const x = t < p ? t / p : (1 - t) / (1 - p)
    const c = THREE.MathUtils.clamp(x, 0, 1)
    return c * c * (3 - 2 * c) // suavizado, sin pico anguloso
}

function easeLerp(a, b, t){
    const s = t * t * (3 - 2 * t)
    return a + (b - a) * s
}

// Construye el pliegue: recorre el párpado superior del ojo desde el
// lagrimal hacia el canto, desplazándose hacia afuera, y le suma el arco.
// Devuelve también el primer punto, para poder colgar de ahí la línea que
// baja al lagrimal.
function buildLidPoints(baseRadius, upperLidPts){
    const n = upperLidPts.length
    if(n < 2) return []

    const center = curveCenter(upperLidPts)
    const fade = THREE.MathUtils.clamp(lidParams.cantoFade, 0, 0.9)

    const pts = []
    for(let i = 0; i < n; i++){
        const t = i / (n - 1) // 0 = lagrimal, 1 = canto
        // ✅ el desvanecimiento del canto recorta el recorrido por el lado
        // del canto: se deja de dibujar antes de llegar al final.
        if(t > 1 - fade) break

        const { px, py } = localPerpAway(upperLidPts, i, center)
        const base = easeLerp(lidParams.offsetInner, lidParams.offsetOuter, t) * baseRadius
        const arch = lidParams.archAmount * archBump(t, lidParams.archPosition) * baseRadius
        const d = base + arch

        const p = upperLidPts[i]
        pts.push({ x: p.x + px * d, y: p.y + py * d, z: p.z })
    }

    if(!pts.length) return []

    // ✅ línea que baja al lagrimal: del inicio del pliegue hacia el
    // lagrimal real del ojo, recorrida solo parcialmente según tailLength.
    const tail = THREE.MathUtils.clamp(lidParams.tailLength, 0, 1)
    if(tail > 0){
        const start = pts[0]
        const lagrimal = upperLidPts[0]
        const segs = 6
        const tailPts = []
        for(let i = 1; i <= segs; i++){
            const k = (i / segs) * tail
            tailPts.push({
                x: start.x + (lagrimal.x - start.x) * k,
                y: start.y + (lagrimal.y - start.y) * k,
                z: start.z + (lagrimal.z - start.z) * k
            })
        }
        // se antepone en orden inverso, para que el trazo sea continuo:
        // punta de la cola → inicio del pliegue → ... → canto
        tailPts.reverse()
        pts.unshift(...tailPts)
    }

    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

function buildLids(baseRadius){
    if(!lidGroup || !baseRadius) return

    while(lidGroup.children.length){
        lidGroup.remove(lidGroup.children[0])
    }

    const { right, left } = getEyeUpperLidPoints(baseRadius)

    rightLidMat = new THREE.LineBasicMaterial({ color: 0xffcc66, depthTest: true, depthWrite: false })
    const rightPts = buildLidPoints(baseRadius, right)
    if(rightPts.length){
        rightLidLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightLidMat)
        rightLidLine.renderOrder = 999
        lidGroup.add(rightLidLine)
    }

    leftLidMat = new THREE.LineBasicMaterial({ color: 0xffcc66, depthTest: true, depthWrite: false })
    const leftPts = buildLidPoints(baseRadius, left)
    if(leftPts.length){
        leftLidLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), leftLidMat)
        leftLidLine.renderOrder = 999
        lidGroup.add(leftLidLine)
    }
}

// Llamar desde viewer.js DESPUÉS de createEyeGuides (necesita la curva
// del párpado superior ya construida).
export function createEyelidGuides(loomisGroup, loomisBaseRadius){
    removeEyelidGuides()
    if(!loomisGroup || !loomisBaseRadius) return

    currentBaseRadius = loomisBaseRadius
    lidGroup = new THREE.Group()
    loomisGroup.add(lidGroup)

    buildLids(currentBaseRadius)
}

export function removeEyelidGuides(){
    if(lidGroup && lidGroup.parent) lidGroup.parent.remove(lidGroup)
    lidGroup = null
    rightLidLine = null
    leftLidLine = null
    rightLidMat = null
    leftLidMat = null
}

function rebuild(){
    if(currentBaseRadius) buildLids(currentBaseRadius)
}

export function setLidOffsetInner(value){ lidParams.offsetInner = value; rebuild() }
export function setLidOffsetOuter(value){ lidParams.offsetOuter = value; rebuild() }
export function setLidArchAmount(value){ lidParams.archAmount = value; rebuild() }
export function setLidArchPosition(value){ lidParams.archPosition = value; rebuild() }
export function setLidTailLength(value){ lidParams.tailLength = value; rebuild() }
export function setLidCantoFade(value){ lidParams.cantoFade = value; rebuild() }

export function setEyelidOcclusion(respectOcclusion){
    ;[rightLidMat, leftLidMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}

// silueta 2D (vista frontal / perfil), mismo patrón que el resto
export function getEyelidOutlines2D(){
    const { right, left } = getEyeUpperLidPoints(1)
    const flat = v => ({ x: v.x, y: v.y, z: v.z })
    return {
        right: buildLidPoints(1, right).map(flat),
        left: buildLidPoints(1, left).map(flat)
    }
}
