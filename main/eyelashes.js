import * as THREE from 'three'
import { getEyeUpperLidPoints, getEyeLowerLidPoints } from './eyes.js'

// Pestañas: TRES estilos.
//   'shadow'  - banda sobre el párpado superior + banda delgada inferior,
//               ambas independientes, sin pico.
//   'spikes'  - igual, pero con dentado + pico grande en el canto (se
//               cierra sobre SÍ MISMO — nunca toca la pestaña inferior).
//   'fusion'  - UN SOLO contorno cerrado que envuelve todo el ojo: nace
//               fino en el lagrimal, se engruesa con dentado hacia el
//               canto, remata en una PUNTA afilada ahí, y desde esa misma
//               punta baja envolviendo el párpado inferior hasta cerrar
//               de vuelta cerca del lagrimal. Nunca son dos piezas — es
//               una sola línea de principio a fin.

let lashParams = {
    style: 'fusion', // 'shadow' | 'spikes' | 'fusion'
    innerThickness: 0.015,
    outerThickness: 0.035,

    lowerLashInnerThickness: 0.006,
    lowerLashOuterThickness: 0.032,

    cantoSpikeLength: 0.055,
    cantoSpikeCurve: 0.005,
    cantoSpikeScale: 1.0,
    cantoSpikeTipRotation: -11,

    lashSpikeCount: 5,

    // ✅ NUEVO: púas reales (tubos con punta) sobre la banda superior, en
    // vez de la modulación en onda anterior (que producía la "viborita").
    lashSpikeLength: 0.05,   // longitud de cada púa, fracción del radio de cabeza
    lashSpikeWidth: 0.012,   // grosor de la base de cada púa, fracción del radio
    lashSpikeLean: 0,        // orientación 2D: -1 = todas se inclinan al lagrimal, +1 = al canto, 0 = perpendiculares
    lashSpikeSide: 'right',  // 'left' | 'right' | 'random' — de qué lado del iris salen las púas
    lashSpikeSeed: 1,        // semilla para el modo 'random' (mismo valor = mismo patrón)

    // ✅ NUEVO: balance superior/inferior — un solo control, coexiste
    // ENCIMA de los sliders de grosor existentes (los multiplica, no los
    // reemplaza). -1 = toda la pestaña superior se adelgaza y la inferior
    // se engruesa; +1 = al revés. En 0, sin efecto (proporciones tal cual
    // las dejan los sliders). Entre más lejos de 0 (en cualquier
    // dirección), más filosa la punta — nunca por un slider aparte, es
    // consecuencia directa de la misma redistribución de proporciones.
    lashBalance: -0.20
}

// K = qué tan fuerte reparte el balance entre superior/inferior.
// SHARPEN = qué tanto se reduce la curvatura de la punta según |balance|.
const BALANCE_K = 0.6
const BALANCE_SHARPEN = 0.8

