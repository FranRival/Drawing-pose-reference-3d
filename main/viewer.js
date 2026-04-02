import { model, camera, renderer, scene, sunGizmo, setSunAngles } from './core.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

export let bones = {}
export let jointGizmos = []

let selectedSun = false
let selectedBone = null
let boneHelper = null
let poleTarget = null
let poleActive = false
let selectedGizmo = null
let localSunAzimuth = 0
let localSunElevation = 0
let ikTarget = null
let ikActive = false     // IK está "enganchado" a un hueso
let ikDragging = false   // usuario está arrastrando AHORA

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
function solveIK_CCD(chain, target, iterations = 15){

    const targetPos = new THREE.Vector3()
    target.getWorldPosition(targetPos)

    for(let iter = 0; iter < iterations; iter++){

        // Iterar desde el penúltimo hueso hacia la raíz
        // (el último es el end-effector, no lo rotamos)
        for(let j = chain.length - 2; j >= 0; j--){

            const bone = chain[j]

            // posición mundial del hueso actual
            const bonePos = new THREE.Vector3()
            bone.getWorldPosition(bonePos)

            // posición mundial del end-effector (mano)
            const endPos = new THREE.Vector3()
            chain[chain.length - 1].getWorldPosition(endPos)

            const toEnd    = new THREE.Vector3().subVectors(endPos,    bonePos).normalize()
            const toTarget = new THREE.Vector3().subVectors(targetPos, bonePos).normalize()

            const dot = THREE.MathUtils.clamp(toEnd.dot(toTarget), -1, 1)

            // ya apunta al target, saltar
            if(dot > 0.9999) continue

            // eje de rotación en espacio MUNDIAL
            const worldAxis = new THREE.Vector3().crossVectors(toEnd, toTarget)
            if(worldAxis.lengthSq() < 1e-10) continue
            worldAxis.normalize()

            const angle = Math.acos(dot)

            // ⚠️ CLAVE: convertir eje al espacio LOCAL del hueso
            // Necesitamos la inversa de la rotación mundial del hueso
            const boneWorldQuat = new THREE.Quaternion()
            bone.getWorldQuaternion(boneWorldQuat)
            const boneWorldQuatInv = boneWorldQuat.clone().invert()

            const localAxis = worldAxis.clone().applyQuaternion(boneWorldQuatInv)
            localAxis.normalize()

            // aplicar rotación en espacio local
            const deltaQuat = new THREE.Quaternion().setFromAxisAngle(localAxis, angle)
            bone.quaternion.multiplyQuaternions(deltaQuat, bone.quaternion)
            bone.quaternion.normalize()

            // aplicar límites
            applyBoneConstraints(bone)

            // actualizar matrices para la siguiente iteración
            bone.updateMatrixWorld(true)
        }
    }
}

