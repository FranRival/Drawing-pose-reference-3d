import { model, camera, renderer, scene, sunGizmo, setSunAngles, setHelpersVisible } from './core.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

export let bones = {}
export let jointGizmos = []

// ✅ NUEVO: overlay de malla (wireframe) — se genera una vez cargado el modelo
let originalMeshes = []
let wireframeMeshes = []

// Crea, para cada SkinnedMesh del modelo, una copia con material wireframe
// que sigue exactamente la misma deformación de huesos (bind al mismo esqueleto).
// Se agrega apagada (visible=false) hasta que el usuario active algún modo con malla.
export function createWireframeOverlay(){
    // limpia overlays previos por si se recarga el modelo
    wireframeMeshes.forEach(m => { if(m.parent) m.parent.remove(m) })
    wireframeMeshes = []
    originalMeshes = []

    if(!model) return

    model.traverse(obj => {
        if(!obj.isSkinnedMesh) return

        originalMeshes.push(obj)

        const wireMat = new THREE.MeshBasicMaterial({
            wireframe: true,
            color: 0x00ff88,
            transparent: true,
            opacity: 0.5,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        })

        const wireMesh = new THREE.SkinnedMesh(obj.geometry, wireMat)
        wireMesh.bind(obj.skeleton, obj.bindMatrix)
        wireMesh.position.copy(obj.position)
        wireMesh.rotation.copy(obj.rotation)
        wireMesh.scale.copy(obj.scale)
        wireMesh.castShadow = false
        wireMesh.receiveShadow = false
        wireMesh.visible = false

        if(obj.parent) obj.parent.add(wireMesh)
        wireframeMeshes.push(wireMesh)
    })
}

// mode: 'solid' | 'solidWireframe' | 'wireframeOnly'
export function setMeshDisplayMode(mode){
    originalMeshes.forEach(m => { m.visible = mode !== 'wireframeOnly' })
    wireframeMeshes.forEach(m => { m.visible = (mode === 'solidWireframe' || mode === 'wireframeOnly') })
}

// ✅ NUEVO: guía tipo Loomis (esfera craneal + cilindro de cuello +
// línea central + línea de ojos). Se cuelga directamente del hueso de la
// cabeza (Object3D normal, sin skinning) — al ser hija del bone, hereda su
// rotación/posición cada frame automáticamente, sin lógica extra.
// ⚠️ Punto de partida: el offset vertical del cráneo respecto al bone y el
// radio son aproximados, van a necesitar ajuste fino una vez vistos en vivo.
let loomisGroup = null

function loomisCirclePoints(radius, yOffset, orientation){
    const points = []
    const segs = 48

    if(orientation === 'vertical'){
        for(let i = 0; i <= segs; i++){
            const t = (i / segs) * Math.PI * 2
            points.push(new THREE.Vector3(0, Math.sin(t) * radius, Math.cos(t) * radius))
        }
    } else {
        const rAtY = Math.sqrt(Math.max(radius * radius - yOffset * yOffset, 0.0001))
        for(let i = 0; i <= segs; i++){
            const t = (i / segs) * Math.PI * 2
            points.push(new THREE.Vector3(Math.sin(t) * rAtY, yOffset, Math.cos(t) * rAtY))
        }
    }

    return points
}

export function createLoomisGuide(radius){
    if(loomisGroup && loomisGroup.parent) loomisGroup.parent.remove(loomisGroup)
    loomisGroup = null

    const headBone = bones.head || bones.neck
    if(!headBone || !radius) return

    // ✅ el radio llega en unidades del MUNDO, pero la geometría que colgamos
    // del hueso se dibuja en su espacio LOCAL. Si el esqueleto tiene una
    // escala acumulada distinta de 1 (común en exports de Blender/Mixamo),
    // un radio "correcto" en mundo puede salir gigante o microscópico en
    // local — lo compensamos dividiendo por la escala mundial del hueso.
    const worldScale = new THREE.Vector3()
    headBone.getWorldScale(worldScale)
    const avgScale = (worldScale.x + worldScale.y + worldScale.z) / 3 || 1
    const localRadius = radius / avgScale

    console.log("Loomis guide → headBone:", headBone.name, "| escala mundial del hueso:", avgScale, "| radio mundo:", radius, "| radio local usado:", localRadius)

    loomisGroup = new THREE.Group()
    loomisGroup.visible = false
    // offset aproximado: el bone de la cabeza suele estar en la base del
    // cráneo/cuello, así que subimos el centro de la esfera un poco
    loomisGroup.position.set(0, localRadius * 0.7, 0)

    // esfera craneal
    const sphereGeo = new THREE.SphereGeometry(localRadius, 16, 12)
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6, depthTest: false })
    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat)
    sphereMesh.renderOrder = 999 // fuerza a dibujarse encima, incluso con depthTest desactivado
    loomisGroup.add(sphereMesh)

    // cilindro de cuello (guía, no es el hueso real del cuello)
    const neckHeight = localRadius * 1.1
    const neckGeo = new THREE.CylinderGeometry(localRadius * 0.42, localRadius * 0.5, neckHeight, 12, 1, true)
    const neckMat = new THREE.MeshBasicMaterial({ color: 0x3355ff, wireframe: true, transparent: true, opacity: 0.6, depthTest: false })
    const neckMesh = new THREE.Mesh(neckGeo, neckMat)
    neckMesh.position.set(0, -localRadius - neckHeight * 0.4, 0)
    neckMesh.renderOrder = 999
    loomisGroup.add(neckMesh)

    // línea central (vertical, va de la barbilla a la nuca pasando por la coronilla)
    const centerMat = new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false })
    const centerLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(loomisCirclePoints(localRadius, 0, 'vertical')),
        centerMat
    )
    centerLine.renderOrder = 999
    loomisGroup.add(centerLine)

    // línea de ojos/cejas (horizontal, envuelve la cabeza a la altura de los ojos)
    const eyeMat = new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false })
    const eyeLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(loomisCirclePoints(localRadius, localRadius * 0.05, 'horizontal')),
        eyeMat
    )
    eyeLine.renderOrder = 999
    loomisGroup.add(eyeLine)

    headBone.add(loomisGroup)
}

