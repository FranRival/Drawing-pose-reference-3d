import { getEyeOutlines2D, setEyeShapeOffsetX, setEyeShapeOffsetY, setEyeShapeScale, setEyeShapeRotation, getEyeShapeAdjust } from './eyes.js'
import { getEyelashOutlines2D } from './eyelashes.js'
import { getEyelidOutlines2D } from './eyelids.js'
import { getPupilOutlines2D, getPupilProfileMark } from './pupils.js'
import { getBrowOutlines2D, setBrowShapeOffsetX, setBrowShapeOffsetY, setBrowShapeScale, setBrowShapeRotation, getBrowShapeAdjust } from './eyebrows.js'
import { getJawOutlines2D, setJawShapeOffsetX, setJawShapeOffsetY, setJawShapeScale, setJawShapeRotation, getJawShapeAdjust, getLoomisTransform2D } from './viewer.js'

// Modo 2D: un canvas plano donde se carga un model sheet / dibujo de
// referencia, y se superpone la silueta de ojos y cejas (solo vista
// frontal — no se dibuja el resto de la guía Loomis, así que no hay
// líneas traseras que ocultar: simplemente no existen en este modo).
// Reutiliza las mismas funciones de construcción que el 3D
// (getEyeOutlines2D / getBrowOutlines2D), así que cualquier ajuste de los
// sliders de ojos/cejas se refleja aquí automáticamente — un solo estado,
// dos vistas.

let canvas = null
let ctx = null
let viewerEl = null
let active = false
let rafId = null

// ✅ Una referencia INDEPENDIENTE por vista: el model sheet frontal y el
// de perfil son dibujos distintos, con su propio encuadre. Cada vista
// guarda su imagen y su escala/posición, y al cambiar de vista se usa
// automáticamente la que corresponde.
let refs = {
    front:   { image: null, dataURL: null, name: null, scale: 1.55, offsetX: 0.07, offsetY: 0.12 },
    profile: { image: null, dataURL: null, name: null, scale: 1.55, offsetX: 0.00, offsetY: 0.00 }
}

function currentRef(){ return refs[viewMode] || refs.front }

// ✅ Apertura del ojo SOLO EN PERFIL. La geometría del ojo es compartida
// (el 3D y la vista frontal usan los mismos puntos), así que abrirlo
// tocando eyes.js afectaría también al frontal. Por eso la apertura se
// aplica aquí, al momento de dibujar el perfil — mismo criterio que ya
// se usa con pupilAdjust2D: un ajuste que solo existe en esta vista.
// Separa el párpado superior hacia arriba y el inferior hacia abajo.
let profileEyeOpen = { upper: 0, lower: 0 }

// ✅ Ajustes de PESTAÑAS e IRIS/PUPILA exclusivos del perfil, por la misma
// razón: su geometría la comparten el 3D y la vista frontal, así que
// moverla en el módulo afectaría también al frontal. Aquí solo se
// desplaza lo que se dibuja en esta vista.
let profileLashAdjust = { depth: 0, open: 0 }

// ✅ Pestaña de perfil, en TRES piezas independientes (ver referencia):
//   1. punta afilada en el CANTO (lado oreja)
//   2. el cuerpo/banda, que ya viene de eyelashes.js
//   3. un racimo de púas IRREGULARES del lado del LAGRIMAL (nariz)
// El racimo se ve natural justamente porque sus púas NO son iguales:
// `spread` dispersa largo y ángulo a partir de una semilla fija, para que
// el patrón sea aleatorio pero estable entre redibujados.
let profileLashTip = { length: 0, angleDeg: 0, width: 0.03, curve: 0.35 }
let profileLashCluster = { count: 0, length: 0.05, spread: 0.5, angleDeg: 0, extent: 0.35, offset: 0, seed: 1,
                           width: 0.02, curve: 0.00, hook: 1, lift: 0, shift: 0 }
let profilePupilAdjust = { depth: 0, height: 0, sizeH: 1, sizeV: 1 }

// ✅ la PUPILA de perfil: una segunda elipse, más chica, dentro del iris.
// Tiene sus propios radios y desplazamiento, para poder descentrarla
// respecto al iris igual que se hace en la vista frontal.
let profileInnerPupil = { sizeH: 0.45, sizeV: 0.45, depth: 0, height: 0 }

// ✅ NUEVO: visibilidad por capa en el modo 2D. Al calibrar contra una
// referencia hay tantas guías superpuestas que cuesta distinguir cuál es
// cuál, así que cada capa se puede apagar. Por defecto solo queda el ojo
// (la forma almendrada), que es la base sobre la que se calibra todo lo
// demás.
let layerVisibility = {
    eye: true,
    lashes: false,
    lids: false,
    pupils: false,
    brows: false,
    jaw: false,
    headCircle: false
}

// ✅ el ajuste por forma (offset/escala/rotación de cada ojo/ceja) YA NO
// vive aquí — vive en eyeShapeAdjust (eyes.js) y browShapeAdjust
// (eyebrows.js), aplicado dentro de buildEyePoints/buildBrowPoints. Así
// lo que se mueve en el modo 2D es el mismo dato que usa el 3D — antes
// era una capa aparte que solo afectaba el dibujo del canvas, por eso los
// cambios no se veían al volver a 3D.
let selectedTarget = 'rightEye'

