import * as THREE from 'three'

// Guia de cejas: una banda alargada con espesor variable a lo largo de un
// eje cabeza-cola, con un arco (bump) posicionable. Mismo patron que
// eyes.js - cuelga del mismo loomisGroup, asi hereda posicion/rotacion de
// la cabeza automaticamente.

// ✅ Los parametros son AHORA POR CEJA (derecha / izquierda), para poder
// ajustar cada una por separado desde "Ajuste fino por forma". Los
// sliders globales del grupo "Cejas" escriben en ambas a la vez; los
// per-lado escriben solo en una.
function defaultBrowParams(){
    return {
        // --- eje: cabeza de la ceja (fija, cerca de la nariz) -> cola ---
        lengthMult: 0.43,   // largo total, fraccion del radio de cabeza (mas corta = bajar esto)
        angleDeg: -4,       // inclinacion/rotacion de toda la ceja sobre su ancla (la cabeza)

        // --- espesor de la banda ---
        thicknessMult: 0.040, // espesor base, fraccion del radio de cabeza (engrosar = subir esto)
        // ⚠️ CORREGIDO: tailTaper estaba en 0.85, no en 1.0. Con 0.85 la
        // punta se queda con ~15% de grosor y el borde superior/inferior
        // NUNCA se tocan ahi - queda una horquilla/bifurcacion en vez de
        // un punto, sin importar cuanto se mueva/escale/rote el trazo
        // (por eso los sliders de ajuste fino no lo arreglaban: el
        // problema es de forma, no de posicion). En 1.0 el grosor llega
        // exactamente a cero en t=1 y ambos bordes convergen en un punto.
        tailTaper: 1.00,       // 0 = espesor uniforme en la cola, 1 = la cola se afina hasta un punto
        headTaper: 0.00,       // 0 = espesor uniforme en la cabeza, 1 = la cabeza se afina hasta un punto

        // --- arco ---
        // ✅ CAMBIO: archPosition en 0.35 para que el pico del arco caiga
        // en la region 1->2 del boceto, mas cerca de la cabeza de la ceja.
        // Un arco simple (archBump) YA vuelve a cero en ambos extremos
        // (cabeza y cola) por diseño - por eso mover el pico hacia 1->2
        // ya infla esa zona SIN mover la punta, sin necesitar nada mas.
        archPosition: 0.35, // donde se ubica el pico del arco (0 = junto a la cabeza, 1 = junto a la cola)
        archHeight: 0.02,   // que tan pronunciado es el arco, fraccion del radio de cabeza
        archSharpness: 0.00, // que tan ANCHA es la joroba del arco - 0 = muy ancha y suave (arco simple), 1 = angosta y marcada

        // ✅ forma general del trazo: 0 = ARCO simple (una sola joroba,
        // uniforme, sin ondulaciones - esto es lo que da el arco "limpio"
        // como el de la referencia rosa). Positivo = S normal (la cola
        // baja); negativo = S invertida (la cola sube).
        // ⚠️ CORREGIDO: se revirtio a 0. El valor -0.5 sumaba una SEGUNDA
        // joroba cerca de la punta para "rellenar", pero eso es justo lo
        // que producia la ondulacion/gancho no uniforme (la ceja verde).
        // Para inflar la zona 1->2 sin mover la punta NO hace falta esto:
        // basta con archPosition (ver arriba). sCurve se deja disponible
        // para cuando de verdad se quiera una forma en S expresiva.
        sCurve: 0,

        // --- posicion del par en la cara ---
        gapMult: 0.55,       // distancia del centro de la cara a la cabeza de la ceja, fraccion del radio
        vertOffsetMult: 0.15, // altura sobre la linea de ojos, fraccion del radio

        // --- profundidad (para calibrar contra una referencia de perfil) ---
        depthOffset: 0, // 0 = sigue la curvatura natural de la esfera; +/- la mueve adelante/atras

        // ✅ inclinación en profundidad: la cola de la ceja se hunde o
        // adelanta respecto a la cabeza. En perfil es lo que define si la
        // ceja "envuelve" la sien o queda plana.
        depthTilt: 0,

        // ✅ NUEVO: eleva o baja SOLO la punta/cola (direccion oreja), sin
        // tocar el resto del trazo (cabeza, zona del arco, etc). Positivo
        // = sube la punta, negativo = la baja. Fraccion del radio de
        // cabeza. La transicion es suave (ver tipLiftFactor) para que no
        // se forme un quiebre justo antes de la punta.
        tipLift: 0
    }
}