export function setLoomisGuideVisible(visible){
    if(loomisGroup) loomisGroup.visible = visible
}

let keyframes = []
let currentTime = 0

let ikRestPose = {}  // guarda quaternions iniciales de la cadena

//animacion
let isPlaying = false
let playTime = 0
let duration = 2 // segundos entre keyframes

let _needsUpdate = true
export function markNeedsUpdate(){ _needsUpdate = true }
export function consumeNeedsUpdate(){
    const v = _needsUpdate
    _needsUpdate = false
    return v
}

let timelineElement = null
let isScrubbing = false

// ✅ NUEVO: callback opcional para refrescar la UI cuando cambian los keyframes
export let onKeyframesChange = null
export function setOnKeyframesChange(fn){ onKeyframesChange = fn }


let ikMode = true // true = IK activo, false = FK (rotación normal)
let axisLock = ['x','y','z'] // ejes activos

const mirrorMap = {

    leftArm: "rightArm",
    rightArm: "leftArm",

    leftForeArm: "rightForeArm",
    rightForeArm: "leftForeArm",

    leftHand: "rightHand",
    rightHand: "leftHand",

    leftUpLeg: "rightUpLeg",
    rightUpLeg: "leftUpLeg",

    leftLeg: "rightLeg",
    rightLeg: "leftLeg",

    leftFoot: "rightFoot",
    rightFoot: "leftFoot"

}

let selectedSun = false
let selectedBone = null
let boneHelper = null
let poleTarget = null
let poleActive = false
let selectedGizmo = null
let hoveredGizmo = null
let hoveredType = null
let localSunAzimuth = 0
let localSunElevation = 0
let ikTarget = null
let ikActive = false     // IK está "enganchado" a un hueso
let ikDragging = false   // usuario está arrastrando AHORA

const COLORS = {
    gizmo: 0x00ffff,
    hover: 0xffff00,
    selected: 0xff8800,
    ikActive: 0xff0000,
    ikTarget: 0xff00ff,
    ikTargetActive: 0xff5500,
    pole: 0x00ff00,
    poleActive: 0x00ffaa
}

const tempQuaternion = new THREE.Quaternion()
const tempAxis = new THREE.Vector3()

let dragPlane = new THREE.Plane()

const boneLimits = {
    neck:        { x:[-0.8,0.8],  y:[-0.8,0.8],  z:[-0.4,0.4] },
    leftArm:     { x:[-1.5,1.5],  y:[-1.5,1.5],  z:[-1.5,1.5] },
    rightArm:    { x:[-1.5,1.5],  y:[-1.5,1.5],  z:[-1.5,1.5] },
    leftForeArm: { x:[0,2.2] },
    rightForeArm:{ x:[0,2.2] },
    leftUpLeg:   { x:[-1.2,1.2],  y:[-1.2,1.2] },
    rightUpLeg:  { x:[-1.2,1.2],  y:[-1.2,1.2] },
    leftLeg:     { x:[0,2.4] },
    rightLeg:    { x:[0,2.4] }
}

const boneAxes = {
    neck:        ['x','y'],
    leftArm:     ['x','y','z'],
    rightArm:    ['x','y','z'],
    leftForeArm: ['x'],
    rightForeArm:['x'],
    leftUpLeg:   ['x','y'],
    rightUpLeg:  ['x','y'],
    leftLeg:     ['x'],
    rightLeg:    ['x']
}

/* ------------------------------------------------ */
/* BONE CONSTRAINTS                                  */
/* ------------------------------------------------ */
function applyBoneConstraints(bone){
    const entry = Object.entries(bones).find(([,b]) => b === bone)
    if(!entry) return
    const limits = boneLimits[entry[0]]
    if(!limits) return

    const euler = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ')
    if(limits.x) euler.x = THREE.MathUtils.clamp(euler.x, limits.x[0], limits.x[1])
    if(limits.y) euler.y = THREE.MathUtils.clamp(euler.y, limits.y[0], limits.y[1])
    if(limits.z) euler.z = THREE.MathUtils.clamp(euler.z, limits.z[0], limits.z[1])

    bone.quaternion.setFromEuler(euler) // directo, sin slerp para IK
}

function getBoneName(bone){
    const entry = Object.entries(bones).find(([,b]) => b === bone)
    return entry ? entry[0] : null
}

