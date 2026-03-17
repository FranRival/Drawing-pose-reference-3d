import { model, camera, renderer, scene, sunGizmo, sunAzimuth, sunElevation, setSunAngles } from './core.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

export let bones = {}
export let jointGizmos = []

let selectedSun = false
let selectedBone = null

let boneHelper = null

let isDragging = false
let lastMouseX = 0
let lastMouseY = 0

let selectedGizmo = null

let localSunAzimuth = 0
let localSunElevation = 0

let ikTarget = null
let ikActive = false

const tempQuaternion = new THREE.Quaternion()
const tempAxis = new THREE.Vector3()


const boneLimits = {

neck: { x:[-0.8,0.8], y:[-0.8,0.8], z:[-0.4,0.4] },

leftArm: { x:[-1.5,1.5] },
rightArm: { x:[-1.5,1.5] },

leftForeArm: { x:[0,2.2] },
rightForeArm: { x:[0,2.2] },

leftUpLeg: { x:[-1.2,1.2] },
rightUpLeg: { x:[-1.2,1.2] },

leftLeg: { x:[0,2.4] },
rightLeg: { x:[0,2.4] }

}

const boneAxes = {

neck: ['x','y'],

leftArm: ['x','y','z'],
rightArm: ['x','y','z'],

leftForeArm: ['x'],
rightForeArm: ['x'],

leftUpLeg: ['x','y'],
rightUpLeg: ['x','y'],

leftLeg: ['x'],
rightLeg: ['x']

}

///limites en los huesos

function applyBoneConstraints(bone){

    const entry = Object.entries(bones)
        .find(([name,b]) => b === bone)

    if(!entry) return

    const name = entry[0]

    const limits = boneLimits[name]

    if(!limits) return

    if(limits.x){

        bone.rotation.x = THREE.MathUtils.clamp(
            bone.rotation.x,
            limits.x[0],
            limits.x[1]
        )

    }

    if(limits.y){

        bone.rotation.y = THREE.MathUtils.clamp(
            bone.rotation.y,
            limits.y[0],
            limits.y[1]
        )

    }

    if(limits.z){

        bone.rotation.z = THREE.MathUtils.clamp(
            bone.rotation.z,
            limits.z[0],
            limits.z[1]
        )

    }

}




function getBoneName(bone){

    const entry = Object.entries(bones)
        .find(([name,b]) => b === bone)

    return entry ? entry[0] : null

}
/* ------------------------------------------------ */
/* BONE DETECTION */
/* ------------------------------------------------ */

export function inspectBones(){

    if(!model) return

    bones = {}

    model.traverse((obj)=>{

        if(!obj.isBone) return

        const name = obj.name.toLowerCase()

        if(name.includes("head")) bones.head = obj
        else if(name.includes("neck")) bones.neck = obj

        else if(name.includes("spine")) bones.spine = obj
        else if(name.includes("chest")) bones.chest = obj
        else if(name.includes("hips")) bones.hips = obj

        else if(name.includes("leftshoulder")) bones.leftShoulder = obj
        else if(name.includes("rightshoulder")) bones.rightShoulder = obj

        else if(name.includes("leftarm")) bones.leftArm = obj
        else if(name.includes("rightarm")) bones.rightArm = obj

        else if(name.includes("leftforearm")) bones.leftForeArm = obj
        else if(name.includes("rightforearm")) bones.rightForeArm = obj

        else if(name.includes("lefthand")) bones.leftHand = obj
        else if(name.includes("righthand")) bones.rightHand = obj

        else if(name.includes("leftupleg")) bones.leftUpLeg = obj
        else if(name.includes("rightupleg")) bones.rightUpLeg = obj

        else if(name.includes("leftleg")) bones.leftLeg = obj
        else if(name.includes("rightleg")) bones.rightLeg = obj

        else if(name.includes("leftfoot")) bones.leftFoot = obj
        else if(name.includes("rightfoot")) bones.rightFoot = obj

    })

    console.log("Bones detectados:", bones)

}

/* ------------------------------------------------ */
/* JOINT GIZMOS */
/* ------------------------------------------------ */

