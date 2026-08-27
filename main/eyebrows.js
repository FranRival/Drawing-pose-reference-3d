import * as THREE from 'three'

// Guia de cejas: una banda alargada con espesor variable a lo largo de un
// eje cabeza-cola, con un arco (bump) posicionable. Mismo patron que
// eyes.js - cuelga del mismo loomisGroup, asi hereda posicion/rotacion de
// la cabeza automaticamente.

let browParams = {
    // --- eje: cabeza de la ceja (fija, cerca de la nariz) -> cola ---
    lengthMult: 0.43,   // largo total, fraccion del radio de cabeza (mas corta = bajar esto)
    angleDeg: -4,       // inclinacion/rotacion de toda la ceja sobre su ancla (la cabeza)

    // --- espesor de la banda ---
    thicknessMult: 0.040, // espesor base, fraccion del radio de cabeza (engrosar = subir esto)
    tailTaper: 0.85,       // 0 = espesor uniforme en la cola, 1 = la cola se afina hasta un punto
    headTaper: 0.00,       // 0 = espesor uniforme en la cabeza, 1 = la cabeza se afina hasta un punto

    // --- arco ---
    archPosition: 0.55, // donde se ubica el pico del arco (0 = junto a la cabeza, 1 = junto a la cola)
    archHeight: 0.02,   // que tan pronunciado es el arco, fraccion del radio de cabeza
    archSharpness: 0.00, // que tan ANCHA es la joroba del arco - 0 = muy ancha y suave (arco simple), 1 = angosta y marcada

    // --- posicion del par en la cara ---
    gapMult: 0.55,       // distancia del centro de la cara a la cabeza de la ceja, fraccion del radio
    vertOffsetMult: 0.15 // altura sobre la linea de ojos, fraccion del radio
}

// mismo truco anti z-fighting que las lineas de superficie en viewer.js y en eyes.js
const BROW_SURFACE_OFFSET = 1.02

// el ancho de la joroba del arco ahora es controlable via archSharpness -
// suma baja (ancha, arco simple y suave) a suma alta (angosta, acento marcado)
const ARCH_SHAPE_SUM_MIN = 2.5  // muy ancho, casi imperceptible como "joroba" - arco simple
const ARCH_SHAPE_SUM_MAX = 16   // muy angosto, pico marcado y localizado

let browGroup = null
let rightBrowLine = null
let leftBrowLine = null
let rightBrowMat = null
let leftBrowMat = null
let currentBaseRadius = 0

// ✅ NUEVO: ajuste POR CEJA (derecho/izquierdo) - misma logica que
// eyeShapeAdjust en eyes.js. Vive aqui para que sea la unica fuente de
// verdad entre el 3D (buildBrows) y el 2D (getBrowOutlines2D).
let browShapeAdjust = {
    right: { x: -0.32, y: 0.11, scale: 1.22, rotationDeg: 0 },
    left:  { x: 0.31, y: 0.13, scale: 1.36, rotationDeg: 1 }
}

// bulto unimodal normalizado (pico = 1), con el pico ubicado exactamente
// en archPosition y un ancho controlado por shapeSum - mismo principio que
// las curvas de inflado del ojo, pero aca SI queremos una sola joroba
// suave (no dos esquinas picudas), asi que la funcion de potencias es la
// herramienta correcta para esto.
function archBump(t, archPosition, shapeSum){
    const clampedPos = THREE.MathUtils.clamp(archPosition, 0.03, 0.97) // antes 0.05/0.95 - ahora sí llega casi a ambos extremos
    const a = shapeSum * clampedPos
    const b = shapeSum * (1 - clampedPos)
    const peak = Math.pow(clampedPos, a) * Math.pow(1 - clampedPos, b)
    if(peak <= 0) return 0
    const raw = Math.pow(t, a) * Math.pow(1 - t, b)
    return raw / peak
}