/* ------------------------------------------------ */
/* BONE DETECTION                                    */
/* ------------------------------------------------ */
export function inspectBones(){
    if(!model) return
    bones = {}

    model.traverse((obj)=>{
        if(!obj.isBone) return
        const name = obj.name.toLowerCase()

        if     (name.includes("head"))         bones.head = obj
        else if(name.includes("neck"))         bones.neck = obj
        else if(name.includes("spine"))        bones.spine = obj
        else if(name.includes("chest"))        bones.chest = obj
        else if(name.includes("hips"))         bones.hips = obj
        else if(name.includes("leftshoulder")) bones.leftShoulder = obj
        else if(name.includes("rightshoulder"))bones.rightShoulder = obj
        else if(name.includes("leftarm"))      bones.leftArm = obj
        else if(name.includes("rightarm"))     bones.rightArm = obj
        else if(name.includes("leftforearm"))  bones.leftForeArm = obj
        else if(name.includes("rightforearm")) bones.rightForeArm = obj
        else if(name.includes("lefthand"))     bones.leftHand = obj
        else if(name.includes("righthand"))    bones.rightHand = obj
        else if(name.includes("leftupleg"))    bones.leftUpLeg = obj
        else if(name.includes("rightupleg"))   bones.rightUpLeg = obj
        else if(name.includes("leftleg"))      bones.leftLeg = obj
        else if(name.includes("rightleg"))     bones.rightLeg = obj
        else if(name.includes("leftfoot"))     bones.leftFoot = obj
        else if(name.includes("rightfoot"))    bones.rightFoot = obj
    })

    console.log("Bones detectados:", Object.keys(bones))

    // ⚠️ DIAGNÓSTICO: verificar cadena IK
    console.log("leftArm:", bones.leftArm?.name)
    console.log("leftForeArm:", bones.leftForeArm?.name)
    console.log("leftHand:", bones.leftHand?.name)
    console.log("rightArm:", bones.rightArm?.name)
    console.log("rightForeArm:", bones.rightForeArm?.name)
    console.log("rightHand:", bones.rightHand?.name)

    Object.values(bones).forEach(bone => {

    bone.userData.initialQuaternion = bone.quaternion.clone()
    bone.userData.initialPosition   = bone.position.clone()

})
}

/* ------------------------------------------------ */
/* JOINT GIZMOS                                      */
/* ------------------------------------------------ */
export function createJointGizmos(){
    jointGizmos.forEach(g => scene.remove(g))
    jointGizmos = []

    Object.values(bones).forEach(bone=>{
        const geo = new THREE.SphereGeometry(0.06,12,12)
        const mat = new THREE.MeshBasicMaterial({ color:0x00ffff, depthTest:false })
        const gizmo = new THREE.Mesh(geo, mat)
        gizmo.userData.bone = bone
        scene.add(gizmo)
        jointGizmos.push(gizmo)
    })
}

export function updateJointGizmos(){
    jointGizmos.forEach(gizmo=>{
        const bone = gizmo.userData.bone
        if(!bone) return
        const pos = new THREE.Vector3()
        bone.getWorldPosition(pos)
        gizmo.position.copy(pos)
    })
}

// ✅ NUEVO: ocultar/mostrar las esferas de control (para exportar frames limpios)
export function setGizmosVisible(visible){
    jointGizmos.forEach(g => { g.visible = visible })
    if(boneHelper) boneHelper.visible = visible
    if(ikTarget) ikTarget.visible = visible
    if(poleTarget) poleTarget.visible = visible
}

// ✅ NUEVO: nivel de opacidad de las esferas de control (0 = casi invisibles,
// 1 = totalmente sólidas). A diferencia de setGizmosVisible, esto no las
// oculta para el raycasting — siguen siendo clicleables aunque estén tenues.
export function setGizmoOpacity(value){
    jointGizmos.forEach(g => {
        g.material.transparent = true
        g.material.opacity = value
    })
    if(boneHelper){
        boneHelper.material.transparent = true
        boneHelper.material.opacity = value
    }
    if(ikTarget){
        ikTarget.material.transparent = true
        ikTarget.material.opacity = value
    }
    if(poleTarget){
        poleTarget.material.transparent = true
        poleTarget.material.opacity = value
    }
}

/* ------------------------------------------------ */
/* IK / POLE TARGETS                                 */
/* ------------------------------------------------ */
function createIKTarget(){
    const geo = new THREE.SphereGeometry(0.08,16,16)
    const mat = new THREE.MeshBasicMaterial({ color:0xff00ff, depthTest:false })
    ikTarget = new THREE.Mesh(geo, mat)
    scene.add(ikTarget)
}

function createPoleTarget(){
    const geo = new THREE.SphereGeometry(0.07,16,16)
    const mat = new THREE.MeshBasicMaterial({ color:0x00ff00, depthTest:false })
    poleTarget = new THREE.Mesh(geo, mat)
    scene.add(poleTarget)
}