function balanceMultipliers(){
    const b = THREE.MathUtils.clamp(lashParams.lashBalance, -1, 1)
    return {
        upperMult: 1 + b * BALANCE_K,
        lowerMult: 1 - b * BALANCE_K,
        curveMult: 1 - Math.abs(b) * BALANCE_SHARPEN
    }
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

function cubicBezierPoint(p0, p1, p2, p3, t){
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const d = t * t * t
    return {
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
    }
}

// ✅ REEMPLAZA a la vieja modulación en onda: genera púas reales (tubos
// con punta) que se INSERTAN en el borde de la banda, en vez de ondular
// el grosor. Devuelve una lista de púas, cada una con el índice del punto
// del borde donde nace y sus 3 vértices (base A → punta → base B).
// El lado se decide respecto al CENTRO del ojo (donde va el iris), igual
// criterio que usa pupils.js para centrarlo, pero calculado aquí para no
// crear una dependencia circular entre módulos.
function pseudoRandom(seed, i){
    const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453
    return x - Math.floor(x)
}

function buildLashSpikes(baseRadius, borderPts, lidPoints, center){
    const count = Math.max(1, Math.round(lashParams.lashSpikeCount))
    const n = borderPts.length
    if(n < 3 || count < 1) return []

    const length = baseRadius * lashParams.lashSpikeLength
    const halfWidth = (baseRadius * lashParams.lashSpikeWidth) / 2
    const lean = THREE.MathUtils.clamp(lashParams.lashSpikeLean, -1, 1)
    const side = lashParams.lashSpikeSide

    const spikes = []
    for(let s = 0; s < count; s++){
        // repartidas a lo largo del borde, sin pegarse a los extremos
        const t = (s + 1) / (count + 1)
        const idx = Math.min(Math.max(Math.round(t * (n - 1)), 1), n - 2)
        const p = borderPts[idx]

        // ¿de qué lado del centro (iris) cae esta púa?
        const isRightSide = p.x > center.x
        if(side === 'right' && !isRightSide) continue
        if(side === 'left' && isRightSide) continue
        if(side === 'random' && pseudoRandom(lashParams.lashSpikeSeed, s) < 0.5) continue

        // dirección de la púa: la normal del borde en ese punto, inclinada
        // hacia el lagrimal o el canto según `lean`
        const { px, py } = localPerpAway(borderPts, idx, center)
        let tx = borderPts[idx + 1].x - borderPts[idx - 1].x
        let ty = borderPts[idx + 1].y - borderPts[idx - 1].y
        const tl = Math.sqrt(tx * tx + ty * ty) || 1
        tx /= tl
        ty /= tl

        let dx = px + tx * lean
        let dy = py + ty * lean
        const dl = Math.sqrt(dx * dx + dy * dy) || 1
        dx /= dl
        dy /= dl

        spikes.push({
            idx,
            baseA: { x: p.x - tx * halfWidth, y: p.y - ty * halfWidth, z: p.z },
            tip: { x: p.x + dx * length, y: p.y + dy * length, z: p.z },
            baseB: { x: p.x + tx * halfWidth, y: p.y + ty * halfWidth, z: p.z }
        })
    }
    return spikes
}

// inserta las púas dentro de la secuencia del borde, en orden
function weaveSpikes(borderPts, spikes){
    if(!spikes.length) return [...borderPts]
    const byIdx = new Map()
    for(const sp of spikes) byIdx.set(sp.idx, sp)

    const out = []
    for(let i = 0; i < borderPts.length; i++){
        const sp = byIdx.get(i)
        if(sp){
            out.push(sp.baseA, sp.tip, sp.baseB)
        } else {
            out.push(borderPts[i])
        }
    }
    return out
}

// ✅ NUEVO: interpolación SUAVE (smoothstep), no lineal — el grosor entra
// y sale de forma orgánica, como una curva, en vez de crecer a ritmo
// mecánico constante. Esto es lo que hace que el engrosamiento "fluya"
// en vez de sentirse rígido.
function easeLerp(a, b, t){
    const s = t * t * (3 - 2 * t)
    return a + (b - a) * s
}

// ✅ CORREGIDO: antes se decidía el lado de la perpendicular forzando
// py>=0 — en curvas con mucha variación (como el párpado superior con
// lift/erase/flick/etc.) esa regla podía INVERTIRSE de golpe en algún
// punto del recorrido, creando un escalón/bulto ahí mismo. Ahora se
// decide según si el punto se aleja del CENTRO del contorno — un criterio
// estable que nunca cambia de golpe entre puntos vecinos.
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

// ✅ Pestaña SUPERIOR autosuficiente (estilos 'shadow' y 'spikes'). Cierra
// siempre contra su propio párpado superior — nunca toca el inferior.
// mirrorX indica si es el ojo espejado (izquierdo), necesario para que la
// orientación absoluta de la punta funcione igual en ambos ojos.
function buildUpperLashPoints(baseRadius, lidPoints, mirrorX){
    const n = lidPoints.length
    if(n < 2) return []

    const useSpike = lashParams.style === 'spikes'
    const center = curveCenter(lidPoints)
    const { upperMult, curveMult } = balanceMultipliers()

    const offsetPts = lidPoints.map((p, i) => {
        const { px, py } = localPerpAway(lidPoints, i, center)
        const t = i / (n - 1)
        const thickness = easeLerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius * upperMult
        return { x: p.x + px * thickness, y: p.y + py * thickness, z: p.z }
    })

    // ✅ las púas ya no modulan el grosor: son geometría real insertada en
    // el borde exterior, respetando lado (izq/der del iris), longitud,
    // grosor y orientación.
    const borderPts = useSpike
        ? weaveSpikes(offsetPts, buildLashSpikes(baseRadius, offsetPts, lidPoints, center))
        : offsetPts

    const pts = [...borderPts]

    if(useSpike){
        const cantoBase = offsetPts[offsetPts.length - 1]
        const prevOffset = offsetPts[offsetPts.length - 2] || cantoBase
        const trueCanto = lidPoints[n - 1]
        const prevTrueCanto = lidPoints[n - 2] || trueCanto

        // ✅ CORREGIDO: orientación ABSOLUTA, no relativa a la tangente del
        // párpado (eso era lo que causaba el cruce de líneas). 0° = hacia
        // la oreja (horizontal); positivo = hacia la coronilla; negativo
        // = hacia el cuello. Igual para ambos ojos gracias a dirSign.
        const dirSign = mirrorX ? -1 : 1
        const rotRad = THREE.MathUtils.degToRad(lashParams.cantoSpikeTipRotation)
        const tipDirX = dirSign * Math.cos(rotRad)
        const tipDirY = Math.sin(rotRad)

        const perpX = -tipDirY
        const perpY = tipDirX

        const length = baseRadius * lashParams.cantoSpikeLength * lashParams.cantoSpikeScale
        const curve = baseRadius * lashParams.cantoSpikeCurve * curveMult

        const tip = { x: cantoBase.x + tipDirX * length, y: cantoBase.y + tipDirY * length }

        // ✅ CORREGIDO: los dos tramos ahora son Bezier CÚBICAS (dos
        // manejadores cada una), con la tangente de llegada/salida
        // alineada a la dirección REAL del trazo en cada extremo — mismo
        // principio que ya usa la bajada de la pestaña inferior. Así la
        // curva nunca "entra" en ángulo raro, sin importar qué tan
        // distinta sea la orientación absoluta de la punta.
        const gap1 = Math.sqrt((tip.x - cantoBase.x) ** 2 + (tip.y - cantoBase.y) ** 2)
        const handleLen1 = gap1 * 0.4

        let bandTanX = cantoBase.x - prevOffset.x
        let bandTanY = cantoBase.y - prevOffset.y
        const bandTanLen = Math.sqrt(bandTanX * bandTanX + bandTanY * bandTanY) || 1
        bandTanX /= bandTanLen
        bandTanY /= bandTanLen

        const handleOut1 = { x: cantoBase.x + bandTanX * handleLen1, y: cantoBase.y + bandTanY * handleLen1 }
        const handleIn1 = { x: tip.x - tipDirX * handleLen1 + perpX * curve, y: tip.y - tipDirY * handleLen1 + perpY * curve }

        const gap2 = Math.sqrt((trueCanto.x - tip.x) ** 2 + (trueCanto.y - tip.y) ** 2)
        const handleLen2 = gap2 * 0.4

        let closeTanX = trueCanto.x - prevTrueCanto.x
        let closeTanY = trueCanto.y - prevTrueCanto.y
        const closeTanLen = Math.sqrt(closeTanX * closeTanX + closeTanY * closeTanY) || 1
        closeTanX /= closeTanLen
        closeTanY /= closeTanLen

        const handleOut2 = { x: tip.x + tipDirX * handleLen2 - perpX * curve, y: tip.y + tipDirY * handleLen2 - perpY * curve }
        const handleIn2 = { x: trueCanto.x - closeTanX * handleLen2, y: trueCanto.y - closeTanY * handleLen2 }

        const segs = 8
        for(let i = 1; i <= segs; i++) pts.push(cubicBezierPoint(cantoBase, handleOut1, handleIn1, tip, i / segs))
        for(let i = 1; i <= segs; i++) pts.push(cubicBezierPoint(tip, handleOut2, handleIn2, trueCanto, i / segs))
    }

    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])

    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