// ✅ Curva de activacion del tipLift: 0 desde la cabeza hasta
// TIP_LIFT_START, y sube suavemente (smoothstep) hasta 1 justo en la
// punta (t=1). Asi el desplazamiento se concentra SOLO en el ultimo
// tramo de la ceja, sin mover nada antes de ese punto.
const TIP_LIFT_START = 0.75

function tipLiftFactor(t){
    if(t <= TIP_LIFT_START) return 0
    const u = (t - TIP_LIFT_START) / (1 - TIP_LIFT_START)
    return u * u * (3 - 2 * u) // smoothstep: transicion suave, sin quiebres
}

let browParams = {
    right: defaultBrowParams(),
    left: defaultBrowParams()
}

function paramsFor(side){
    return side === 'left' ? browParams.left : browParams.right
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
// ✅ Mezcla entre ARCO simple y forma de S. La S se obtiene restando una
// segunda joroba, situada en la cola, a la joroba principal: el trazo sube
// cerca de la cabeza y baja hacia la cola, que es justo el perfil en S.
// Con sCurve = 0 queda el arco de siempre.
function archShape(t, p, shapeSum){
    const main = archBump(t, p.archPosition, shapeSum)
    const s = THREE.MathUtils.clamp(p.sCurve, -1, 1)
    if(!s) return main

    // ✅ s > 0 → hunde la cola con una joroba secundaria (S más marcada).
    if(s > 0){
        const dipPos = THREE.MathUtils.clamp(p.archPosition + 0.45, 0.03, 0.97)
        return main - s * archBump(t, dipPos, shapeSum) * 1.4
    }

    // ✅ s < 0 → INFLA la zona justo adelante del pico. No traslada la
    // cola (eso hacía el término t², que subía también la punta y solo
    // movía la forma): añade volumen localizado ahí para RELLENAR la
    // caída, dejando la punta donde estaba.
    //
    // El abultamiento es angosto y se sitúa poco después del pico, que es
    // donde el trazo se hunde y se forma la S no deseada.
    const fillPos = THREE.MathUtils.clamp(p.archPosition + 0.22, 0.03, 0.97)
    const fillWidth = shapeSum * 1.6 // más angosto que la joroba principal
    const fill = archBump(t, fillPos, fillWidth)
    return main + Math.abs(s) * fill * 1.1
}

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
    const p = paramsFor(mirrorX ? 'left' : 'right')
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

    // ✅ tipLift en unidades de mundo - se suma al arco solo en el ultimo
    // tramo (ver tipLiftFactor), moviendo la punta como bloque sin afectar
    // el resto del trazo.
    const tipLiftWorld = baseRadius * p.tipLift

    const raw = []

    // --- borde superior: cabeza (t=0) -> cola (t=1) ---
    for(let i = 0; i <= segs; i++){
        const t = i / segs
        const arch = archHeightWorld * archShape(t, p, archShapeSum) + tipLiftWorld * tipLiftFactor(t)
        const halfThickness = halfThicknessBase * (1 - p.tailTaper * t) * (1 - p.headTaper * (1 - t))

        raw.push({
            x: t * outer.x + perpUpX * (arch + halfThickness),
            y: t * outer.y + perpUpY * (arch + halfThickness)
        })
    }

    // --- borde inferior: cola (t=1) -> cabeza (t=0), cierra el lazo ---
    for(let i = segs; i >= 0; i--){
        const t = i / segs
        const arch = archHeightWorld * archShape(t, p, archShapeSum) + tipLiftWorld * tipLiftFactor(t)
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

    const n = raw.length
    return raw.map(({ x, y }, i) => {
        const ax = (x * cosAdj - y * sinAdj) * adjust.scale + adjust.x * baseRadius
        const ay = (x * sinAdj + y * cosAdj) * adjust.scale + adjust.y * baseRadius

        const worldX = anchorX + ax
        const worldY = anchorY + ay
        const naturalZ = Math.sqrt(Math.max(surfaceR * surfaceR - worldX * worldX - worldY * worldY, 0.0001))

        // ✅ la inclinación reparte profundidad de la cabeza a la cola:
        // −1 en la cabeza y +1 en la cola, para poder "envolver" la sien.
        const t = n > 1 ? (i / (n - 1)) : 0.5
        const tilt = (t - 0.5) * 2 * p.depthTilt

        const z = naturalZ + (p.depthOffset + tilt) * baseRadius
        return new THREE.Vector3(worldX, worldY, z)
    })
}

function buildBrows(baseRadius){
    if(!browGroup || !baseRadius) return

    while(browGroup.children.length){
        browGroup.remove(browGroup.children[0])
    }

    const rAnchorX = baseRadius * browParams.right.gapMult
    const rAnchorY = baseRadius * browParams.right.vertOffsetMult
    const lAnchorX = baseRadius * browParams.left.gapMult
    const lAnchorY = baseRadius * browParams.left.vertOffsetMult

    rightBrowMat = new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: true, depthWrite: false })
    const rightPts = buildBrowPoints(baseRadius, false, rAnchorX, rAnchorY)
    rightBrowLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightBrowMat)
    rightBrowLine.renderOrder = 999
    browGroup.add(rightBrowLine)

    leftBrowMat = new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: true, depthWrite: false })
    const leftPts = buildBrowPoints(baseRadius, true, -lAnchorX, lAnchorY)
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