/* ------------------------------------------------ */
/* CCD IK SOLVER                                     */
/* ------------------------------------------------ */
/* ------------------------------------------------ */
/* SOLVER ANALÍTICO 2 HUESOS CON POLE VECTOR         */
/* ------------------------------------------------ */
function solveIK_TwoBone(chain, target, pole){

    const [arm, foreArm, hand] = chain

    // posiciones mundiales
    const pA = new THREE.Vector3(); arm.getWorldPosition(pA)        // hombro
    const pB = new THREE.Vector3(); foreArm.getWorldPosition(pB)    // codo
    const pC = new THREE.Vector3(); hand.getWorldPosition(pC)       // mano
    const pT = new THREE.Vector3(); target.getWorldPosition(pT)     // target (morado)
    const pP = new THREE.Vector3()                                   // pole (verde)
    if(pole) pole.getWorldPosition(pP)
    else pP.copy(pB) // si no hay pole, usar posición actual del codo

    // longitudes de los segmentos
    const lenA = pA.distanceTo(pB) // hombro → codo
    const lenB = pB.distanceTo(pC) // codo → mano

    // distancia al target (clampeada para no exceder el reach)
    const dirToTarget = new THREE.Vector3().subVectors(pT, pA)
    const dist = Math.min(dirToTarget.length(), lenA + lenB - 0.001)
    dirToTarget.normalize()

    // ángulo en el hombro (ley del coseno)
    const cosAngleA = THREE.MathUtils.clamp(
        (lenA*lenA + dist*dist - lenB*lenB) / (2 * lenA * dist),
        -1, 1
    )
    const angleA = Math.acos(cosAngleA)

    // ángulo en el codo (ley del coseno)
    const cosAngleB = THREE.MathUtils.clamp(
        (lenA*lenA + lenB*lenB - dist*dist) / (2 * lenA * lenB),
        -1, 1
    )
    const angleB = Math.PI - Math.acos(cosAngleB)

    /* --- plano IK usando el pole --- */
    // el pole define hacia dónde "dobla" el codo
    const poleDir = new THREE.Vector3().subVectors(pP, pA)

    // componente del pole perpendicular a la dirección al target
    const polePerp = poleDir.clone()
        .addScaledVector(dirToTarget, -poleDir.dot(dirToTarget))

    // si el pole es paralelo al target usamos el "up" como fallback
    if(polePerp.lengthSq() < 0.0001){
        polePerp.set(0, 1, 0)
            .addScaledVector(dirToTarget, -dirToTarget.y)
    }
    polePerp.normalize()

    // eje perpendicular al plano (para construir la rotación del codo)
    const perpAxis = new THREE.Vector3().crossVectors(dirToTarget, polePerp).normalize()

    /* --- posición del codo en el plano IK --- */
    const elbowDir = new THREE.Vector3()
        .addScaledVector(dirToTarget, Math.cos(angleA))
        .addScaledVector(polePerp,    Math.sin(angleA))
    elbowDir.normalize()

    const newElbowPos = new THREE.Vector3()
        .copy(pA)
        .addScaledVector(elbowDir, lenA)

    /* --- rotar el hombro (arm) --- */
    // dirección actual del hombro al codo en espacio mundial
    const currentArmDir = new THREE.Vector3().subVectors(pB, pA).normalize()
    // dirección deseada del hombro al codo
    const desiredArmDir = elbowDir.clone()

    const armRotAxis = new THREE.Vector3().crossVectors(currentArmDir, desiredArmDir)
    if(armRotAxis.lengthSq() > 0.0001){
        armRotAxis.normalize()
        const armAngle = Math.acos(THREE.MathUtils.clamp(currentArmDir.dot(desiredArmDir), -1, 1))

        // convertir al espacio local del hombro
        const armWorldQuat = new THREE.Quaternion()
        arm.getWorldQuaternion(armWorldQuat)
        const localAxis = armRotAxis.clone().applyQuaternion(armWorldQuat.clone().invert())

        const deltaQuat = new THREE.Quaternion().setFromAxisAngle(localAxis, armAngle)
        arm.quaternion.multiplyQuaternions(deltaQuat, arm.quaternion)
        arm.quaternion.normalize()
        applyBoneConstraints(arm)
        arm.updateMatrixWorld(true)
    }

    /* --- rotar el codo (foreArm) --- */
    // recalcular posición del codo tras mover el hombro
    const newPB = new THREE.Vector3(); foreArm.getWorldPosition(newPB)
    const newPC = new THREE.Vector3(); hand.getWorldPosition(newPC)

    const currentForeDir = new THREE.Vector3().subVectors(newPC, newPB).normalize()
    const desiredForeDir = new THREE.Vector3().subVectors(pT, newElbowPos).normalize()

    const foreRotAxis = new THREE.Vector3().crossVectors(currentForeDir, desiredForeDir)
    if(foreRotAxis.lengthSq() > 0.0001){
        foreRotAxis.normalize()
        const foreAngle = Math.acos(THREE.MathUtils.clamp(currentForeDir.dot(desiredForeDir), -1, 1))

        const foreWorldQuat = new THREE.Quaternion()
        foreArm.getWorldQuaternion(foreWorldQuat)
        const localAxis = foreRotAxis.clone().applyQuaternion(foreWorldQuat.clone().invert())

        const deltaQuat = new THREE.Quaternion().setFromAxisAngle(localAxis, foreAngle)
        foreArm.quaternion.multiplyQuaternions(deltaQuat, foreArm.quaternion)
        foreArm.quaternion.normalize()
        applyBoneConstraints(foreArm)
        foreArm.updateMatrixWorld(true)
    }
}



//
export function resetPose(){

    Object.values(bones).forEach(bone => {
        if(bone.userData.initialQuaternion)
            bone.quaternion.copy(bone.userData.initialQuaternion)
        if(bone.userData.initialPosition)
            bone.position.copy(bone.userData.initialPosition)
        bone.updateMatrixWorld(true)
    })

    ikActive   = false
    ikDragging = false
    poleActive = false
    selectedBone = null
    ikRestPose = {}  // ✅ limpiar rest pose

    if(ikTarget)   ikTarget.visible = false
    if(poleTarget) poleTarget.visible = false

    if(window.skinnedMeshes){
        window.skinnedMeshes.forEach(mesh => mesh.skeleton.update())
    }

    console.log("POSE RESET")
}



/* ------------------------------------------------ */
/* UPDATE IK                                         */
/* ------------------------------------------------ */
// En updateIK(), ANTES de llamar al solver:
export function updateIK(){

    if(!ikMode || !ikActive || !ikTarget) return
    if(!selectedBone) return

    const boneName = getBoneName(selectedBone)
    if(!boneName) return

    let chain = []
    if(boneName === "leftHand"){
        chain = [bones.leftArm, bones.leftForeArm, bones.leftHand]
    } else if(boneName === "rightHand"){
        chain = [bones.rightArm, bones.rightForeArm, bones.rightHand]
    }

    if(chain.length === 0 || chain.some(b => !b)) return

    chain.forEach(b => {
        if(ikRestPose[b.uuid]) b.quaternion.copy(ikRestPose[b.uuid])
    })

    chain.forEach(b => b.updateMatrixWorld(true))

    solveIK_TwoBone(chain, ikTarget, poleTarget)

    if(window.skinnedMeshes){
        window.skinnedMeshes.forEach(mesh => mesh.skeleton.update())
    }
}