// ✅ Pestaña INFERIOR autosuficiente (estilos 'shadow' y 'spikes'). Aun
// así, NO es 100% independiente: si el pico superior tiene una
// orientación distinta a 0° (hacia la oreja), la pestaña inferior se
// inclina un poco en simpatía (acoplamiento débil) — más fuerte cerca del
// canto, desvaneciéndose hacia el lagrimal. Así "coexisten": mover una
// afecta un poco a la otra, sin quedar rígidamente ligadas.
const LOWER_LASH_COUPLING = 0.3 // fracción de la rotación del pico que se contagia

function buildLowerLashPoints(baseRadius, lidPoints){
    const n = lidPoints.length
    if(n < 2) return []

    const couplingDeg = lashParams.style === 'spikes' ? lashParams.cantoSpikeTipRotation * LOWER_LASH_COUPLING : 0
    const center = curveCenter(lidPoints)
    const { lowerMult } = balanceMultipliers()

    const offsetPts = lidPoints.map((p, i) => {
        const { px, py } = localPerpAway(lidPoints, i, center)
        const t = i / (n - 1) // 0 = canto, 1 = lagrimal
        const thickness = THREE.MathUtils.lerp(lashParams.lowerLashOuterThickness, lashParams.lowerLashInnerThickness, t) * baseRadius * lowerMult

        // influencia máxima en el canto (t=0), se desvanece hacia el lagrimal (t=1)
        const influence = 1 - t
        const rot = THREE.MathUtils.degToRad(couplingDeg * influence)
        const cosR = Math.cos(rot)
        const sinR = Math.sin(rot)
        const rpx = px * cosR - py * sinR
        const rpy = px * sinR + py * cosR

        return { x: p.x + rpx * thickness, y: p.y + rpy * thickness, z: p.z }
    })

    const pts = [...offsetPts]
    for(let i = n - 1; i >= 0; i--) pts.push(lidPoints[i])
    return pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
}

