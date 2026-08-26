import { getEyeOutlines2D } from './eyes.js'
import { getBrowOutlines2D } from './eyebrows.js'

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

// ✅ NUEVO: ajuste fino POR FORMA, exclusivo del modo 2D — no toca
// eyeParams/browParams (eyes.js/eyebrows.js), así el 3D queda intacto.
// Sirve para casos donde el dibujo de referencia no es perfectamente
// simétrico: cada ojo/ceja se puede mover, escalar y rotar por separado
// sobre la silueta ya calculada, tomando como pivote su propio ancla
// (el primer punto de su contorno — lagrimal para el ojo, cabeza para
// la ceja), igual que el resto del sistema usa anclas fijas.
let selectedTarget = 'rightEye'
const shapeAdjustments = {
    rightEye:  { x: 0, y: 0, scale: 1, rotationDeg: 0 },
    leftEye:   { x: 0, y: 0, scale: 1, rotationDeg: 0 },
    rightBrow: { x: 0, y: 0, scale: 1, rotationDeg: 0 },
    leftBrow:  { x: 0, y: 0, scale: 1, rotationDeg: 0 }
}

function applyShapeAdjust(points, adjust){
    if(!points || points.length === 0) return points
    const pivot = points[0] // el ancla de la forma (lagrimal / cabeza de ceja)
    const rad = adjust.rotationDeg * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    return points.map(p => {
        const dx = p.x - pivot.x
        const dy = p.y - pivot.y
        const rx = (dx * cos - dy * sin) * adjust.scale
        const ry = (dx * sin + dy * cos) * adjust.scale
        return {
            x: pivot.x + rx + adjust.x,
            y: pivot.y + ry + adjust.y
        }
    })
}

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

function drawFrame(){
    if(!ctx || !canvas) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // --- imagen de referencia, centrada y ajustada dentro del canvas ---
    if(refImage){
        const imgAspect = refImage.width / refImage.height
        const canvasAspect = canvas.width / canvas.height
        let drawW, drawH
        if(imgAspect > canvasAspect){
            drawW = canvas.width * 0.9
            drawH = drawW / imgAspect
        } else {
            drawH = canvas.height * 0.9
            drawW = drawH * imgAspect
        }
        const imgX = (canvas.width - drawW) / 2
        const imgY = (canvas.height - drawH) / 2
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
    // usan eyes.js/eyebrows.js (radio de cabeza = 1), escaladas y
    // centradas según los controles de posición/escala del modo 2D ---
    const centerX = canvas.width / 2 + refOffsetX * canvas.width * 0.5
    const centerY = canvas.height / 2 + refOffsetY * canvas.height * 0.5
    const pxPerUnit = Math.min(canvas.width, canvas.height) * 0.5 * refScale

    const eyeOutlines = getEyeOutlines2D()
    const browOutlines = getBrowOutlines2D()

    const rightEyeAdjusted = applyShapeAdjust(eyeOutlines.right, shapeAdjustments.rightEye)
    const leftEyeAdjusted = applyShapeAdjust(eyeOutlines.left, shapeAdjustments.leftEye)
    const rightBrowAdjusted = applyShapeAdjust(browOutlines.right, shapeAdjustments.rightBrow)
    const leftBrowAdjusted = applyShapeAdjust(browOutlines.left, shapeAdjustments.leftBrow)

    drawOutline(rightEyeAdjusted.map(p => project(p, centerX, centerY, pxPerUnit)), '#00ffcc')
    drawOutline(leftEyeAdjusted.map(p => project(p, centerX, centerY, pxPerUnit)), '#00ffcc')
    drawOutline(rightBrowAdjusted.map(p => project(p, centerX, centerY, pxPerUnit)), '#ffaa00')
    drawOutline(leftBrowAdjusted.map(p => project(p, centerX, centerY, pxPerUnit)), '#ffaa00')
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
// afectan los sliders de ajuste fino (no dispara redibujado por sí solo,
// solo cambia el objetivo).
export function setSelectedTarget(key){
    if(shapeAdjustments[key]) selectedTarget = key
}

// ✅ para que ui.js pueda leer los valores actuales al cambiar de
// objetivo, y así sincronizar la posición de los sliders sin disparar
// un cambio real.
export function getTargetAdjust(key){
    return shapeAdjustments[key] || shapeAdjustments.rightEye
}

// ✅ conectar a los 4 sliders de ajuste fino — todos operan sobre el
// objetivo actualmente seleccionado (setSelectedTarget).
export function setTargetOffsetX(value){ shapeAdjustments[selectedTarget].x = value; drawFrame() }
export function setTargetOffsetY(value){ shapeAdjustments[selectedTarget].y = value; drawFrame() }
export function setTargetScale(value){ shapeAdjustments[selectedTarget].scale = value; drawFrame() }
export function setTargetRotation(degrees){ shapeAdjustments[selectedTarget].rotationDeg = degrees; drawFrame() }
