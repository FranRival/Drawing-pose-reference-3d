import { model, camera, renderer, scene, sunGizmo, setSunAngles } from './core.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

export let bones = {}
export let jointGizmos = []

let ikRestPose = {}  // guarda quaternions iniciales de la cadena

let ikMode = true // true = IK activo, false = FK (rotación normal)
let axisLock = ['x','y','z'] // ejes activos

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

    // 🔥 RESTAURAR POSE DE REPOSO antes de cada solve
    chain.forEach(b => {
        if(ikRestPose[b.uuid]){
            b.quaternion.copy(ikRestPose[b.uuid])
        }
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



/* ------------------------------------------------ */
/* RAYCASTING                                        */
/* ------------------------------------------------ */
export function initRaycasting(){

    console.log("Raycasting activado")

    // ✅ keydown AQUÍ, una sola vez, fuera del pointerdown
    window.addEventListener("keydown",(e)=>{
    const key = e.key.toLowerCase()

    // IK toggle
    if(key === "i"){
        ikMode = !ikMode
        console.log("IK MODE:", ikMode ? "ON" : "OFF")
        if(!ikMode){
            ikActive   = false
            ikDragging = false
            poleActive = false
        }
    }

    // Axis lock
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

        // drags primero, return al final de cada uno
        if(poleActive && poleTarget){
            updateDragPlane(poleTarget.position)
            const pt = new THREE.Vector3()
            if(raycaster.ray.intersectPlane(dragPlane, pt))
                poleTarget.position.copy(pt)
            return
        }

        if(ikDragging && ikTarget){
            updateDragPlane(ikTarget.position)
            const pt = new THREE.Vector3()
            if(raycaster.ray.intersectPlane(dragPlane, pt))
                ikTarget.position.copy(pt)
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

        // eje Y — mouse horizontal
        if(allowedAxes.includes('y') && axisLock.includes('y')){
            tempAxis.set(0,1,0)
            tempQuaternion.setFromAxisAngle(tempAxis, event.movementX * rotSpeed)
            selectedBone.quaternion.multiplyQuaternions(tempQuaternion, selectedBone.quaternion)
        }

        // eje X — mouse vertical
        if(allowedAxes.includes('x') && axisLock.includes('x')){
            tempAxis.set(1,0,0)
            tempQuaternion.setFromAxisAngle(tempAxis, event.movementY * rotSpeed)
            selectedBone.quaternion.multiplyQuaternions(tempQuaternion, selectedBone.quaternion)
        }

        // eje Z — mouse horizontal (roll)
        if(allowedAxes.includes('z') && axisLock.includes('z')){
            tempAxis.set(0,0,1)
            tempQuaternion.setFromAxisAngle(tempAxis, event.movementX * rotSpeed)
            selectedBone.quaternion.multiplyQuaternions(tempQuaternion, selectedBone.quaternion)
        }

        applyBoneConstraints(selectedBone)
    }) // cierra pointermove

    /* ---- POINTER UP ---- */
    renderer.domElement.addEventListener("pointerup",()=>{
        selectedSun = false
        poleActive  = false
        ikDragging  = false
    }) // cierra pointerup

} // cierra initRaycasting