/* ------------------------------------------------ */
/* BONE ROTATION (manual)                            */
/* ------------------------------------------------ */
export function rotateBone(name,x,y,z){
    if(!bones[name]) return
    bones[name].rotation.x = x
    bones[name].rotation.y = y
    bones[name].rotation.z = z
}

// ✅ NUEVO: ajusta un solo eje de un hueso sin tocar los otros dos
// (usado por los sliders de pose generados dinámicamente en ui.js)
export function setBoneAxis(name, axis, value){
    if(!bones[name]) return
    bones[name].rotation[axis] = value
    markNeedsUpdate()
}

/* ------------------------------------------------ */
/* BONE HELPER                                       */
/* ------------------------------------------------ */
function highlightBone(bone){
    if(selectedGizmo) selectedGizmo.material.color.set(COLORS.gizmo)

    selectedBone = bone
    selectedGizmo = null

    jointGizmos.forEach(gizmo => {
        if(gizmo.userData.bone === bone){
            gizmo.material.color.set(COLORS.selected)
            selectedGizmo = gizmo
        }
    })

    if(boneHelper) scene.remove(boneHelper)
    const geo = new THREE.SphereGeometry(0.05,16,16)
    const mat = new THREE.MeshBasicMaterial({ color:0xff0000 })
    boneHelper = new THREE.Mesh(geo, mat)
    scene.add(boneHelper)
}

export function updateBoneHelper(){
    if(!selectedBone || !boneHelper) return
    const pos = new THREE.Vector3()
    selectedBone.getWorldPosition(pos)
    boneHelper.position.copy(pos)
}

/* ------------------------------------------------ */
/* DRAG PLANE HELPER                                 */
/* ------------------------------------------------ */
function updateDragPlane(position){
    const normal = new THREE.Vector3()
    camera.getWorldDirection(normal)
    dragPlane.setFromNormalAndCoplanarPoint(normal, position)
}



//base de.animacion keyframe
export function addKeyframe(){

    const pose = JSON.parse(savePose())

    keyframes.push({
        time: keyframes.length, // 0,1,2,3...
        pose: pose
    })

    keyframes.sort((a,b)=>a.time - b.time)

    if(timelineElement){
    timelineElement.max = keyframes[keyframes.length - 1].time
}

    if(onKeyframesChange) onKeyframesChange()
}

// ✅ NUEVO: borrar todos los keyframes grabados
export function clearKeyframes(){
    keyframes = []
    currentTime = 0
    playTime = 0
    if(timelineElement){
        timelineElement.max = 1
        timelineElement.value = 0
    }
    if(onKeyframesChange) onKeyframesChange()
    console.log("KEYFRAMES BORRADOS")
}

export function getKeyframeCount(){
    return keyframes.length
}

// ✅ NUEVO: borra un keyframe puntual (por índice) y re-secuencia los tiempos
// de los que quedan para que sigan siendo 0,1,2...
export function deleteKeyframe(index){
    if(index < 0 || index >= keyframes.length) return

    keyframes.splice(index, 1)
    keyframes.forEach((kf, i) => { kf.time = i })

    currentTime = 0
    playTime = 0

    if(timelineElement){
        timelineElement.max = keyframes.length > 1 ? keyframes[keyframes.length - 1].time : 1
        timelineElement.value = 0
    }

    if(onKeyframesChange) onKeyframesChange()
}

// ✅ NUEVO: reordena un keyframe de una posición a otra (drag & drop de tarjetas)
// y re-secuencia los tiempos para que la interpolación siga el nuevo orden.
export function reorderKeyframes(fromIndex, toIndex){
    if(fromIndex < 0 || fromIndex >= keyframes.length) return
    if(toIndex < 0 || toIndex >= keyframes.length) return
    if(fromIndex === toIndex) return

    const [moved] = keyframes.splice(fromIndex, 1)
    keyframes.splice(toIndex, 0, moved)
    keyframes.forEach((kf, i) => { kf.time = i })

    currentTime = 0
    playTime = 0

    if(timelineElement){
        timelineElement.max = keyframes.length > 1 ? keyframes[keyframes.length - 1].time : 1
        timelineElement.value = 0
    }

    if(onKeyframesChange) onKeyframesChange()
}



export function goToKeyframe(index){

    const kf = keyframes[index]
    if(!kf) return

    loadPose(kf.pose)

    currentTime = kf.time

    console.log("JUMP TO KEYFRAME:", index)
}

export function setTime(t){
    currentTime = t
}

// ✅ NUEVO: play / pausa expuesto para la UI (además del atajo de teclado "p")
export function togglePlay(){
    isPlaying = !isPlaying
    if(isPlaying) playTime = currentTime
    return isPlaying
}

export function getIsPlaying(){
    return isPlaying
}


//int3rpolacion - animqcion suqve
export function interpolatePoses(poseA, poseB, t){

    Object.keys(poseA).forEach(name => {

        const bone = bones[name]
        if(!bone || !poseB[name]) return

        const qa = new THREE.Quaternion(
            ...poseA[name].q
        )

        const qb = new THREE.Quaternion(
            ...poseB[name].q
        )

        const qm = new THREE.Quaternion()

        // 🔥 interpolación real
        qm.slerpQuaternions(qa, qb, t)

        bone.quaternion.copy(qm)

        // posición opcional
        if(poseA[name].p && poseB[name].p){
            const pa = new THREE.Vector3(...poseA[name].p)
            const pb = new THREE.Vector3(...poseB[name].p)

            const pm = new THREE.Vector3().lerpVectors(pa, pb, t)
            bone.position.copy(pm)
        }

        bone.updateMatrixWorld(true)
    })

    if(window.skinnedMeshes){
        window.skinnedMeshes.forEach(mesh => mesh.skeleton.update())
    }
}