export function createJointGizmos(){

    // Limpieza: eliminar gizmos antiguos de la escena
    jointGizmos.forEach(g => scene.remove(g));
    jointGizmos = []

    Object.values(bones).forEach(bone=>{

        const geometry = new THREE.SphereGeometry(0.06,12,12)
        const material = new THREE.MeshBasicMaterial({
            color:0x00ffff,
            depthTest:false
        })

        const gizmo = new THREE.Mesh(geometry,material)

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



function createIKTarget(){

    const geometry = new THREE.SphereGeometry(0.08,16,16)
    const material = new THREE.MeshBasicMaterial({color:0xff00ff})

    ikTarget = new THREE.Mesh(geometry,material)

    scene.add(ikTarget)

}


function solveIK(){

    if(!selectedBone || !ikTarget) return

    // cadena
    const hand = selectedBone
    const foreArm = hand.parent
    const arm = foreArm?.parent

    if(!arm || !foreArm) return

    // posiciones
    const targetPos = new THREE.Vector3()
    ikTarget.getWorldPosition(targetPos)

    const armPos = new THREE.Vector3()
    arm.getWorldPosition(armPos)

    const forePos = new THREE.Vector3()
    foreArm.getWorldPosition(forePos)

    const handPos = new THREE.Vector3()
    hand.getWorldPosition(handPos)

    // longitudes
    const upperLen = armPos.distanceTo(forePos)
    const lowerLen = forePos.distanceTo(handPos)
    const targetDist = armPos.distanceTo(targetPos)

    // clamp distancia (evita romper el brazo)
    const maxDist = upperLen + lowerLen - 0.001
    const dist = Math.min(targetDist, maxDist)

    // dirección hacia target
    const dir = new THREE.Vector3()
    dir.subVectors(targetPos, armPos).normalize()

    // eje perpendicular (plano de doblado)
    const axis = new THREE.Vector3(0,0,1)

    // calcular ángulo del codo (ley de cosenos)
    const cosAngle = (upperLen**2 + lowerLen**2 - dist**2) / (2 * upperLen * lowerLen)
    const elbowAngle = Math.acos(THREE.MathUtils.clamp(cosAngle,-1,1))

    // rotar hombro hacia target
    const quat = new THREE.Quaternion()
    quat.setFromUnitVectors(new THREE.Vector3(0,1,0), dir)

    arm.quaternion.slerp(quat,0.5)

    // doblar codo
    foreArm.rotation.x = Math.PI - elbowAngle

}

/* ------------------------------------------------ */
/* BONE ROTATION */
/* ------------------------------------------------ */

export function rotateBone(name,x,y,z){

    if(!bones[name]) return

    bones[name].rotation.x = x
    bones[name].rotation.y = y
    bones[name].rotation.z = z

}

/* ------------------------------------------------ */
/* HELPER VISUAL */
/* ------------------------------------------------ */
function highlightBone(bone){

    // reset color anterior
    if(selectedGizmo){
        selectedGizmo.material.color.set(0x00ffff)
    }

    selectedBone = bone
    selectedGizmo = null

    // buscar gizmo correcto
    jointGizmos.forEach(gizmo => {

        if(gizmo.userData.bone === bone){

            gizmo.material.color.set(0xff8800)

            selectedGizmo = gizmo

        }

    })

    // helper visual
    if(boneHelper){

        scene.remove(boneHelper)

    }

    const geometry = new THREE.SphereGeometry(0.05,16,16)
    const material = new THREE.MeshBasicMaterial({color:0xff0000})

    boneHelper = new THREE.Mesh(geometry,material)

    scene.add(boneHelper)

}


export function updateBoneHelper(){

    if(!selectedBone || !boneHelper) return

    const pos = new THREE.Vector3()

    selectedBone.getWorldPosition(pos)

    boneHelper.position.copy(pos)

}

/* ------------------------------------------------ */
/* RAYCASTING */
/* ------------------------------------------------ */

export function initRaycasting(){

    console.log("Raycasting activado")

    renderer.domElement.addEventListener("pointerdown",(event)=>{

        const rect = renderer.domElement.getBoundingClientRect()

        mouse.x = ((event.clientX - rect.left)/rect.width)*2 - 1
        mouse.y = -((event.clientY - rect.top)/rect.height)*2 + 1

        raycaster.setFromCamera(mouse,camera)

        model.updateMatrixWorld(true)

        /* SUN SELECTION */

        const sunHit = raycaster.intersectObject(sunGizmo)

        if(sunHit.length > 0){

            selectedSun = true
            isDragging = false
            selectedBone = null

            localSunAzimuth = sunAzimuth
            localSunElevation = sunElevation

            return

        }

        /* GIZMO SELECTION */

        const gizmoHits = raycaster.intersectObjects(jointGizmos)

        if(gizmoHits.length > 0){

            const gizmo = gizmoHits[0].object
            const bone = gizmo.userData.bone

            if(bone){

                highlightBone(bone)

                selectedBone = bone
                isDragging = true

                lastMouseX = event.clientX
                lastMouseY = event.clientY

                return

            }

            if(bone){

                highlightBone(bone)

                selectedBone = bone
                isDragging = true

                // activar IK si es mano
                const boneName = getBoneName(bone)

                if(boneName === "leftHand" || boneName === "rightHand"){

                    if(!ikTarget) createIKTarget()

                    const pos = new THREE.Vector3()
                    bone.getWorldPosition(pos)

                    ikTarget.position.copy(pos)

                    ikActive = true

                } else {

                    ikActive = false

                }

                return
            }

        }

        /* MODEL SELECTION */

        const intersects = raycaster.intersectObject(model,true)

        if(intersects.length > 0){

            const hit = intersects.find(i=>i.object.isSkinnedMesh)

            if(hit){

                const mesh = hit.object
                const geometry = mesh.geometry

                const skinIndex = geometry.attributes.skinIndex

                if(skinIndex && hit.face){

                    const boneIndex = skinIndex.getX(hit.face.a)
                    const detectedBone = mesh.skeleton.bones[boneIndex]

                    if(detectedBone){

                        highlightBone(detectedBone)

                        selectedBone = detectedBone
                        isDragging = true

                        lastMouseX = event.clientX
                        lastMouseY = event.clientY

                    }

                }

            }

        }

    })

/* ------------------------------------------------ */
/* POINTER MOVE */
/* ------------------------------------------------ */

renderer.domElement.addEventListener("pointermove",(event)=>{

    /* SUN CONTROL */

    if(selectedSun){

        localSunAzimuth += event.movementX * 0.01
        localSunElevation -= event.movementY * 0.01

        setSunAngles(localSunAzimuth,localSunElevation)

        return

    }

    if(!isDragging || !selectedBone) return

    /* ========================= */
    /* IK CONTROL (AQUI VA) */
    /* ========================= */

    if(ikActive && ikTarget){

        const speed = 0.01

        ikTarget.position.x += event.movementX * speed
        ikTarget.position.y -= event.movementY * speed

        solveIK()

        return
    }

    /* ========================= */
    /* ROTACION NORMAL */
    /* ========================= */

    const deltaX = event.movementX
    const deltaY = event.movementY

    const boneName = getBoneName(selectedBone)
    if(!boneName) return

    const allowedAxes = boneAxes[boneName] || ['x','y','z']

    const rotSpeed = 0.01

    /* eje Y */

    if(allowedAxes.includes('y')){

        tempAxis.set(0,1,0)

        tempQuaternion.setFromAxisAngle(tempAxis,deltaX * rotSpeed)

        selectedBone.quaternion.multiplyQuaternions(
            tempQuaternion,
            selectedBone.quaternion
        )

    }

    /* eje X */

    if(allowedAxes.includes('x')){

        tempAxis.set(1,0,0)

        tempQuaternion.setFromAxisAngle(tempAxis,deltaY * rotSpeed)

        selectedBone.quaternion.multiplyQuaternions(
            tempQuaternion,
            selectedBone.quaternion
        )

    }

    /* constraints */

    applyBoneConstraints(selectedBone)

})

/* ------------------------------------------------ */
/* POINTER UP */
/* ------------------------------------------------ */

renderer.domElement.addEventListener("pointerup",()=>{

    isDragging = false
    selectedSun = false

})

}