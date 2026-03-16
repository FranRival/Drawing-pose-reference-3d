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

const tempQuaternion = new THREE.Quaternion()
const tempAxis = new THREE.Vector3()

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

    const deltaX = event.movementX
    const deltaY = event.movementY

    const rotSpeed = 0.01

    /* vertical */

    tempAxis.set(0,1,0)

    tempQuaternion.setFromAxisAngle(tempAxis,deltaX * rotSpeed)

    selectedBone.quaternion.multiplyQuaternions(
        tempQuaternion,
        selectedBone.quaternion
    )

    /* horizontal */

    tempAxis.set(1,0,0)

    tempQuaternion.setFromAxisAngle(tempAxis,deltaY * rotSpeed)

    selectedBone.quaternion.multiplyQuaternions(
        tempQuaternion,
        selectedBone.quaternion
    )

})

/* ------------------------------------------------ */
/* POINTER UP */
/* ------------------------------------------------ */

renderer.domElement.addEventListener("pointerup",()=>{

    isDragging = false
    selectedSun = false

})

}