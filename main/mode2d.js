import { getEyeOutlines2D, setEyeShapeOffsetX, setEyeShapeOffsetY, setEyeShapeScale, setEyeShapeRotation, getEyeShapeAdjust } from './eyes.js'
import { getBrowOutlines2D, setBrowShapeOffsetX, setBrowShapeOffsetY, setBrowShapeScale, setBrowShapeRotation, getBrowShapeAdjust } from './eyebrows.js'
import { getJawOutlines2D, setJawShapeOffsetX, setJawShapeOffsetY, setJawShapeScale, setJawShapeRotation, getJawShapeAdjust } from './viewer.js'

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
let refScale = 1
let refOffsetX = 0 // -1 a 1, fracción del ancho del canvas
let refOffsetY = 0 // -1 a 1, fracción del alto del canvas

// ✅ el ajuste por forma (offset/escala/rotación de cada ojo/ceja) YA NO
// vive aquí — vive en eyeShapeAdjust (eyes.js) y browShapeAdjust
// (eyebrows.js), aplicado dentro de buildEyePoints/buildBrowPoints. Así
// lo que se mueve en el modo 2D es el mismo dato que usa el 3D — antes
// era una capa aparte que solo afectaba el dibujo del canvas, por eso los
// cambios no se veían al volver a 3D.
let selectedTarget = 'rightEye'

function resizeCanvas(){
    if(!canvas) return
    const parent = canvas.parentElement
    if(!parent) return
    canvas.width = parent.clientWidth
    canvas.height = parent.clientHeight
}

function project(pt, centerX, centerY, pxPerUnit){
    return {
        x: centerX + pt.x * pxPerUnit,
        y: centerY - pt.y * pxPerUnit // Y invertido: en canvas crece hacia abajo
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
function drawHeadReferenceCircle(cx, cy, pxPerUnit){
    if(!ctx) return
    ctx.beginPath()
    ctx.arc(cx, cy, pxPerUnit, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
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

    // --- silueta de ojos y cejas, en las mismas unidades normalizadas que
    // usan eyes.js/eyebrows.js (radio de cabeza = 1) — con el transform
    // FIJO de la guía (centerX/centerY/pxPerUnit), no el de la imagen. ---
    drawHeadReferenceCircle(centerX, centerY, pxPerUnit)

    const eyeOutlines = getEyeOutlines2D()
    const browOutlines = getBrowOutlines2D()

    // ✅ el ajuste por forma ya viene incluido en estas siluetas (se aplica
    // dentro de eyes.js/eyebrows.js), así que se proyectan directo.
    drawOutline(eyeOutlines.right.map(p => project(p, centerX, centerY, pxPerUnit)), '#00ffcc')
    drawOutline(eyeOutlines.left.map(p => project(p, centerX, centerY, pxPerUnit)), '#00ffcc')
    drawOutline(browOutlines.right.map(p => project(p, centerX, centerY, pxPerUnit)), '#ffaa00')
    drawOutline(browOutlines.left.map(p => project(p, centerX, centerY, pxPerUnit)), '#ffaa00')

    // ✅ NUEVO: mandíbula — 7 segmentos abiertos (no lazos cerrados), mismo
    // color rosa que usa la guía 3D para que sea reconocible de un vistazo.
    const jawOutlines = getJawOutlines2D()
    const jawColor = '#ff66cc'
    const templeColor = '#66ccff'
    const bridgeColor = '#cccccc'

    drawLine(jawOutlines.leftJaw.map(p => project(p, centerX, centerY, pxPerUnit)), jawColor)
    drawLine(jawOutlines.rightJaw.map(p => project(p, centerX, centerY, pxPerUnit)), jawColor)
    drawLine(jawOutlines.chin.map(p => project(p, centerX, centerY, pxPerUnit)), jawColor)
    drawLine(jawOutlines.mouth.map(p => project(p, centerX, centerY, pxPerUnit)), '#ffffff')
    drawLine(jawOutlines.leftTemple.map(p => project(p, centerX, centerY, pxPerUnit)), templeColor)
    drawLine(jawOutlines.rightTemple.map(p => project(p, centerX, centerY, pxPerUnit)), templeColor)
    drawLine(jawOutlines.bridge.map(p => project(p, centerX, centerY, pxPerUnit)), bridgeColor)

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
// un cambio real. Lee directo de eyes.js/eyebrows.js/viewer.js — no hay copia local.
export function getTargetAdjust(key){
    const t = resolveTarget(key)
    if(t.kind === 'eye') return getEyeShapeAdjust(t.side)
    if(t.kind === 'brow') return getBrowShapeAdjust(t.side)
    return getJawShapeAdjust()
}

// ✅ conectar a los 4 sliders de ajuste fino — todos operan sobre el
// objetivo actualmente seleccionado, escribiendo DIRECTO en eyes.js,
// eyebrows.js o viewer.js (según corresponda), que es lo que también usa el 3D.
export function setTargetOffsetX(value){
    const t = resolveTarget(selectedTarget)
    if(t.kind === 'eye') setEyeShapeOffsetX(t.side, value)
    else if(t.kind === 'brow') setBrowShapeOffsetX(t.side, value)
    else setJawShapeOffsetX(value)
    drawFrame()
}

export function setTargetOffsetY(value){
    const t = resolveTarget(selectedTarget)
    if(t.kind === 'eye') setEyeShapeOffsetY(t.side, value)
    else if(t.kind === 'brow') setBrowShapeOffsetY(t.side, value)
    else setJawShapeOffsetY(value)
    drawFrame()
}

export function setTargetScale(value){
    const t = resolveTarget(selectedTarget)
    if(t.kind === 'eye') setEyeShapeScale(t.side, value)
    else if(t.kind === 'brow') setBrowShapeScale(t.side, value)
    else setJawShapeScale(value)
    drawFrame()
}

export function setTargetRotation(degrees){
    const t = resolveTarget(selectedTarget)
    if(t.kind === 'eye') setEyeShapeRotation(t.side, degrees)
    else if(t.kind === 'brow') setBrowShapeRotation(t.side, degrees)
    else setJawShapeRotation(degrees)
    drawFrame()
}