// ✅ NUEVO — modo 'fusion': UN SOLO contorno cerrado, sin bordes internos.
// Recorrido: lagrimal (fino) → borde exterior superior (dentado, se
// engruesa) → canto → PICO en punta → baja hasta el borde exterior
// inferior (en su lado del canto) → borde exterior inferior (se afina) →
// cierra de vuelta cerca del lagrimal. Nunca usa las curvas "verdaderas"
// del párpado como borde interno — por eso no puede entrelazarse consigo
// misma.
function buildFusedLashPoints(baseRadius, upperLidPoints, lowerLidPoints, mirrorX){
    const nu = upperLidPoints.length
    const nl = lowerLidPoints.length
    if(nu < 2 || nl < 2) return []

    const upperCenter = curveCenter(upperLidPoints)
    const { upperMult, lowerMult, curveMult } = balanceMultipliers()

    // borde exterior superior: lagrimal → canto
    const upperOuter = upperLidPoints.map((p, i) => {
        const { px, py } = localPerpAway(upperLidPoints, i, upperCenter)
        const t = i / (nu - 1)
        const thickness = easeLerp(lashParams.innerThickness, lashParams.outerThickness, t) * baseRadius * upperMult
        return { x: p.x + px * thickness, y: p.y + py * thickness, z: p.z }
    })

    // pico del canto: cantoBase → punta afilada
    const cantoBase = upperOuter[upperOuter.length - 1]

    // ✅ CORREGIDO: orientación ABSOLUTA (igual que en buildUpperLashPoints)
    // — 0° = hacia la oreja, positivo = hacia la coronilla, negativo =
    // hacia el cuello. Ya no depende de la tangente del párpado.
    const dirSign = mirrorX ? -1 : 1
    const rotRad = THREE.MathUtils.degToRad(lashParams.cantoSpikeTipRotation)
    const tipDirX = dirSign * Math.cos(rotRad)
    const tipDirY = Math.sin(rotRad)

    const perpX = -tipDirY
    const perpY = tipDirX

    const length = baseRadius * lashParams.cantoSpikeLength * lashParams.cantoSpikeScale
    const curve = baseRadius * lashParams.cantoSpikeCurve * curveMult

    const tip = { x: cantoBase.x + tipDirX * length, y: cantoBase.y + tipDirY * length, z: cantoBase.z }

    // ✅ CORREGIDO: el tramo base→punta también es una Bezier CÚBICA, con
    // el manejador proporcional a la distancia real hasta la punta
    // (gap1 * 0.4), no un valor fijo — así no se "pellizca" cuando la
    // punta está lejos (agrandar pico grande, o rotación extrema). El
    // manejador de salida sigue la tangente real de la banda superior en
    // ese punto (hacia dónde ya venía "recorriendo" el trazo).
    const prevUpperOuter = upperOuter[upperOuter.length - 2] || cantoBase
    let bandTanX = cantoBase.x - prevUpperOuter.x
    let bandTanY = cantoBase.y - prevUpperOuter.y
    const bandTanLen = Math.sqrt(bandTanX * bandTanX + bandTanY * bandTanY) || 1
    bandTanX /= bandTanLen
    bandTanY /= bandTanLen

    const gap1 = Math.sqrt((tip.x - cantoBase.x) ** 2 + (tip.y - cantoBase.y) ** 2)
    const handleLen1 = gap1 * 0.4

    const handleOut1 = { x: cantoBase.x + bandTanX * handleLen1, y: cantoBase.y + bandTanY * handleLen1 }
    const handleIn1 = { x: tip.x - tipDirX * handleLen1 + perpX * curve, y: tip.y - tipDirY * handleLen1 + perpY * curve }

    // borde exterior inferior: canto → lagrimal (se afina)
    const lowerCenter = curveCenter(lowerLidPoints)
    const lowerOuter = lowerLidPoints.map((p, i) => {
        const { px, py } = localPerpAway(lowerLidPoints, i, lowerCenter)
        const t = i / (nl - 1) // 0 = canto, 1 = lagrimal
        const thickness = THREE.MathUtils.lerp(lashParams.lowerLashOuterThickness, lashParams.lowerLashInnerThickness, t) * baseRadius * lowerMult
        return { x: p.x + px * thickness, y: p.y + py * thickness, z: p.z }
    })

    // ✅ la bajada de la punta hacia la pestaña inferior también es una
    // Bezier CÚBICA (dos manejadores), no una cuadrática con un solo
    // punto de control fijo. El manejador de llegada se alinea con la
    // dirección REAL en la que continúa la pestaña inferior (hacia
    // lowerOuter[1]) — eso es lo que garantiza que no haya un ángulo
    // recto ahí: la curva "entra" ya apuntando hacia donde sigue el trazo.
    let lowerTanX = lowerOuter[1].x - lowerOuter[0].x
    let lowerTanY = lowerOuter[1].y - lowerOuter[0].y
    const lowerTanLen = Math.sqrt(lowerTanX * lowerTanX + lowerTanY * lowerTanY) || 1
    lowerTanX /= lowerTanLen
    lowerTanY /= lowerTanLen

    const gapDist = Math.sqrt(
        (tip.x - lowerOuter[0].x) * (tip.x - lowerOuter[0].x) +
        (tip.y - lowerOuter[0].y) * (tip.y - lowerOuter[0].y)
    )
    const handleLen = gapDist * 0.4

    const handleOut = {
        x: tip.x + tipDirX * handleLen + perpX * curve,
        y: tip.y + tipDirY * handleLen + perpY * curve
    }
    const handleIn = {
        x: lowerOuter[0].x - lowerTanX * handleLen - perpX * curve,
        y: lowerOuter[0].y - lowerTanY * handleLen - perpY * curve
    }

    // ✅ las púas se tejen SOLO al volcar el borde en la secuencia final —
    // `upperOuter` se deja intacto arriba porque el pico y el cierre
    // dependen de sus índices reales.
    const pts = [...weaveSpikes(upperOuter, buildLashSpikes(baseRadius, upperOuter, upperLidPoints, upperCenter))]

    const segs = 8
    // cantoBase → punta (cúbica, proporcional a la distancia real)
    for(let i = 1; i <= segs; i++) pts.push(cubicBezierPoint(cantoBase, handleOut1, handleIn1, tip, i / segs))
    // punta → borde exterior inferior, lado canto (cúbica, tangente alineada)
    for(let i = 1; i <= segs; i++) pts.push(cubicBezierPoint(tip, handleOut, handleIn, lowerOuter[0], i / segs))

    // borde exterior inferior completo (ya empieza en lowerOuter[0])
    pts.push(...lowerOuter.slice(1))

    // ✅ CORREGIDO: el cierre final (del lagrimal inferior de vuelta al
    // lagrimal superior) YA NO es una línea recta — eso era exactamente
    // el gancho/escalón que se veía en el lagrimal. Ahora es una cúbica
    // con la tangente de salida siguiendo el propio recorrido de la banda
    // inferior, y la de llegada alineada con hacia dónde sigue la banda
    // superior — así cierra liso, sin doblez.
    const lastLower = lowerOuter[nl - 1]
    const prevLowerClose = lowerOuter[nl - 2] || lastLower
    let closeOutX = lastLower.x - prevLowerClose.x
    let closeOutY = lastLower.y - prevLowerClose.y
    const closeOutLen = Math.sqrt(closeOutX * closeOutX + closeOutY * closeOutY) || 1
    closeOutX /= closeOutLen
    closeOutY /= closeOutLen

    // ✅ AJUSTADO: cerca del lagrimal el hueco entre el cierre y el inicio
    // de la banda superior puede ser muy chico — si el manejador fuera
    // solo proporcional a ese hueco, se volvía casi nulo y no suavizaba
    // nada ahí (el pellizco que se ve justo en el arranque de la pestaña
    // superior). Ahora tiene un mínimo garantizado (relativo al radio de
    // cabeza), y la tangente de llegada usa un punto un poco más lejano
    // de la banda superior (más estable, menos ruido de un solo segmento
    // muy corto).
    const closeInRef = upperOuter[2] || upperOuter[1]
    let closeInX = closeInRef.x - upperOuter[0].x
    let closeInY = closeInRef.y - upperOuter[0].y
    const closeInLen = Math.sqrt(closeInX * closeInX + closeInY * closeInY) || 1
    closeInX /= closeInLen
    closeInY /= closeInLen

    const gapClose = Math.sqrt((upperOuter[0].x - lastLower.x) ** 2 + (upperOuter[0].y - lastLower.y) ** 2)
    const handleLenClose = Math.max(gapClose * 0.4, baseRadius * 0.05)

    const handleOutClose = { x: lastLower.x + closeOutX * handleLenClose, y: lastLower.y + closeOutY * handleLenClose }
    const handleInClose = { x: upperOuter[0].x - closeInX * handleLenClose, y: upperOuter[0].y - closeInY * handleLenClose }

    for(let i = 1; i <= segs; i++) pts.push(cubicBezierPoint(lastLower, handleOutClose, handleInClose, upperOuter[0], i / segs))

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

    if(lashParams.style === 'fusion'){
        const rightPts = buildFusedLashPoints(baseRadius, upperRight, lowerRight, false)
        rightUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightLashMat)
        rightUpperLine.renderOrder = 999
        lashGroup.add(rightUpperLine)
        rightLowerLine = null

        const leftPts = buildFusedLashPoints(baseRadius, upperLeft, lowerLeft, true)
        leftUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), leftLashMat)
        leftUpperLine.renderOrder = 999
        lashGroup.add(leftUpperLine)
        leftLowerLine = null
        return
    }

    const rightUpperPts = buildUpperLashPoints(baseRadius, upperRight, false)
    rightUpperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightUpperPts), rightLashMat)
    rightUpperLine.renderOrder = 999
    lashGroup.add(rightUpperLine)

    const leftUpperPts = buildUpperLashPoints(baseRadius, upperLeft, true)
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
export function setLashStyle(style){
    lashParams.style = (style === 'spikes' || style === 'fusion') ? style : 'shadow'
    rebuild()
}
export function setCantoSpikeLength(value){ lashParams.cantoSpikeLength = value; rebuild() }
export function setCantoSpikeCurve(value){ lashParams.cantoSpikeCurve = value; rebuild() }
export function setCantoSpikeScale(value){ lashParams.cantoSpikeScale = value; rebuild() }
export function setCantoSpikeTipRotation(degrees){ lashParams.cantoSpikeTipRotation = degrees; rebuild() }
export function setLashSpikeCount(value){ lashParams.lashSpikeCount = Math.round(value); rebuild() }
export function setLashSpikeLength(value){ lashParams.lashSpikeLength = value; rebuild() }
export function setLashSpikeWidth(value){ lashParams.lashSpikeWidth = value; rebuild() }
export function setLashSpikeLean(value){ lashParams.lashSpikeLean = value; rebuild() }
export function setLashSpikeSide(side){
    lashParams.lashSpikeSide = (side === 'left' || side === 'random') ? side : 'right'
    rebuild()
}
export function setLashSpikeSeed(value){ lashParams.lashSpikeSeed = value; rebuild() }
export function setLashBalance(value){ lashParams.lashBalance = value; rebuild() }