// Construye el contorno de UNA ceja, ya en coordenadas absolutas dentro de
// loomisGroup (misma logica que eyes.js: cada punto calcula su propia
// profundidad sobre la curvatura real de la cabeza). mirrorX=true -> la
// cola se abre hacia la izquierda (ceja izquierda).
function buildBrowPoints(baseRadius, mirrorX, anchorX, anchorY){
    const p = browParams
    const segs = 24

    const angleRad = THREE.MathUtils.degToRad(p.angleDeg)
    const dirSign = mirrorX ? -1 : 1
    const dx = dirSign * Math.cos(angleRad)
    const dy = Math.sin(angleRad)

    const length = baseRadius * p.lengthMult
    const outer = { x: dx * length, y: dy * length } // la cola

    // perpendicular al eje, elegida para que SIEMPRE apunte "hacia arriba"
    // (y >= 0) sin importar mirrorX - misma logica que en eyes.js.
    let perpUpX = -dy
    let perpUpY = dx
    if(perpUpY < 0){
        perpUpX = dy
        perpUpY = -dx
    }

    const archHeightWorld = baseRadius * p.archHeight
    const archShapeSum = THREE.MathUtils.lerp(ARCH_SHAPE_SUM_MIN, ARCH_SHAPE_SUM_MAX, THREE.MathUtils.clamp(p.archSharpness, 0, 1))
    const halfThicknessBase = (baseRadius * p.thicknessMult) / 2

    const raw = []

    // --- borde superior: cabeza (t=0) -> cola (t=1) ---
    for(let i = 0; i <= segs; i++){
        const t = i / segs
        const arch = archHeightWorld * archBump(t, p.archPosition, archShapeSum)
        const halfThickness = halfThicknessBase * (1 - p.tailTaper * t) * (1 - p.headTaper * (1 - t))

        raw.push({
            x: t * outer.x + perpUpX * (arch + halfThickness),
            y: t * outer.y + perpUpY * (arch + halfThickness)
        })
    }

    // --- borde inferior: cola (t=1) -> cabeza (t=0), cierra el lazo ---
    for(let i = segs; i >= 0; i--){
        const t = i / segs
        const arch = archHeightWorld * archBump(t, p.archPosition, archShapeSum)
        const halfThickness = halfThicknessBase * (1 - p.tailTaper * t) * (1 - p.headTaper * (1 - t))

        raw.push({
            x: t * outer.x + perpUpX * (arch - halfThickness),
            y: t * outer.y + perpUpY * (arch - halfThickness)
        })
    }

    // cada punto se "pega" a la curvatura real de la cabeza en su X/Y
    // exacto - mismo principio que las demas lineas de superficie.
    const surfaceR = baseRadius * BROW_SURFACE_OFFSET

    // ✅ NUEVO: ajuste por ceja (compartido con el modo 2D) - pivotea
    // sobre la cabeza de la ceja (origen local), igual que en eyes.js.
    const adjust = mirrorX ? browShapeAdjust.left : browShapeAdjust.right
    const adjRad = THREE.MathUtils.degToRad(adjust.rotationDeg)
    const cosAdj = Math.cos(adjRad)
    const sinAdj = Math.sin(adjRad)

    return raw.map(({ x, y }) => {
        const ax = (x * cosAdj - y * sinAdj) * adjust.scale + adjust.x * baseRadius
        const ay = (x * sinAdj + y * cosAdj) * adjust.scale + adjust.y * baseRadius

        const worldX = anchorX + ax
        const worldY = anchorY + ay
        const z = Math.sqrt(Math.max(surfaceR * surfaceR - worldX * worldX - worldY * worldY, 0.0001))
        return new THREE.Vector3(worldX, worldY, z)
    })
}

function buildBrows(baseRadius){
    if(!browGroup || !baseRadius) return

    while(browGroup.children.length){
        browGroup.remove(browGroup.children[0])
    }

    const anchorX = baseRadius * browParams.gapMult
    const anchorY = baseRadius * browParams.vertOffsetMult

    rightBrowMat = new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: true, depthWrite: false })
    const rightPts = buildBrowPoints(baseRadius, false, anchorX, anchorY)
    rightBrowLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightBrowMat)
    rightBrowLine.renderOrder = 999
    browGroup.add(rightBrowLine)

    leftBrowMat = new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: true, depthWrite: false })
    const leftPts = buildBrowPoints(baseRadius, true, -anchorX, anchorY)
    leftBrowLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), leftBrowMat)
    leftBrowLine.renderOrder = 999
    browGroup.add(leftBrowLine)
}