// ✅ NUEVO: ajuste de iris/pupila — a diferencia de ojo/ceja/mandíbula,
// este vive SOLO AQUÍ (mode2d.js), nunca en eyes.js/pupils.js, y por lo
// tanto NUNCA toca el 3D — solo afecta el dibujo en la vista frontal del
// modo 2D. Cada uno se ajusta por separado (iris y pupila no se mueven
// juntos), pivoteando sobre su propio centro.
const PUPIL_TARGET_KEYS = ['rightIris', 'leftIris', 'rightPupil', 'leftPupil']
let pupilAdjust2D = {
    rightIris:  { x: 0, y: 0, scale: 1, rotationDeg: 0 },
    leftIris:   { x: 0, y: 0, scale: 1, rotationDeg: 0 },
    rightPupil: { x: 0, y: 0, scale: 1, rotationDeg: 0 },
    leftPupil:  { x: 0, y: 0, scale: 1, rotationDeg: 0 }
}

function applyPupilAdjust2D(points, adjust){
    if(!points || points.length === 0) return points
    let sx = 0, sy = 0
    points.forEach(p => { sx += p.x; sy += p.y })
    const cx = sx / points.length
    const cy = sy / points.length

    return points.map(p => ({
        x: cx + (p.x - cx) * adjust.scale + adjust.x,
        y: cy + (p.y - cy) * adjust.scale + adjust.y
    }))
}

// ✅ NUEVO: modo de vista — 'front' (como hasta ahora) o 'profile' (perfil:
// proyecta Z/Y en vez de X/Y, de la forma actualmente seleccionada en
// "Ajuste fino por forma"). Sirve para calibrar profundidad contra una
// referencia de perfil, ya que de frente esa dimensión no se ve.
let viewMode = 'front'
export function setViewMode(mode){
    viewMode = (mode === 'profile') ? 'profile' : 'front'
    drawFrame()
}

function resizeCanvas(){
    if(!canvas) return
    const parent = canvas.parentElement
    if(!parent) return
    canvas.width = parent.clientWidth
    canvas.height = parent.clientHeight
}

// ✅ NUEVO: proyección para vista de PERFIL — usa Z (profundidad) como eje
// horizontal de pantalla en vez de X, y Y se mantiene como vertical.
function projectProfile(pt, centerX, centerY, pxPerUnit, stretchZ, stretchY){
    return {
        x: centerX + pt.z * pxPerUnit * stretchZ,
        y: centerY - pt.y * pxPerUnit * stretchY
    }
}

function project(pt, centerX, centerY, pxPerUnit, stretchX = 1, stretchY = 1){
    return {
        x: centerX + pt.x * pxPerUnit * stretchX,
        y: centerY - pt.y * pxPerUnit * stretchY // Y invertido: en canvas crece hacia abajo
    }
}