// ✅ setter genérico: si se pasa `side` ('right'/'left') escribe SOLO en
// esa ceja; si no, escribe en AMBAS (comportamiento de los sliders
// globales del grupo "Cejas").
function setParam(key, value, side){
    if(side === 'right' || side === 'left'){
        browParams[side][key] = value
    } else {
        browParams.right[key] = value
        browParams.left[key] = value
    }
    rebuild()
}

// ✅ lee un parámetro de una ceja concreta — lo usa el panel per-lado
// para mostrar los valores de la ceja seleccionada.
export function getBrowParam(side, key){
    return paramsFor(side)[key]
}

export function getBrowParams(side){
    return { ...paramsFor(side) }
}

// setters - eje (cabeza fija, cola se mueve)
export function setBrowLength(mult, side){ setParam('lengthMult', mult, side) }
export function setBrowAngle(degrees, side){ setParam('angleDeg', degrees, side) }

// setters - espesor de la banda
export function setBrowThickness(mult, side){ setParam('thicknessMult', mult, side) }
export function setBrowTailTaper(value, side){ setParam('tailTaper', value, side) }
export function setBrowHeadTaper(value, side){ setParam('headTaper', value, side) }

// setters - arco
export function setBrowArchPosition(value, side){ setParam('archPosition', value, side) }
export function setBrowArchHeight(mult, side){ setParam('archHeight', mult, side) }
export function setBrowArchSharpness(value, side){ setParam('archSharpness', value, side) }

// setters - posicion del par en la cara
export function setBrowGap(mult, side){ setParam('gapMult', mult, side) }
export function setBrowVerticalOffset(mult, side){ setParam('vertOffsetMult', mult, side) }

// setter - profundidad (para perfil)
export function setBrowDepth(value, side){ setParam('depthOffset', value, side) }
export function setBrowDepthTilt(value, side){ setParam('depthTilt', value, side) }
export function setBrowSCurve(value, side){ setParam('sCurve', value, side) }

// setter - eleva/baja SOLO la punta (cola), sin afectar el resto del trazo
export function setBrowTipLift(value, side){ setParam('tipLift', value, side) }

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
    const rAnchorX = baseRadius * browParams.right.gapMult
    const rAnchorY = baseRadius * browParams.right.vertOffsetMult
    const lAnchorX = baseRadius * browParams.left.gapMult
    const lAnchorY = baseRadius * browParams.left.vertOffsetMult

    const right = buildBrowPoints(baseRadius, false, rAnchorX, rAnchorY).map(v => ({ x: v.x, y: v.y, z: v.z }))
    const left = buildBrowPoints(baseRadius, true, -lAnchorX, lAnchorY).map(v => ({ x: v.x, y: v.y, z: v.z }))

    return { right, left }
}