export function setEyelashOcclusion(respectOcclusion){
    ;[rightLashMat, leftLashMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}

// ✅ silueta 2D (vista frontal). En 'fusion', todo el contorno único va en
// `upper` y `lower` queda vacío (mode2d.js ya ignora arreglos vacíos, así
// que no hace falta tocar ese archivo).
export function getEyelashOutlines2D(){
    const { right: upperRight, left: upperLeft } = getEyeUpperLidPoints(1)
    const { right: lowerRight, left: lowerLeft } = getEyeLowerLidPoints(1)

    const flat = v => ({ x: v.x, y: v.y, z: v.z })

    if(lashParams.style === 'fusion'){
        return {
            right: { upper: buildFusedLashPoints(1, upperRight, lowerRight, false).map(flat), lower: [] },
            left: { upper: buildFusedLashPoints(1, upperLeft, lowerLeft, true).map(flat), lower: [] }
        }
    }

    return {
        right: {
            upper: buildUpperLashPoints(1, upperRight, false).map(flat),
            lower: buildLowerLashPoints(1, lowerRight).map(flat)
        },
        left: {
            upper: buildUpperLashPoints(1, upperLeft, true).map(flat),
            lower: buildLowerLashPoints(1, lowerLeft).map(flat)
        }
    }
}