// ✅ NUEVO: cruz de referencia en el centro del maniquí (el mismo punto
// (centerX, centerY) usado para proyectar TODAS las guías) — sirve para
// cuadrar la imagen de referencia contra el eje central de la cabeza,
// sin tener que adivinar dónde cae ese "cero" a simple vista.
// ✅ NUEVO: círculo de referencia en radio=1 (el límite normalizado que
// usan eyeParams/browParams como "100% del radio de cabeza"). Sirve como
// ancla real para escalar la imagen — antes no había ningún punto de
// comparación concreto, así que la gente escalaba la GUÍA para que
// calzara con la imagen (sin efecto en 3D) en vez de escalar la IMAGEN
// para que calzara con este círculo (que sí tiene el tamaño correcto).
// ✅ ACTUALIZADO: ahora es una ELIPSE, no un círculo — usa el mismo
// estiramiento no uniforme (stretchX/stretchY) que aplica la guía 3D real
// (loomisScale × loomisStretch), así representa fielmente la forma
// calibrada, no una esfera idealizada que nunca existió en 3D.
function drawHeadReferenceCircle(cx, cy, pxPerUnit, stretchX, stretchY){
    if(!ctx) return
    ctx.beginPath()
    ctx.ellipse(cx, cy, pxPerUnit * stretchX, pxPerUnit * stretchY, 0, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffee00'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])
}

function drawCenterCross(cx, cy){
    if(!ctx) return
    const armLength = 16
    const gap = 4 // hueco chico en el medio, para que no tape el punto exacto

    ctx.strokeStyle = '#ff3333'
    ctx.lineWidth = 1.5

    ctx.beginPath()
    ctx.moveTo(cx - armLength, cy)
    ctx.lineTo(cx - gap, cy)
    ctx.moveTo(cx + gap, cy)
    ctx.lineTo(cx + armLength, cy)
    ctx.moveTo(cx, cy - armLength)
    ctx.lineTo(cx, cy - gap)
    ctx.moveTo(cx, cy + gap)
    ctx.lineTo(cx, cy + armLength)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(cx, cy, 2, 0, Math.PI * 2)
    ctx.fillStyle = '#ff3333'
    ctx.fill()
}

function drawOutline(points, color){
    if(!ctx || !points || points.length === 0) return
    ctx.beginPath()
    points.forEach((p, i) => {
        if(i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()
}

// ✅ NUEVO: igual que drawOutline pero SIN cerrar el lazo — para segmentos
// abiertos como los de la mandíbula (pómulo→barbilla, sien, puente), que
// no son formas cerradas como el ojo o la ceja.
function drawLine(points, color){
    if(!ctx || !points || points.length === 0) return
    ctx.beginPath()
    points.forEach((p, i) => {
        if(i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()
}

// ✅ NUEVO: pequeño indicador vertical (para el globo ocular en perfil) —
// una línea vertical del alto del iris, en su posición Z real, más un
// punto en el centro para marcar dónde está exactamente.
function drawVerticalTick(pt, centerX, centerY, pxPerUnit, stretchZ, stretchY, color){
    if(!ctx) return
    const top = projectProfile({ z: pt.z, y: pt.y + pt.radius }, centerX, centerY, pxPerUnit, stretchZ, stretchY)
    const bottom = projectProfile({ z: pt.z, y: pt.y - pt.radius }, centerX, centerY, pxPerUnit, stretchZ, stretchY)
    const mid = projectProfile({ z: pt.z, y: pt.y }, centerX, centerY, pxPerUnit, stretchZ, stretchY)

    ctx.beginPath()
    ctx.moveTo(top.x, top.y)
    ctx.lineTo(bottom.x, bottom.y)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(mid.x, mid.y, 3, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
}

function drawFrame(){
    if(!ctx || !canvas) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // --- transform de la GUÍA: siempre FIJO y centrado en el canvas — no
    // depende de refScale/refOffset. La guía es el "molde" contra el que
    // se calibra; lo que se mueve/escala es la imagen, nunca la guía. ---
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const pxPerUnit = Math.min(canvas.width, canvas.height) * 0.45

    // --- transform de la IMAGEN: independiente, controlado por
    // refScale/refOffsetX/refOffsetY — así se puede centrar/escalar la
    // referencia SIN mover ojos, cejas ni mandíbula. ---
    const ref = currentRef()
    const refImage = ref.image
    const refScale = ref.scale
    const refOffsetX = ref.offsetX
    const refOffsetY = ref.offsetY
    if(refImage){
        const imgAspect = refImage.width / refImage.height
        let baseDrawW, baseDrawH
        const canvasAspect = canvas.width / canvas.height
        if(imgAspect > canvasAspect){
            baseDrawW = canvas.width * 0.9
            baseDrawH = baseDrawW / imgAspect
        } else {
            baseDrawH = canvas.height * 0.9
            baseDrawW = baseDrawH * imgAspect
        }
        const drawW = baseDrawW * refScale
        const drawH = baseDrawH * refScale

        const imgCenterX = canvas.width / 2 + refOffsetX * canvas.width * 0.5
        const imgCenterY = canvas.height / 2 + refOffsetY * canvas.height * 0.5
        const imgX = imgCenterX - drawW / 2
        const imgY = imgCenterY - drawH / 2

        ctx.globalAlpha = 0.9
        ctx.drawImage(refImage, imgX, imgY, drawW, drawH)
        ctx.globalAlpha = 1
    } else {
        // sin imagen todavía — aviso simple para no dejar el canvas vacío sin explicación
        ctx.fillStyle = '#888'
        ctx.font = '16px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Carga una imagen de referencia para calibrar', canvas.width / 2, canvas.height / 2)
    }

    // --- silueta de ojos/cejas/mandíbula. En vista FRONTAL se dibujan
    // todas (X/Y, como hasta ahora). En vista de PERFIL solo se dibuja la
    // forma actualmente seleccionada en "Ajuste fino por forma" — no tiene
    // sentido superponer ambos ojos en un perfil — proyectada con Z/Y, así
    // se puede calibrar la profundidad contra una referencia de perfil. ---
    const { stretchX, stretchY, stretchZ } = getLoomisTransform2D()

    if(viewMode === 'front'){
        if(layerVisibility.headCircle){
            drawHeadReferenceCircle(centerX, centerY, pxPerUnit, stretchX, stretchY)
        }

        // ✅ el ajuste por forma ya viene incluido en estas siluetas (se aplica
        // dentro de eyes.js/eyebrows.js). El ojo ahora son DOS trazos
        // abiertos independientes (párpado superior + inferior), no un
        // lazo cerrado, así que se dibujan con drawLine, no drawOutline.
        if(layerVisibility.eye){
            const eyeOutlines = getEyeOutlines2D()
            drawLine(eyeOutlines.right.upper.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#00ffcc')
            drawLine(eyeOutlines.right.lower.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#00ffcc')
            drawLine(eyeOutlines.left.upper.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#00ffcc')
            drawLine(eyeOutlines.left.lower.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#00ffcc')
        }

        if(layerVisibility.brows){
            const browOutlines = getBrowOutlines2D()
            drawOutline(browOutlines.right.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffaa00')
            drawOutline(browOutlines.left.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffaa00')
        }

        // pestañas — encima del ojo
        if(layerVisibility.lashes){
            const lashOutlines = getEyelashOutlines2D()
            drawOutline(lashOutlines.right.upper.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ff2222')
            drawOutline(lashOutlines.right.lower.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ff2222')
            drawOutline(lashOutlines.left.upper.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ff2222')
            drawOutline(lashOutlines.left.lower.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ff2222')
        }

        // párpados — el pliegue por encima del ojo (trazo abierto, no lazo)
        if(layerVisibility.lids){
            const lidOutlines = getEyelidOutlines2D()
            drawLine(lidOutlines.right.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffcc66')
            drawLine(lidOutlines.left.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffcc66')
        }

        // iris y pupila — cada uno con su propio ajuste 2D-only (no toca el 3D)
        if(layerVisibility.pupils){
            const pupilOutlines = getPupilOutlines2D()
            drawOutline(applyPupilAdjust2D(pupilOutlines.rightIris, pupilAdjust2D.rightIris).map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#8888ff')
            drawOutline(applyPupilAdjust2D(pupilOutlines.leftIris, pupilAdjust2D.leftIris).map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#8888ff')
            drawOutline(applyPupilAdjust2D(pupilOutlines.rightPupil, pupilAdjust2D.rightPupil).map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#000000')
            drawOutline(applyPupilAdjust2D(pupilOutlines.leftPupil, pupilAdjust2D.leftPupil).map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#000000')
        }

        // mandíbula — 7 segmentos abiertos (no lazos cerrados), mismo
        // color rosa que usa la guía 3D para que sea reconocible de un vistazo.
        if(layerVisibility.jaw){
            const jawOutlines = getJawOutlines2D()
            const jawColor = '#ff66cc'
            const templeColor = '#66ccff'
            const bridgeColor = '#cccccc'

            drawLine(jawOutlines.leftJaw.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), jawColor)
            drawLine(jawOutlines.rightJaw.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), jawColor)
            drawLine(jawOutlines.chin.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), jawColor)
            drawLine(jawOutlines.mouth.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffffff')
            drawLine(jawOutlines.leftTemple.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), templeColor)
            drawLine(jawOutlines.rightTemple.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), templeColor)
            drawLine(jawOutlines.bridge.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), bridgeColor)
        }
    } else {
        // --- vista de PERFIL: círculo de referencia con Z/Y (el "ancho"
        // de perfil es la profundidad real de la cabeza, no stretchX) ---
        if(layerVisibility.headCircle){
            drawHeadReferenceCircle(centerX, centerY, pxPerUnit, stretchZ, stretchY)
        }

        const t = resolveTarget(selectedTarget)

        if(t.kind === 'eye'){
            if(layerVisibility.eye){
                const eo = getEyeOutlines2D()
                drawLine(openLid(eo[t.side].upper, profileEyeOpen.upper).map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#00ffcc')
                drawLine(openLid(eo[t.side].lower, -profileEyeOpen.lower).map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#00ffcc')
            }

            if(layerVisibility.lashes){
                const lo = getEyelashOutlines2D()
                const lashUp = shiftProfile(openLid(lo[t.side].upper, profileLashAdjust.open), profileLashAdjust.depth, 0)
                const lashLo = shiftProfile(openLid(lo[t.side].lower, -profileLashAdjust.open), profileLashAdjust.depth, 0)
                drawOutline(lashUp.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ff2222')
                drawOutline(lashLo.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ff2222')

                // punta del canto + racimo irregular del lagrimal
                const eyeUpper = shiftProfile(getEyeOutlines2D()[t.side].upper, profileLashAdjust.depth, 0)
                buildProfileLashExtras(eyeUpper).forEach(stroke => {
                    drawLine(stroke.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ff2222')
                })
            }

            if(layerVisibility.lids){
                const lid = getEyelidOutlines2D()
                drawLine(lid[t.side].map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ffcc66')
            }

            if(layerVisibility.pupils){
                // ✅ el iris de perfil era una marca vertical (una línea),
                // que no admitía ancho. Ahora es una ELIPSE con radios
                // independientes, así se puede ensanchar en horizontal
                // (profundidad) y en vertical por separado.
                const m = getPupilProfileMark(t.side)
                const cz = m.z + profilePupilAdjust.depth
                const cy = m.y + profilePupilAdjust.height
                const rz = m.radius * profilePupilAdjust.sizeH
                const ry = m.radius * profilePupilAdjust.sizeV

                const buildEllipse = (ez, ey, erz, ery) => {
                    const pts = []
                    for(let s = 0; s <= 32; s++){
                        const a = (s / 32) * Math.PI * 2
                        pts.push({ x: 0, z: ez + Math.cos(a) * erz, y: ey + Math.sin(a) * ery })
                    }
                    return pts
                }

                // iris
                drawOutline(buildEllipse(cz, cy, rz, ry).map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#8888ff')

                // pupila, dentro del iris — su tamaño es relativo al radio
                // del iris, así sigue proporcionada al reescalarlo
                const pz2 = cz + profileInnerPupil.depth
                const py2 = cy + profileInnerPupil.height
                const prz = m.radius * profileInnerPupil.sizeH
                const pry = m.radius * profileInnerPupil.sizeV
                drawOutline(buildEllipse(pz2, py2, prz, pry).map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#000000')
            }
        } else if(t.kind === 'brow'){
            if(layerVisibility.brows){
                const bo = getBrowOutlines2D()
                drawOutline(bo[t.side].map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ffaa00')
            }
        } else {
            if(layerVisibility.jaw){
                const jo = getJawOutlines2D()
                const jawColor = '#ff66cc'
                const templeColor = '#66ccff'
                drawLine(jo.leftJaw.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), jawColor)
                drawLine(jo.rightJaw.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), jawColor)
                drawLine(jo.chin.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), jawColor)
                drawLine(jo.mouth.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ffffff')
                drawLine(jo.leftTemple.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), templeColor)
                drawLine(jo.rightTemple.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), templeColor)
                drawLine(jo.bridge.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#cccccc')
            }
        }
    }

    // ✅ NUEVO: cruz de referencia, dibujada al final para que quede
    // siempre encima de todo (imagen y guías) y sea fácil de ubicar.
    drawCenterCross(centerX, centerY)
}

function loop(){
    drawFrame()
    rafId = requestAnimationFrame(loop)
}

function startLoop(){
    resizeCanvas()
    if(!rafId) loop()
}

function stopLoop(){
    if(rafId){
        cancelAnimationFrame(rafId)
        rafId = null
    }
}

// ✅ llamar una vez al iniciar la UI (desde ui.js), para enganchar el
// canvas y el listener de resize.
export function initMode2D(){
    canvas = document.getElementById('mode2DCanvas')
    viewerEl = document.getElementById('viewer')
    if(!canvas) return

    ctx = canvas.getContext('2d')

    window.addEventListener('resize', () => {
        if(active){
            resizeCanvas()
            drawFrame()
        }
    })
}

// ✅ conectar al checkbox "Activar modo 2D" — alterna entre el visor 3D
// (Three.js) y este canvas plano, ocupando el mismo espacio.
export function setMode2DActive(isActive){
    active = isActive

    if(canvas) canvas.style.display = isActive ? 'block' : 'none'
    if(viewerEl) viewerEl.style.display = isActive ? 'none' : 'block'

    if(isActive) startLoop()
    else stopLoop()
}

export function isMode2DActive(){
    return active
}

// ✅ conectar al <input type="file"> de imagen de referencia
export function setRefImage(file){
    if(!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
            const r = currentRef()
            r.image = img
            // se conserva el dataURL para poder incrustar la imagen en la
            // preconfiguración: el navegador no puede leer rutas del disco,
            // así que guardar un nombre de archivo no permitiría recargarla.
            r.dataURL = e.target.result
            r.name = file.name || null
            drawFrame()
        }
        img.src = e.target.result
    }
    reader.readAsDataURL(file)
}

// ✅ conectar a los sliders de escala/posición del overlay
// Desplaza un párpado en Y para "abrir" el ojo en perfil. El
// desplazamiento es máximo en el centro del trazo y nulo en los
// extremos, para que el lagrimal y el canto sigan cerrando.
function openLid(points, amount){
    if(!amount) return points
    const n = points.length
    if(n < 2) return points
    return points.map((p, i) => {
        const t = i / (n - 1)
        const bump = Math.sin(Math.PI * t) // 0 en extremos, 1 en el centro
        return { x: p.x, y: p.y + amount * bump, z: p.z }
    })
}

// aleatoriedad estable: misma semilla = mismo patrón en cada redibujado
function lashRand(seed, i){
    const x = Math.sin(seed * 91.7 + i * 47.3) * 43758.5453
    return x - Math.floor(x)
}

// Construye la PUNTA del canto y el RACIMO del lagrimal, en coordenadas
// de perfil (se trabaja sobre z/y, que es lo que proyecta esta vista).
// upperPts viene de eyes.js: índice 0 = lagrimal (nariz), último = canto (oreja).
function buildProfileLashExtras(upperPts){
    const n = upperPts.length
    const strokes = []
    if(n < 3) return strokes

    // centro del trazo, para saber hacia dónde es "afuera"
    let cz = 0, cy = 0
    for(const p of upperPts){ cz += (p.z ?? 0); cy += p.y }
    cz /= n; cy /= n

    // normal exterior en el punto i, dentro del plano (z, y)
    const normalAt = (i) => {
        const a = upperPts[Math.max(i - 1, 0)]
        const b = upperPts[Math.min(i + 1, n - 1)]
        let tz = (b.z ?? 0) - (a.z ?? 0)
        let ty = b.y - a.y
        const len = Math.hypot(tz, ty) || 1
        tz /= len; ty /= len
        let nz = -ty, ny = tz
        const p = upperPts[i]
        if(nz * ((p.z ?? 0) - cz) + ny * (p.y - cy) < 0){ nz = -nz; ny = -ny }
        return { nz, ny, tz, ty }
    }

    const rot = (vz, vy, deg) => {
        const r = deg * Math.PI / 180
        return { z: vz * Math.cos(r) - vy * Math.sin(r), y: vz * Math.sin(r) + vy * Math.cos(r) }
    }

    // ✅ Constructor compartido: GARRA. No es un triángulo combado — su
    // EJE es una curva, y el grosor se afina a lo largo de ese eje hasta
    // cerrar en punta. Eso es lo que produce la forma de gancho/garra en
    // vez de una hoja. Lo usan la punta del canto y cada púa del racimo.
    //
    //   curve : cuánto se arquea el eje (0 = recto)
    //   hook  : 0 = afinado parejo (hoja)   1 = borde exterior más lleno
    //           y el interior más excavado (garra)
    const triangleSpike = (oz, oy, dz, dy, nz, ny, length, width, curve, hook = 0) => {
        const SEG = 14
        const bend = curve * length

        // eje curvo: bezier cuadrática desde el origen hasta la punta
        const p0z = oz, p0y = oy
        const p2z = oz + dz * length, p2y = oy + dy * length
        const c1z = (p0z + p2z) / 2 + nz * bend
        const c1y = (p0y + p2y) / 2 + ny * bend

        const spine = []
        for(let s = 0; s <= SEG; s++){
            const t = s / SEG, mt = 1 - t
            spine.push({
                z: mt * mt * p0z + 2 * mt * t * c1z + t * t * p2z,
                y: mt * mt * p0y + 2 * mt * t * c1y + t * t * p2y,
                t
            })
        }

        // grosor a lo largo del eje: máximo en la base, cero en la punta.
        // El exponente hace que la garra conserve carne cerca de la base y
        // se afile de golpe al final, como una uña.
        const half = width / 2
        const outer = [], inner = []
        for(let s = 0; s <= SEG; s++){
            const p = spine[s]
            const a = spine[Math.max(s - 1, 0)]
            const b = spine[Math.min(s + 1, SEG)]
            let tz = b.z - a.z, ty = b.y - a.y
            const L = Math.hypot(tz, ty) || 1
            tz /= L; ty /= L
            const pz = -ty, py = tz

            const taper = Math.pow(1 - p.t, 1.6)
            const wOut = half * taper * (1 + 0.6 * hook)
            const wIn  = half * taper * (1 - 0.75 * hook)

            outer.push({ x: 0, z: p.z + pz * wOut, y: p.y + py * wOut })
            inner.push({ x: 0, z: p.z - pz * wIn,  y: p.y - py * wIn })
        }

        // contorno cerrado: un borde de la base a la punta, y el otro de
        // vuelta a la base
        return [...outer, ...inner.reverse(), outer[0]]
    }

    // --- 1) PUNTA del canto (último punto) ---
    if(profileLashTip.length > 0){
        const i = n - 1
        const p = upperPts[i]
        const { tz, ty, nz, ny } = normalAt(i)
        const d = rot(tz, ty, profileLashTip.angleDeg)
        strokes.push(triangleSpike(
            p.z ?? 0, p.y, d.z, d.y, nz, ny,
            profileLashTip.length, profileLashTip.width, profileLashTip.curve
        ))
    }

    // --- 3) RACIMO irregular, del lado del lagrimal (índices bajos) ---
    const count = Math.round(profileLashCluster.count)
    if(count > 0){
        const extent = Math.max(0.05, Math.min(profileLashCluster.extent, 0.95))
        // ✅ el racimo no vive fijo junto al lagrimal: `offset` lo desliza
        // a lo largo del párpado. 0 = pegado al lagrimal, 1 = pegado al
        // canto. El tramo se recorta para no salirse del trazo.
        const offset = Math.max(0, Math.min(profileLashCluster.offset, 1)) * (1 - extent)
        for(let k = 0; k < count; k++){
            const f = count === 1 ? 0.5 : k / (count - 1)
            const pos = offset + f * extent
            const i = Math.max(1, Math.min(n - 2, Math.round(pos * (n - 1))))
            const p = upperPts[i]
            const { nz, ny, tz: tz0, ty: ty0 } = normalAt(i)

            // irregularidad: cada púa varía su largo y su ángulo
            const r1 = lashRand(profileLashCluster.seed, k)
            const r2 = lashRand(profileLashCluster.seed + 7.13, k)
            const lenMult = 1 + (r1 - 0.5) * 2 * profileLashCluster.spread
            const angJit = (r2 - 0.5) * 2 * profileLashCluster.spread * 45

            // ✅ las púas crecen HACIA ARRIBA (hacia la ceja), no hacia la
            // boca: si la normal del párpado apunta hacia abajo en este
            // punto, se invierte antes de rotarla con el ángulo del slider.
            let bz = nz, by = ny
            if(by < 0){ bz = -bz; by = -by }

            const d = rot(bz, by, profileLashCluster.angleDeg + angJit)
            const L = profileLashCluster.length * Math.max(lenMult, 0.15)

            // ✅ `lift` despega TODO el racimo del párpado, siguiendo esa
            // misma normal: positivo lo aleja hacia la ceja, negativo lo
            // hunde hacia el ojo. Es un desplazamiento del conjunto, no
            // de cada púa por separado.
            // ✅ y `shift` lo desplaza a lo largo del párpado, en la
            // dirección de la tangente: positivo hacia la NARIZ (lagrimal),
            // negativo hacia la oreja. A diferencia de `deslizar`, que
            // reubica cada púa sobre otro punto de la curva, este traslada
            // el conjunto sin cambiar de dónde nace cada una.
            const tanNoseZ = -tz0, tanNoseY = -ty0

            const oz = (p.z ?? 0) + bz * profileLashCluster.lift + tanNoseZ * profileLashCluster.shift
            const oy = p.y + by * profileLashCluster.lift + tanNoseY * profileLashCluster.shift

            // la base de cada púa es perpendicular a SU propia dirección,
            // no a la del párpado, para que el triángulo no salga torcido
            const pz = -d.y, py = d.z
            strokes.push(triangleSpike(
                oz, oy, d.z, d.y, pz, py,
                L, profileLashCluster.width, profileLashCluster.curve,
                profileLashCluster.hook
            ))
        }
    }

    return strokes
}

// Desplaza un trazo en Z (profundidad) y/o Y, solo para la vista de perfil
function shiftProfile(points, dz, dy){
    if(!dz && !dy) return points
    return points.map(p => ({ x: p.x, y: p.y + (dy || 0), z: (p.z ?? 0) + (dz || 0) }))
}

export function setProfileLashTipLength(value){ profileLashTip.length = value; drawFrame() }
export function setProfileLashTipAngle(value){ profileLashTip.angleDeg = value; drawFrame() }
export function setProfileLashTipWidth(value){ profileLashTip.width = value; drawFrame() }
export function setProfileLashTipCurve(value){ profileLashTip.curve = value; drawFrame() }
export function setProfileLashClusterCount(value){ profileLashCluster.count = value; drawFrame() }
export function setProfileLashClusterLength(value){ profileLashCluster.length = value; drawFrame() }
export function setProfileLashClusterSpread(value){ profileLashCluster.spread = value; drawFrame() }
export function setProfileLashClusterAngle(value){ profileLashCluster.angleDeg = value; drawFrame() }
export function setProfileLashClusterExtent(value){ profileLashCluster.extent = value; drawFrame() }
export function setProfileLashClusterOffset(value){ profileLashCluster.offset = value; drawFrame() }
export function setProfileLashClusterWidth(value){ profileLashCluster.width = value; drawFrame() }
export function setProfileLashClusterCurve(value){ profileLashCluster.curve = value; drawFrame() }
export function setProfileLashClusterHook(value){ profileLashCluster.hook = value; drawFrame() }
export function setProfileLashClusterLift(value){ profileLashCluster.lift = value; drawFrame() }
export function setProfileLashClusterShift(value){ profileLashCluster.shift = value; drawFrame() }
export function setProfileLashClusterSeed(value){ profileLashCluster.seed = value; drawFrame() }

export function setProfileLashDepth(value){ profileLashAdjust.depth = value; drawFrame() }
export function setProfileLashOpen(value){ profileLashAdjust.open = value; drawFrame() }
export function setProfilePupilDepth(value){ profilePupilAdjust.depth = value; drawFrame() }
export function setProfilePupilHeight(value){ profilePupilAdjust.height = value; drawFrame() }
export function setProfilePupilSizeH(value){ profilePupilAdjust.sizeH = value; drawFrame() }
export function setProfilePupilSizeV(value){ profilePupilAdjust.sizeV = value; drawFrame() }
export function setProfileInnerPupilSizeH(value){ profileInnerPupil.sizeH = value; drawFrame() }
export function setProfileInnerPupilSizeV(value){ profileInnerPupil.sizeV = value; drawFrame() }
export function setProfileInnerPupilDepth(value){ profileInnerPupil.depth = value; drawFrame() }
export function setProfileInnerPupilHeight(value){ profileInnerPupil.height = value; drawFrame() }

export function setProfileEyeUpperOpen(value){ profileEyeOpen.upper = value; drawFrame() }
export function setProfileEyeLowerOpen(value){ profileEyeOpen.lower = value; drawFrame() }

export function setLayerVisible(layer, visible){
    if(layer in layerVisibility){
        layerVisibility[layer] = !!visible
        drawFrame()
    }
}

export function setRefScale(value){ currentRef().scale = value; drawFrame() }
export function setRefOffsetX(value){ currentRef().offsetX = value; drawFrame() }
export function setRefOffsetY(value){ currentRef().offsetY = value; drawFrame() }

// ✅ para que el panel pueda mostrar los valores de la vista activa al
// cambiar de vista (cada una tiene su propio encuadre)
// ✅ encuadre de AMBAS vistas, para guardarlo en las preconfiguraciones
// (las imágenes no se guardan: son archivos que el usuario vuelve a cargar)
export function getAllRefSettings(includeImages){
    const dump = (r) => {
        const out = { scale: r.scale, offsetX: r.offsetX, offsetY: r.offsetY, name: r.name }
        if(includeImages && r.dataURL) out.dataURL = r.dataURL
        return out
    }
    return { front: dump(refs.front), profile: dump(refs.profile) }
}

// ✅ restaura una imagen incrustada en la preconfiguración
export function setRefImageData(view, dataURL, name){
    const r = refs[view]
    if(!r || !dataURL) return
    const img = new Image()
    img.onload = () => {
        r.image = img
        r.dataURL = dataURL
        r.name = name || null
        drawFrame()
    }
    img.src = dataURL
}

export function setRefSettingsFor(view, settings){
    const r = refs[view]
    if(!r || !settings) return
    if(typeof settings.scale === 'number') r.scale = settings.scale
    if(typeof settings.offsetX === 'number') r.offsetX = settings.offsetX
    if(typeof settings.offsetY === 'number') r.offsetY = settings.offsetY
    drawFrame()
}

export function getRefSettings(){
    const r = currentRef()
    return { scale: r.scale, offsetX: r.offsetX, offsetY: r.offsetY, hasImage: !!r.image, name: r.name }
}

// ✅ conectar al selector "Ajustar forma" — cambia cuál de las 4 formas
// afectan los sliders de ajuste fino.
export function setSelectedTarget(key){
    selectedTarget = key
}

// mapea cada clave del selector al módulo (eyes.js / eyebrows.js / viewer.js)
// y lado ('right'/'left', o ninguno para la mandíbula, que es un solo
// ajuste simétrico) que realmente guarda ese ajuste.
function resolveTarget(key){
    switch(key){
        case 'rightEye':  return { kind: 'eye', side: 'right' }
        case 'leftEye':   return { kind: 'eye', side: 'left' }
        case 'rightBrow': return { kind: 'brow', side: 'right' }
        case 'leftBrow':  return { kind: 'brow', side: 'left' }
        case 'jaw':       return { kind: 'jaw' }
        default:          return { kind: 'eye', side: 'right' }
    }
}

// ✅ para que ui.js pueda leer los valores actuales al cambiar de
// objetivo, y así sincronizar la posición de los sliders sin disparar
// un cambio real. Lee directo de eyes.js/eyebrows.js/viewer.js — no hay
// copia local (salvo iris/pupila, que sí vive aquí — ver PUPIL_TARGET_KEYS).
export function getTargetAdjust(key){
    if(PUPIL_TARGET_KEYS.includes(key)) return pupilAdjust2D[key]
    const t = resolveTarget(key)
    if(t.kind === 'eye') return getEyeShapeAdjust(t.side)
    if(t.kind === 'brow') return getBrowShapeAdjust(t.side)
    return getJawShapeAdjust()
}

// ✅ conectar a los 4 sliders de ajuste fino — todos operan sobre el
// objetivo actualmente seleccionado. Para ojo/ceja/mandíbula escriben
// DIRECTO en eyes.js/eyebrows.js/viewer.js (también usado por el 3D).
// Para iris/pupila escriben en pupilAdjust2D (solo aquí, solo 2D frontal).
export function setTargetOffsetX(value){
    if(PUPIL_TARGET_KEYS.includes(selectedTarget)){ pupilAdjust2D[selectedTarget].x = value; drawFrame(); return }
    const t = resolveTarget(selectedTarget)
    if(t.kind === 'eye') setEyeShapeOffsetX(t.side, value)
    else if(t.kind === 'brow') setBrowShapeOffsetX(t.side, value)
    else setJawShapeOffsetX(value)
    drawFrame()
}

export function setTargetOffsetY(value){
    if(PUPIL_TARGET_KEYS.includes(selectedTarget)){ pupilAdjust2D[selectedTarget].y = value; drawFrame(); return }
    const t = resolveTarget(selectedTarget)
    if(t.kind === 'eye') setEyeShapeOffsetY(t.side, value)
    else if(t.kind === 'brow') setBrowShapeOffsetY(t.side, value)
    else setJawShapeOffsetY(value)
    drawFrame()
}

export function setTargetScale(value){
    if(PUPIL_TARGET_KEYS.includes(selectedTarget)){ pupilAdjust2D[selectedTarget].scale = value; drawFrame(); return }
    const t = resolveTarget(selectedTarget)
    if(t.kind === 'eye') setEyeShapeScale(t.side, value)
    else if(t.kind === 'brow') setBrowShapeScale(t.side, value)
    else setJawShapeScale(value)
    drawFrame()
}

export function setTargetRotation(degrees){
    // la rotación no cambia visualmente un círculo — se guarda por
    // consistencia con el resto del panel, pero no tiene efecto.
    if(PUPIL_TARGET_KEYS.includes(selectedTarget)){ pupilAdjust2D[selectedTarget].rotationDeg = degrees; drawFrame(); return }
    const t = resolveTarget(selectedTarget)
    if(t.kind === 'eye') setEyeShapeRotation(t.side, degrees)
    else if(t.kind === 'brow') setBrowShapeRotation(t.side, degrees)
    else setJawShapeRotation(degrees)
    drawFrame()
}