/* ------------------------------------------------ */
/* UPDATE IK (llamado desde el loop)                 */
/* ------------------------------------------------ */
export function updateIK(){

    if(!ikActive || !ikTarget) return
    if(!selectedBone) return

    const boneName = getBoneName(selectedBone)
    if(!boneName) return

    let chain = []

    if(boneName === "leftHand"){
        chain = [bones.leftArm, bones.leftForeArm, bones.leftHand]
    } else if(boneName === "rightHand"){
        chain = [bones.rightArm, bones.rightForeArm, bones.rightHand]
    }

    if(chain.length === 0 || chain.some(b => !b)){
        console.warn("Cadena IK incompleta:", chain)
        return
    }

    // actualizar matrices de toda la cadena antes de calcular
    chain.forEach(b => b.updateMatrixWorld(true))

    solveIK_CCD(chain, ikTarget, 15)

    // forzar update del skeleton
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
    if(selectedGizmo) selectedGizmo.material.color.set(0x00ffff)

    selectedBone = bone
    selectedGizmo = null

    jointGizmos.forEach(gizmo => {
        if(gizmo.userData.bone === bone){
            gizmo.material.color.set(0xff8800)
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

/* ------------------------------------------------ */
/* RAYCASTING                                        */
/* ------------------------------------------------ */
export function initRaycasting(){

    console.log("Raycasting activado")

    /* ---- POINTER DOWN ---- */
    renderer.domElement.addEventListener("pointerdown",(event)=>{

        const rect = renderer.domElement.getBoundingClientRect()
        mouse.x = ((event.clientX - rect.left) / rect.width)  * 2 - 1
        mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1

        raycaster.setFromCamera(mouse, camera)
        if(model) model.updateMatrixWorld(true)

        /* RESET de flags de drag — NO tocar ikActive aquí */
        selectedSun  = false
        poleActive   = false
        ikDragging   = false

        /* ---- SUN ---- */
        if(raycaster.intersectObject(sunGizmo).length > 0){
            selectedSun = true
            return
        }

        /* ---- IK TARGET (esfera morada) ---- */
        if(ikTarget){
            const hit = raycaster.intersectObject(ikTarget)
            if(hit.length > 0){
                console.log("DRAG IK TARGET")
                ikDragging = true
                updateDragPlane(ikTarget.position)
                return
            }
        }

        /* ---- POLE TARGET (esfera verde) ---- */
        if(poleTarget){
            const hit = raycaster.intersectObject(poleTarget)
            if(hit.length > 0){
                console.log("DRAG POLE TARGET")
                poleActive = true
                updateDragPlane(poleTarget.position)
                return
            }
        }

        /* ---- GIZMOS (selección de hueso) ---- */
        const gizmoHits = raycaster.intersectObjects(jointGizmos)
        if(gizmoHits.length > 0){
            const bone = gizmoHits[0].object.userData.bone
            if(bone){
                highlightBone(bone)
                selectedBone = bone

                const boneName = getBoneName(bone)
                console.log("BONE SELECCIONADO:", boneName)

                // Activar IK si es una mano
                if(boneName === "leftHand" || boneName === "rightHand"){

                    if(!ikTarget)   createIKTarget()
                    if(!poleTarget) createPoleTarget()

                    // colocar targets en la posición actual de la mano
                    const pos = new THREE.Vector3()
                    bone.getWorldPosition(pos)
                    ikTarget.position.copy(pos)
                    poleTarget.position.copy(pos).add(new THREE.Vector3(0, 0.4, 0.3))

                    ikActive   = true
                    ikDragging = true  // empieza a arrastrar inmediatamente

                    updateDragPlane(ikTarget.position)

                    console.log("IK ACTIVADO para:", boneName)
                    console.log("ikTarget en:", ikTarget.position)
                } else {
                    // si seleccionamos otro hueso, desactivar IK
                    ikActive   = false
                    ikDragging = false
                }
                return
            }
        }

        /* ---- MODEL FALLBACK ---- */
        const intersects = raycaster.intersectObject(model, true)
        if(intersects.length > 0){
            const hit = intersects.find(i => i.object.isSkinnedMesh)
            if(hit){
                const mesh      = hit.object
                const skinIndex = mesh.geometry.attributes.skinIndex
                if(skinIndex && hit.face){
                    const boneIndex    = skinIndex.getX(hit.face.a)
                    const detectedBone = mesh.skeleton.bones[boneIndex]
                    if(detectedBone){
                        highlightBone(detectedBone)
                        selectedBone = detectedBone
                        ikActive   = false
                        ikDragging = false
                    }
                }
            }
        }
    })

    /* ---- POINTER MOVE ---- */
    renderer.domElement.addEventListener("pointermove",(event)=>{

        /* SUN */
        if(selectedSun){
            localSunAzimuth   += event.movementX * 0.01
            localSunElevation -= event.movementY * 0.01
            setSunAngles(localSunAzimuth, localSunElevation)
            return
        }

        /* POLE (esfera verde) */
        if(poleActive && poleTarget){
            const rect = renderer.domElement.getBoundingClientRect()
            mouse.x = ((event.clientX - rect.left) / rect.width)  * 2 - 1
            mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1

            raycaster.setFromCamera(mouse, camera)
            updateDragPlane(poleTarget.position)

            const pt = new THREE.Vector3()
            if(raycaster.ray.intersectPlane(dragPlane, pt)){
                poleTarget.position.copy(pt)
                // el pole no ejecuta IK por sí solo; updateIK() lo llama el loop
            }
            return
        }

        /* IK (esfera morada) */
        if(ikDragging && ikTarget){
            const rect = renderer.domElement.getBoundingClientRect()
            mouse.x = ((event.clientX - rect.left) / rect.width)  * 2 - 1
            mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1

            raycaster.setFromCamera(mouse, camera)

            // recalcular plano con posición actual del target
            updateDragPlane(ikTarget.position)

            const pt = new THREE.Vector3()
            if(raycaster.ray.intersectPlane(dragPlane, pt)){
                ikTarget.position.copy(pt)
            }
            return
        }

        /* ROTACIÓN MANUAL de hueso */
        if(!selectedBone || ikActive) return

        const boneName    = getBoneName(selectedBone)
        if(!boneName) return

        const allowedAxes = boneAxes[boneName] || ['x','y','z']
        const rotSpeed    = 0.01

        if(allowedAxes.includes('y')){
            tempAxis.set(0,1,0)
            tempQuaternion.setFromAxisAngle(tempAxis, event.movementX * rotSpeed)
            selectedBone.quaternion.multiplyQuaternions(tempQuaternion, selectedBone.quaternion)
        }
        if(allowedAxes.includes('x')){
            tempAxis.set(1,0,0)
            tempQuaternion.setFromAxisAngle(tempAxis, event.movementY * rotSpeed)
            selectedBone.quaternion.multiplyQuaternions(tempQuaternion, selectedBone.quaternion)
        }

        applyBoneConstraints(selectedBone)
    })

    /* ---- POINTER UP ---- */
    renderer.domElement.addEventListener("pointerup",()=>{
        selectedSun = false
        poleActive  = false
        ikDragging  = false
        // ⚠️ NO resetear ikActive — el IK debe seguir activo
        // hasta que el usuario seleccione otro hueso
    })
}