// Llamar desde viewer.js, dentro/despues de createLoomisGuide, pasando el
// loomisGroup y el loomisBaseRadius ya calculado - mismo patron que eyes.js.
export function createEyebrowGuides(loomisGroup, loomisBaseRadius){
    removeEyebrowGuides()
    if(!loomisGroup || !loomisBaseRadius) return

    currentBaseRadius = loomisBaseRadius
    browGroup = new THREE.Group()
    loomisGroup.add(browGroup)

    buildBrows(currentBaseRadius)
}

export function removeEyebrowGuides(){
    if(browGroup && browGroup.parent) browGroup.parent.remove(browGroup)
    browGroup = null
    rightBrowLine = null
    leftBrowLine = null
    rightBrowMat = null
    leftBrowMat = null
}

function rebuild(){
    if(currentBaseRadius) buildBrows(currentBaseRadius)
}

// setters - eje (cabeza fija, cola se mueve)
export function setBrowLength(mult){ browParams.lengthMult = mult; rebuild() }
export function setBrowAngle(degrees){ browParams.angleDeg = degrees; rebuild() }

// setters - espesor de la banda
export function setBrowThickness(mult){ browParams.thicknessMult = mult; rebuild() }
export function setBrowTailTaper(value){ browParams.tailTaper = value; rebuild() }
export function setBrowHeadTaper(value){ browParams.headTaper = value; rebuild() }

// setters - arco
export function setBrowArchPosition(value){ browParams.archPosition = value; rebuild() }
export function setBrowArchHeight(mult){ browParams.archHeight = mult; rebuild() }
export function setBrowArchSharpness(value){ browParams.archSharpness = value; rebuild() }

// setters - posicion del par en la cara
export function setBrowGap(mult){ browParams.gapMult = mult; rebuild() }
export function setBrowVerticalOffset(mult){ browParams.vertOffsetMult = mult; rebuild() }

// setters/getter - ajuste POR CEJA (derecho/izquierdo), compartido entre
// el modo 2D y el 3D — side es 'right' o 'left'.
export function setBrowShapeOffsetX(side, value){ if(browShapeAdjust[side]){ browShapeAdjust[side].x = value; rebuild() } }
export function setBrowShapeOffsetY(side, value){ if(browShapeAdjust[side]){ browShapeAdjust[side].y = value; rebuild() } }
export function setBrowShapeScale(side, value){ if(browShapeAdjust[side]){ browShapeAdjust[side].scale = value; rebuild() } }
export function setBrowShapeRotation(side, degrees){ if(browShapeAdjust[side]){ browShapeAdjust[side].rotationDeg = degrees; rebuild() } }
export function getBrowShapeAdjust(side){ return browShapeAdjust[side] || browShapeAdjust.right }

// para conectar con el toggle "respetar oclusion" existente en viewer.js
export function setEyebrowOcclusion(respectOcclusion){
    ;[rightBrowMat, leftBrowMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}

// ✅ NUEVO: silueta 2D de las cejas, para mode2d.js — mismo principio que
// getEyeOutlines2D en eyes.js: reutiliza buildBrowPoints con baseRadius=1,
// sin depender del modelo 3D, y descarta la Z.
export function getBrowOutlines2D(){
    const baseRadius = 1
    const anchorX = baseRadius * browParams.gapMult
    const anchorY = baseRadius * browParams.vertOffsetMult

    const right = buildBrowPoints(baseRadius, false, anchorX, anchorY).map(v => ({ x: v.x, y: v.y }))
    const left = buildBrowPoints(baseRadius, true, -anchorX, anchorY).map(v => ({ x: v.x, y: v.y }))

    return { right, left }
}