export function updateAnimation(delta){

    if(!isPlaying) return
    if(keyframes.length < 2) return

    playTime += delta

    const duration = keyframes[keyframes.length - 1].time
    // loop
    const time = playTime % duration


// 🔥 sincronizar UI
if(timelineElement && !isScrubbing){
    timelineElement.value = time
}


    let kfA = null
    let kfB = null

    for(let i = 0; i < keyframes.length - 1; i++){

        if(time >= keyframes[i].time && time <= keyframes[i+1].time){

            kfA = keyframes[i]
            kfB = keyframes[i+1]
            break
        }
    }

    if(!kfA || !kfB) return

    const segmentDuration = kfB.time - kfA.time

    const t = (time - kfA.time) / segmentDuration

    interpolatePoses(kfA.pose, kfB.pose, t)
}


//
export function updateAnimationAtTime(time){

    if(keyframes.length < 2) return

    let kfA = null
    let kfB = null

    for(let i = 0; i < keyframes.length - 1; i++){

        if(time >= keyframes[i].time && time <= keyframes[i+1].time){

            kfA = keyframes[i]
            kfB = keyframes[i+1]
            break
        }
    }

    if(!kfA || !kfB) return

    const segmentDuration = kfB.time - kfA.time
    const t = (time - kfA.time) / segmentDuration

    interpolatePoses(kfA.pose, kfB.pose, t)
}

export function exportAnimation(){

    const data = {
        keyframes: keyframes
    }

    const json = JSON.stringify(data, null, 2)

    const blob = new Blob([json], { type:"application/json" })
    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = "animation.json"
    a.click()

    URL.revokeObjectURL(url)
}

export function loadAnimation(json){

    try{
        const data = typeof json === "string" ? JSON.parse(json) : json

        keyframes = data.keyframes || []

        if(onKeyframesChange) onKeyframesChange()

        console.log("ANIMACIÓN CARGADA:", keyframes)

    }catch(e){
        console.error("Error cargando animación")
    }
}


/* ------------------------------------------------ */
/* EXPORTACIÓN DE IMÁGENES (FOLIOSCOPIO)             */
/* ------------------------------------------------ */

function captureFrameBlob(mime){
    return new Promise(resolve => {
        renderer.domElement.toBlob(resolve, mime, 0.92)
    })
}

