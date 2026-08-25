import * as THREE from 'three'

// ✅ NUEVO: guías de ojos — archivo aparte de viewer.js, pensado como
// calibrador contra referencia (no como "canon" fijo de proporción anime).
// El dibujante trae su propio dibujo, ajusta estos parámetros hasta que
// las formas coincidan con SU referencia, y de ahí en adelante el maniquí
// se puede posar libremente con los ojos ya calibrados en su lugar —
// porque cuelgan del mismo loomisGroup que ya sigue el hueso de la cabeza.

// ⚠️ Valores iniciales estimados a ojo desde la vista frontal de IMG_3395
// (chica de cabello blanco, retrato central). Son un punto de partida, no
// una medición exacta — se recalibran en vivo con los sliders una vez
// conectados en el index.
let eyeParams = {
    widthMult: 0.40,      // ancho de cada ojo, como fracción del radio de la esfera craneal
    heightRatio: 0.55,    // alto del ojo, como fracción de SU PROPIO ancho
    gapMult: 1.0,         // separación entre ojos (borde interno a borde interno), en anchos de ojo
    tiltDeg: 8,           // inclinación — positivo = esquina externa hacia arriba
    vertOffsetMult: 0.06  // desplazamiento vertical bajo la línea de ojos, fracción del radio
}

// ✅ mismo truco que las líneas de superficie en viewer.js: un empuje
// radial pequeño para que los ojos no queden hundidos en la malla real por
// z-fighting cuando "respetar oclusión" está activo.
const EYE_SURFACE_OFFSET = 1.02

let eyesGroup = null
let rightEyeLine = null
let leftEyeLine = null
let rightEyeMat = null
let leftEyeMat = null
let currentBaseRadius = 0

// Genera el contorno de un ojo tipo almendra: dos medias elipses de distinta
// amplitud (párpado superior más curvo que el inferior) unidas en dos
// esquinas — sin necesidad de definir puntos de control a mano.
function buildEyeOutlinePoints(width, height, tiltRad){
    const segs = 32
    const points = []
    const upperAmp = height * 0.65 // párpado superior: curva más pronunciada
    const lowerAmp = height * 0.35 // párpado inferior: más plano

    const cosT = Math.cos(tiltRad)
    const sinT = Math.sin(tiltRad)

    for(let i = 0; i <= segs; i++){
        const t = (i / segs) * Math.PI * 2
        const x = Math.cos(t) * (width / 2)
        const amp = Math.sin(t) >= 0 ? upperAmp : lowerAmp
        const y = Math.sin(t) * amp

        // rotación 2D simple para la inclinación, antes de ubicar en 3D
        const xr = x * cosT - y * sinT
        const yr = x * sinT + y * cosT

        points.push(new THREE.Vector3(xr, yr, 0))
    }

    return points
}

function computeEyeLayout(baseRadius){
    const width = baseRadius * eyeParams.widthMult
    const height = width * eyeParams.heightRatio
    const gap = width * eyeParams.gapMult
    const centerX = gap / 2 + width / 2
    const eyeY = -baseRadius * eyeParams.vertOffsetMult
    return { width, height, centerX, eyeY }
}

// aproxima la profundidad Z para que el ojo quede "pegado" a la curvatura
// de la esfera craneal en su posición X/Y, igual que hacen las demás
// líneas de superficie (cejas, ojos, perfil) en viewer.js
function computeEyeZ(baseRadius, x, y){
    const surfaceR = baseRadius * EYE_SURFACE_OFFSET
    return Math.sqrt(Math.max(surfaceR * surfaceR - x * x - y * y, 0.0001))
}

function buildEyes(baseRadius){
    if(!eyesGroup || !baseRadius) return

    // limpia las líneas anteriores antes de reconstruir con los nuevos parámetros
    while(eyesGroup.children.length){
        eyesGroup.remove(eyesGroup.children[0])
    }

    const { width, height, centerX, eyeY } = computeEyeLayout(baseRadius)
    const tiltRad = THREE.MathUtils.degToRad(eyeParams.tiltDeg)

    rightEyeMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: true, depthWrite: false })
    const rightPts = buildEyeOutlinePoints(width, height, tiltRad) // esquina externa en +x local → tilt positivo la sube
    rightEyeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), rightEyeMat)
    rightEyeLine.position.set(centerX, eyeY, computeEyeZ(baseRadius, centerX, eyeY))
    rightEyeLine.renderOrder = 999
    eyesGroup.add(rightEyeLine)

    leftEyeMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: true, depthWrite: false })
    const leftPts = buildEyeOutlinePoints(width, height, -tiltRad) // esquina externa en -x local → tilt negativo la sube
    leftEyeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), leftEyeMat)
    leftEyeLine.position.set(-centerX, eyeY, computeEyeZ(baseRadius, -centerX, eyeY))
    leftEyeLine.renderOrder = 999
    eyesGroup.add(leftEyeLine)
}

// ✅ llamar desde viewer.js, dentro/después de createLoomisGuide, pasando
// el loomisGroup (para que los ojos hereden posición/rotación de la cabeza
// automáticamente) y el loomisBaseRadius ya calculado.
export function createEyeGuides(loomisGroup, loomisBaseRadius){
    removeEyeGuides()
    if(!loomisGroup || !loomisBaseRadius) return

    currentBaseRadius = loomisBaseRadius
    eyesGroup = new THREE.Group()
    loomisGroup.add(eyesGroup)

    buildEyes(currentBaseRadius)
}

export function removeEyeGuides(){
    if(eyesGroup && eyesGroup.parent) eyesGroup.parent.remove(eyesGroup)
    eyesGroup = null
    rightEyeLine = null
    leftEyeLine = null
    rightEyeMat = null
    leftEyeMat = null
}

function rebuild(){
    if(currentBaseRadius) buildEyes(currentBaseRadius)
}

// ✅ setters — mismo patrón que setEarRadius/setJawWidth en viewer.js,
// pensados para conectarse a sliders del index.
export function setEyeWidth(mult){ eyeParams.widthMult = mult; rebuild() }
export function setEyeHeightRatio(mult){ eyeParams.heightRatio = mult; rebuild() }
export function setEyeGap(mult){ eyeParams.gapMult = mult; rebuild() }
export function setEyeTilt(degrees){ eyeParams.tiltDeg = degrees; rebuild() }
export function setEyeVerticalOffset(mult){ eyeParams.vertOffsetMult = mult; rebuild() }

// ✅ para conectar con el toggle "respetar oclusión" existente en
// viewer.js — llamar setEyeOcclusion(respectOcclusion) junto con
// setLoomisRespectOcclusion, ya que los materiales de ojos viven en este
// archivo y no están dentro del array loomisMaterials de viewer.js.
export function setEyeOcclusion(respectOcclusion){
    ;[rightEyeMat, leftEyeMat].forEach(mat => {
        if(!mat) return
        mat.depthTest = respectOcclusion
        mat.depthWrite = false
        mat.needsUpdate = true
    })
}
