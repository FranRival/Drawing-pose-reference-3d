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

let refImage = null
let refScale = 1.55
let refOffsetX = 0.07 // -1 a 1, fracción del ancho del canvas
let refOffsetY = 0.12 // -1 a 1, fracción del alto del canvas

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
        drawHeadReferenceCircle(centerX, centerY, pxPerUnit, stretchX, stretchY)

        const eyeOutlines = getEyeOutlines2D()
        const browOutlines = getBrowOutlines2D()

        // ✅ el ajuste por forma ya viene incluido en estas siluetas (se aplica
        // dentro de eyes.js/eyebrows.js). El ojo ahora son DOS trazos
        // abiertos independientes (párpado superior + inferior), no un
        // lazo cerrado, así que se dibujan con drawLine, no drawOutline.
        drawLine(eyeOutlines.right.upper.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#00ffcc')
        drawLine(eyeOutlines.right.lower.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#00ffcc')
        drawLine(eyeOutlines.left.upper.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#00ffcc')
        drawLine(eyeOutlines.left.lower.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#00ffcc')
        drawOutline(browOutlines.right.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffaa00')
        drawOutline(browOutlines.left.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffaa00')

        // pestañas — encima del ojo, mismo tono oscuro que en 3D
        const lashOutlines = getEyelashOutlines2D()
        drawOutline(lashOutlines.right.upper.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ff2222')
        drawOutline(lashOutlines.right.lower.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ff2222')
        drawOutline(lashOutlines.left.upper.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ff2222')
        drawOutline(lashOutlines.left.lower.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ff2222')

        // párpados — el pliegue por encima del ojo (trazo abierto, no lazo)
        const lidOutlines = getEyelidOutlines2D()
        drawLine(lidOutlines.right.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffcc66')
        drawLine(lidOutlines.left.map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#ffcc66')

        // iris y pupila — cada uno con su propio ajuste 2D-only (no toca el 3D)
        const pupilOutlines = getPupilOutlines2D()
        drawOutline(applyPupilAdjust2D(pupilOutlines.rightIris, pupilAdjust2D.rightIris).map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#8888ff')
        drawOutline(applyPupilAdjust2D(pupilOutlines.leftIris, pupilAdjust2D.leftIris).map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#8888ff')
        drawOutline(applyPupilAdjust2D(pupilOutlines.rightPupil, pupilAdjust2D.rightPupil).map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#000000')
        drawOutline(applyPupilAdjust2D(pupilOutlines.leftPupil, pupilAdjust2D.leftPupil).map(p => project(p, centerX, centerY, pxPerUnit, stretchX, stretchY)), '#000000')

        // mandíbula — 7 segmentos abiertos (no lazos cerrados), mismo
        // color rosa que usa la guía 3D para que sea reconocible de un vistazo.
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
    } else {
        // --- vista de PERFIL: círculo de referencia con Z/Y (el "ancho"
        // de perfil es la profundidad real de la cabeza, no stretchX) ---
        drawHeadReferenceCircle(centerX, centerY, pxPerUnit, stretchZ, stretchY)

        const t = resolveTarget(selectedTarget)

        if(t.kind === 'eye'){
            const eo = getEyeOutlines2D()
            drawLine(eo[t.side].upper.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#00ffcc')
            drawLine(eo[t.side].lower.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#00ffcc')

            const lo = getEyelashOutlines2D()
            drawOutline(lo[t.side].upper.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ff2222')
            drawOutline(lo[t.side].lower.map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ff2222')

            const lid = getEyelidOutlines2D()
            drawLine(lid[t.side].map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ffcc66')

            const pupilMark = getPupilProfileMark(t.side)
            drawVerticalTick(pupilMark, centerX, centerY, pxPerUnit, stretchZ, stretchY, '#8888ff')
        } else if(t.kind === 'brow'){
            const bo = getBrowOutlines2D()
            drawOutline(bo[t.side].map(p => projectProfile(p, centerX, centerY, pxPerUnit, stretchZ, stretchY)), '#ffaa00')
        } else {
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
            refImage = img
            drawFrame()
        }
        img.src = e.target.result
    }
    reader.readAsDataURL(file)
}

// ✅ conectar a los sliders de escala/posición del overlay
export function setRefScale(value){ refScale = value; drawFrame() }
export function setRefOffsetX(value){ refOffsetX = value; drawFrame() }
export function setRefOffsetY(value){ refOffsetY = value; drawFrame() }

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