async function downloadZip(zip, filename){
    const content = await zip.generateAsync({ type: "blob" })
    const url = URL.createObjectURL(content)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

// ✅ Exporta una secuencia interpolada completa (ej. 12 o 24 frames) entre
// el primer y el último keyframe, ideal para animar en folioscopio.
export async function exportFrameSequence(frameCount = 24, format = 'png'){

    if(keyframes.length < 2){
        alert("Necesitas al menos 2 keyframes grabados para exportar una secuencia.")
        return
    }
    if(typeof JSZip === 'undefined'){
        alert("No se pudo cargar JSZip (revisa tu conexión).")
        return
    }

    const wasPlaying = isPlaying
    isPlaying = false
    const savedPoseJson = savePose()
    const savedTime = currentTime

    setHelpersVisible(false)
    setGizmosVisible(false)

    const zip = new JSZip()
    const totalDuration = keyframes[keyframes.length - 1].time
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'

    for(let i = 0; i < frameCount; i++){
        const t = frameCount === 1 ? 0 : (i / (frameCount - 1)) * totalDuration
        updateAnimationAtTime(t)
        renderer.render(scene, camera)

        const blob = await captureFrameBlob(mime)
        zip.file(`frame_${String(i + 1).padStart(3, '0')}.${format}`, blob)
    }

    setHelpersVisible(true)
    setGizmosVisible(true)
    loadPose(savedPoseJson)
    currentTime = savedTime
    isPlaying = wasPlaying
    renderer.render(scene, camera)

    await downloadZip(zip, `secuencia_${frameCount}frames.zip`)
}

// ✅ Exporta solo los keyframes grabados (una imagen por cada uno)
export async function exportKeyframesOnly(format = 'png'){

    if(keyframes.length === 0){
        alert("No hay keyframes grabados todavía.")
        return
    }
    if(typeof JSZip === 'undefined'){
        alert("No se pudo cargar JSZip (revisa tu conexión).")
        return
    }

    const wasPlaying = isPlaying
    isPlaying = false
    const savedPoseJson = savePose()
    const savedTime = currentTime

    setHelpersVisible(false)
    setGizmosVisible(false)

    const zip = new JSZip()
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'

    for(let i = 0; i < keyframes.length; i++){
        loadPose(JSON.stringify(keyframes[i].pose))
        renderer.render(scene, camera)

        const blob = await captureFrameBlob(mime)
        zip.file(`keyframe_${String(i + 1).padStart(3, '0')}.${format}`, blob)
    }

    setHelpersVisible(true)
    setGizmosVisible(true)
    loadPose(savedPoseJson)
    currentTime = savedTime
    isPlaying = wasPlaying
    renderer.render(scene, camera)

    await downloadZip(zip, "keyframes.zip")
}




function updateHover(){

    raycaster.setFromCamera(mouse, camera)

    const hits = []

    if(ikTarget){
        const h = raycaster.intersectObject(ikTarget)
        if(h.length) hits.push({ type:"ik", object:ikTarget, dist:h[0].distance })
    }

    if(poleTarget){
        const h = raycaster.intersectObject(poleTarget)
        if(h.length) hits.push({ type:"pole", object:poleTarget, dist:h[0].distance })
    }

    const gizmoHits = raycaster.intersectObjects(jointGizmos)
    gizmoHits.forEach(h=>{
        hits.push({ type:"gizmo", object:h.object, dist:h.distance })
    })

    const priority = {
        ik:1,
        pole:2,
        gizmo:3
    }

    hits.sort((a,b)=>{
        if(priority[a.type] !== priority[b.type]){
            return priority[a.type] - priority[b.type]
        }
        return a.dist - b.dist
    })

    const hit = hits[0]

    // RESET anterior
    if(hoveredGizmo){
        hoveredGizmo.material.color.set(0x00ffff)
        hoveredGizmo = null
        hoveredType = null
    }

    if(!hit) return

    hoveredType = hit.type

    if(hit.type === "gizmo"){
        hoveredGizmo = hit.object

        if(hoveredGizmo !== selectedGizmo){
    	hoveredGizmo.material.color.set(COLORS.hover)
		}
    }

    if(hit.type === "ik"){
        ikTarget.material.color.set(0xffaa00)
    }

    if(hit.type === "pole"){
        poleTarget.material.color.set(0x00ffaa)
    }
}



//gurdar pose
export function savePose(){

    const pose = {}

    Object.entries(bones).forEach(([name, bone]) => {

        pose[name] = {
            q: [
                bone.quaternion.x,
                bone.quaternion.y,
                bone.quaternion.z,
                bone.quaternion.w
            ],
            p: [
                bone.position.x,
                bone.position.y,
                bone.position.z
            ]
        }

    })

    const json = JSON.stringify(pose, null, 2)

    console.log("POSE:", json)

    return json
}


export function loadPose(json){

    let pose = null

    try{
        pose = typeof json === "string" ? JSON.parse(json) : json
    }catch(e){
        console.error("JSON inválido")
        return
    }

    Object.entries(pose).forEach(([name, data]) => {

        const bone = bones[name]
        if(!bone) return

        if(data.q){
            bone.quaternion.set(
                data.q[0],
                data.q[1],
                data.q[2],
                data.q[3]
            )
        }

        if(data.p){
            bone.position.set(
                data.p[0],
                data.p[1],
                data.p[2]
            )
        }

        bone.updateMatrixWorld(true)

    })

    if(window.skinnedMeshes){
        window.skinnedMeshes.forEach(mesh => mesh.skeleton.update())
    }

    console.log("POSE LOADED")
}


export function downloadPose(){

    const json = savePose()

    const blob = new Blob([json], { type:"application/json" })
    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = "pose.json"
    a.click()

    URL.revokeObjectURL(url)
}


export function loadPoseFromFile(file){

    const reader = new FileReader()

    reader.onload = (e)=>{
        loadPose(e.target.result)
    }

    reader.readAsText(file)
}




//funcion MIRROR
export function mirrorPose(direction = "LtoR"){

    Object.entries(mirrorMap).forEach(([a, b]) => {

        let from = a
        let to   = b

        if(direction === "RtoL"){
            from = b
            to   = a
        }

        const boneA = bones[from]
        const boneB = bones[to]

        if(!boneA || !boneB) return

        const q = boneA.quaternion

        const mirrored = new THREE.Quaternion(
            -q.x,
             q.y,
             q.z,
            -q.w
        )

        boneB.quaternion.copy(mirrored)
        boneB.updateMatrixWorld(true)

    })

    if(window.skinnedMeshes){
        window.skinnedMeshes.forEach(mesh => mesh.skeleton.update())
    }
}




//


/* ------------------------------------------------ */
/* RAYCASTING                                        */
/* ------------------------------------------------ */
export function initRaycasting(){

    console.log("Raycasting activado")
    timelineElement = document.getElementById("timeline")
    if(timelineElement){

        timelineElement.addEventListener("input",(e)=>{

            const t = parseFloat(e.target.value)

            isScrubbing = true
            updateAnimationAtTime(t)

        })

        timelineElement.addEventListener("change",()=>{
            isScrubbing = false
        })

    }


    // ✅ keydown AQUÍ, una sola vez, fuera del pointerdown
    window.addEventListener("keydown",(e)=>{
        const key = e.key.toLowerCase()

        if(key === "i"){
            ikMode = !ikMode
            console.log("IK MODE:", ikMode ? "ON" : "OFF")
            if(!ikMode){
                ikActive   = false
                ikDragging = false
                poleActive = false
            }
        }

        if(key === "r") resetPose()  // ✅ aquí, una sola vez
        if(key === "s") savePose()
        if(key === "m") mirrorPose("LtoR")
        if(key === "n") mirrorPose("RtoL")
        if(key === "k") addKeyframe()
        if(key === "1") goToKeyframe(0)
        if(key === "2") goToKeyframe(1)
        if(key === "e") exportAnimation()

        if(key === "l") {
            const json = prompt("Pega tu JSON")
            if(json) loadPose(json)
        }
        if(key === "p"){
        	togglePlay()
        	console.log("PLAY:", isPlaying)
        }


        if(key === "x"){ axisLock = ['x']; console.log("Axis: X") }
        if(key === "y"){ axisLock = ['y']; console.log("Axis: Y") }
        if(key === "z"){ axisLock = ['z']; console.log("Axis: Z") }
        if(key === "a"){ axisLock = ['x','y','z']; console.log("Axis: ALL") }
    })

    /* ---- POINTER DOWN ---- */
    renderer.domElement.addEventListener("pointerdown",(event)=>{

        if(ikTarget)   ikTarget.material.color.set(COLORS.ikTarget)
        if(poleTarget) poleTarget.material.color.set(COLORS.pole)

        const rect = renderer.domElement.getBoundingClientRect()
        mouse.x = ((event.clientX - rect.left) / rect.width)  * 2 - 1
        mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1

        raycaster.setFromCamera(mouse, camera)
        if(model) model.updateMatrixWorld(true)

        selectedSun  = false
        poleActive   = false
        ikDragging   = false

        const hits = []

        if(sunGizmo){
            const h = raycaster.intersectObject(sunGizmo)
            if(h.length) hits.push({ type:"sun", object:sunGizmo, dist:h[0].distance })
        }

        if(ikTarget){
            const h = raycaster.intersectObject(ikTarget)
            if(h.length) hits.push({ type:"ik", object:ikTarget, dist:h[0].distance })
        }

        if(poleTarget){
            const h = raycaster.intersectObject(poleTarget)
            if(h.length) hits.push({ type:"pole", object:poleTarget, dist:h[0].distance })
        }

        const gizmoHits = raycaster.intersectObjects(jointGizmos)
        gizmoHits.forEach(h=>{
            hits.push({ type:"gizmo", object:h.object, dist:h.distance })
        })

        const meshHits = raycaster.intersectObject(model, true)
        meshHits.forEach(h=>{
            if(h.object.isSkinnedMesh){
                hits.push({ type:"mesh", object:h.object, hit:h, dist:h.distance })
            }
        })

        const priority = { ik:1, pole:2, gizmo:3, mesh:4, sun:5 }

        hits.sort((a,b)=>{
            if(priority[a.type] !== priority[b.type])
                return priority[a.type] - priority[b.type]
            return a.dist - b.dist
        })



        //codigo que no va aqui





        const hit = hits[0]
        if(!hit) return

        switch(hit.type){

            case "sun":
                selectedSun = true
                return

            case "ik":
                ikDragging = true
                updateDragPlane(ikTarget.position)
                return

            case "pole":
                poleActive = true
                updateDragPlane(poleTarget.position)
                return

            case "gizmo":{
                const bone = hit.object.userData.bone
                if(!bone) return

                highlightBone(bone)
                selectedBone = bone

                const boneName = getBoneName(bone)

                if(ikMode && (boneName === "leftHand" || boneName === "rightHand")){

                    if(!ikTarget)   createIKTarget()
                    if(!poleTarget) createPoleTarget()

                    const pos = new THREE.Vector3()
                    bone.getWorldPosition(pos)

                    ikTarget.position.copy(pos)
                    poleTarget.position.copy(pos).add(new THREE.Vector3(0,0.4,0.3))


                     // 🔥 GUARDAR POSE DE REPOSO
                    const chainBones = boneName === "leftHand"
                        ? [bones.leftArm, bones.leftForeArm, bones.leftHand]
                        : [bones.rightArm, bones.rightForeArm, bones.rightHand]

                    ikRestPose = {}
                    chainBones.forEach(b => {
                        if(b) ikRestPose[b.uuid] = b.quaternion.clone()
                    })

                    ikActive   = true
                    ikDragging = true

                    updateDragPlane(ikTarget.position)

                } else {
                    ikActive = false
                }
                return
            }

            case "mesh":{
                const meshHit = hit.hit
                const mesh      = hit.object
                const skinIndex = mesh.geometry.attributes.skinIndex

                if(skinIndex && meshHit.face){
                    const boneIndex    = skinIndex.getX(meshHit.face.a)
                    const detectedBone = mesh.skeleton.bones[boneIndex]

                    if(detectedBone){
                        highlightBone(detectedBone)
                        selectedBone = detectedBone
                        ikActive = false
                    }
                }
                return
            }
        }
    }) // cierra pointerdown

    /* ---- POINTER MOVE ---- */
    renderer.domElement.addEventListener("pointermove",(event)=>{

    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width)  * 2 - 1
    mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1

    raycaster.setFromCamera(mouse, camera)
    updateHover()

    if(poleActive && poleTarget){
        updateDragPlane(poleTarget.position)
        const pt = new THREE.Vector3()
        if(raycaster.ray.intersectPlane(dragPlane, pt))
            poleTarget.position.copy(pt)
        markNeedsUpdate()  // ← dentro del bloque, antes del return
        return
    }

    if(ikDragging && ikTarget){
        updateDragPlane(ikTarget.position)
        const pt = new THREE.Vector3()
        if(raycaster.ray.intersectPlane(dragPlane, pt))
            ikTarget.position.copy(pt)
        markNeedsUpdate()  // ← dentro del bloque, antes del return
        return
    }

    if(selectedSun){
        localSunAzimuth   += event.movementX * 0.01
        localSunElevation -= event.movementY * 0.01
        setSunAngles(localSunAzimuth, localSunElevation)
        return
    }

    if(!selectedBone || (ikMode && ikActive)) return

    const boneName = getBoneName(selectedBone)
    if(!boneName) return

    const allowedAxes = boneAxes[boneName] || ['x','y','z']
    const rotSpeed = 0.01

    if(allowedAxes.includes('y') && axisLock.includes('y')){
        tempAxis.set(0,1,0)
        tempQuaternion.setFromAxisAngle(tempAxis, event.movementX * rotSpeed)
        selectedBone.quaternion.multiplyQuaternions(tempQuaternion, selectedBone.quaternion)
    }

    if(allowedAxes.includes('x') && axisLock.includes('x')){
        tempAxis.set(1,0,0)
        tempQuaternion.setFromAxisAngle(tempAxis, event.movementY * rotSpeed)
        selectedBone.quaternion.multiplyQuaternions(tempQuaternion, selectedBone.quaternion)
    }

    if(allowedAxes.includes('z') && axisLock.includes('z')){
        tempAxis.set(0,0,1)
        tempQuaternion.setFromAxisAngle(tempAxis, event.movementX * rotSpeed)
        selectedBone.quaternion.multiplyQuaternions(tempQuaternion, selectedBone.quaternion)
    }

    applyBoneConstraints(selectedBone)
    markNeedsUpdate()  // ← al final de la rotación FK

}) // cierra pointermove

    /* ---- POINTER UP ---- */
    renderer.domElement.addEventListener("pointerup",()=>{
        selectedSun = false
        poleActive  = false
        ikDragging  = false
    }) // cierra pointerup

} // cierra initRaycasting
