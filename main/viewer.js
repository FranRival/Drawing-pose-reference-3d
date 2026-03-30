import { model, camera, renderer, scene, sunGizmo, sunAzimuth, sunElevation, setSunAngles } from './core.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

export let bones = {}
export let jointGizmos = []

let ikState = {
    lastAxis: new THREE.Vector3(),
    initialized: false
}

let controls = {}

let selectedSun = false
let selectedBone = null

let dragPlane = new THREE.Plane()
let dragPoint = new THREE.Vector3()

let boneHelper = null

let poleTarget = null
let poleActive = false

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


//control de mano. 
let dragPlane = new THREE.Plane()
let dragOffset = new THREE.Vector3()


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

    // 🔥 convertir a espacio LOCAL (Euler desde quaternion)
    const euler = new THREE.Euler().setFromQuaternion(
        bone.quaternion,
        'XYZ'
    )

    // 🔥 aplicar límites reales
    if(limits.x){
        euler.x = THREE.MathUtils.clamp(euler.x, limits.x[0], limits.x[1])
    }

    if(limits.y){
        euler.y = THREE.MathUtils.clamp(euler.y, limits.y[0], limits.y[1])
    }

    if(limits.z){
        euler.z = THREE.MathUtils.clamp(euler.z, limits.z[0], limits.z[1])
    }

    // 🔥 volver a quaternion
    const targetQuat = new THREE.Quaternion().setFromEuler(euler)

    bone.quaternion.slerp(targetQuat, 0.5)

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




function solveIKChain(arm, foreArm, hand, target, pole){

    if(!arm || !foreArm || !hand) return

    const targetPos = new THREE.Vector3()
    const polePos = new THREE.Vector3()
    const armPos = new THREE.Vector3()
    const forePos = new THREE.Vector3()
    const handPos = new THREE.Vector3()

    target.getWorldPosition(targetPos)
    pole.getWorldPosition(polePos)

    arm.getWorldPosition(armPos)
    foreArm.getWorldPosition(forePos)
    hand.getWorldPosition(handPos)

    // longitudes
    const upperLen = armPos.distanceTo(forePos)
    const lowerLen = forePos.distanceTo(handPos)

    // dirección target
    const dir = new THREE.Vector3()
    dir.subVectors(targetPos, armPos)

    const dist = Math.min(dir.length(), upperLen + lowerLen - 0.001)
    dir.normalize()

    // pole
    const poleDir = new THREE.Vector3()
    poleDir.subVectors(polePos, armPos).normalize()

    // plano
    const side = new THREE.Vector3()
    side.crossVectors(dir, poleDir).normalize()

    const up = new THREE.Vector3()
    up.crossVectors(side, dir).normalize()

    // rotación hombro
    const m = new THREE.Matrix4()
    m.lookAt(armPos, targetPos, up)

    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m)

    arm.quaternion.slerp(targetQuat, 0.4)

    // ángulo codo
    const cosAngle = (upperLen**2 + lowerLen**2 - dist**2) / (2 * upperLen * lowerLen)
    const elbowAngle = Math.acos(THREE.MathUtils.clamp(cosAngle, -1, 1))

    foreArm.rotation.x = Math.PI - elbowAngle

    // orientación mano (simple)
    const handDir = new THREE.Vector3()
    handDir.subVectors(targetPos, handPos).normalize()

    const handQuat = new THREE.Quaternion()
    handQuat.setFromUnitVectors(new THREE.Vector3(0,1,0), handDir)

    hand.quaternion.slerp(handQuat, 0.4)
}





export function updateIK(){

    if(!ikActive || !ikTarget || !poleTarget || !selectedBone) return

    const hand = selectedBone
    const foreArm = hand.parent
    const arm = foreArm?.parent

    if(!arm || !foreArm) return

    // 🔥 usamos solver con pole real
    solveIKChain(arm, foreArm, hand, ikTarget, poleTarget)

}



// ==============esfera morada ======= objetivo de pocision - quiero que la mano llegue aqui.
// =================esfera verde ====== es el control de direccion del codo - hacia donde debe apuntar el codo,




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
/* POLE VECTOR */
/* ------------------------------------------------ */
function createPoleTarget(){

    const geometry = new THREE.SphereGeometry(0.07,16,16)
    const material = new THREE.MeshBasicMaterial({color:0x00ff00})

    poleTarget = new THREE.Mesh(geometry,material)

    scene.add(poleTarget)

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





function solveIK_CCD(chain, target, iterations = 10){

    const targetPos = new THREE.Vector3()
    target.getWorldPosition(targetPos)

    for(let i = 0; i < iterations; i++){

        for(let j = chain.length - 1; j >= 0; j--){

            const bone = chain[j]

            const bonePos = new THREE.Vector3()
            bone.getWorldPosition(bonePos)

            const endEffector = chain[chain.length - 1]
            const endPos = new THREE.Vector3()
            endEffector.getWorldPosition(endPos)

            const toEnd = new THREE.Vector3().subVectors(endPos, bonePos).normalize()
            const toTarget = new THREE.Vector3().subVectors(targetPos, bonePos).normalize()

            const axis = new THREE.Vector3().crossVectors(toEnd, toTarget)

            if(axis.lengthSq() < 0.000001) continue

            axis.normalize()

            const angle = Math.acos(
                THREE.MathUtils.clamp(toEnd.dot(toTarget), -1, 1)
            )

            const quat = new THREE.Quaternion()
            quat.setFromAxisAngle(axis, angle)

            bone.quaternion.multiplyQuaternions(quat, bone.quaternion)

            applyBoneConstraints(bone)
        }
    }
}



/* ------------------------------------------------ */
/* RAYCASTING */
/* ------------------------------------------------ */
export function initRaycasting(){

    console.log("Raycasting activado")
    
    
    /* ========================= */
	/* IK TARGET */
	/* ========================= */

	if(ikTarget){

    	const ikHit = raycaster.intersectObject(ikTarget)

    	if(ikHit.length > 0){

        	ikActive = true
        	poleActive = false
        	selectedBone = null

        	return
    	}
	}

    /* ========================= */
    /* POINTER DOWN (SELECCIÓN) */
    /* ========================= */



    renderer.domElement.addEventListener("pointerdown",(event)=>{

    const rect = renderer.domElement.getBoundingClientRect()

    mouse.x = ((event.clientX - rect.left)/rect.width)*2 - 1
    mouse.y = -((event.clientY - rect.top)/rect.height)*2 + 1

    raycaster.setFromCamera(mouse,camera)

    if(model) model.updateMatrixWorld(true)

    /* RESET */
    selectedSun = false
    poleActive = false
    ikActive = false
    selectedBone = null

    /* ========================= */
    /* SUN */
    /* ========================= */

    const sunHit = raycaster.intersectObject(sunGizmo)

    if(sunHit.length > 0){

        selectedSun = true
        return
    }

    /* ========================= */
    /* GIZMOS (HUESOS) */
    /* ========================= */

    const gizmoHits = raycaster.intersectObjects(jointGizmos)

    if(gizmoHits.length > 0){

        const bone = gizmoHits[0].object.userData.bone

        if(bone){

            highlightBone(bone)
            selectedBone = bone

            const boneName = getBoneName(bone)

            console.log("CLICK EN:", boneName) // 👈 DEBUG

            /* ========================= */
            /* IK ACTIVATION */
            /* ========================= */

            if(boneName === "leftHand" || boneName === "rightHand"){

                console.log("CREANDO IK TARGETS") // 👈 DEBUG

                if(!ikTarget) createIKTarget()
                if(!poleTarget) createPoleTarget()

                const pos = new THREE.Vector3()
                bone.getWorldPosition(pos)

                ikTarget.position.copy(pos)
                poleTarget.position.copy(pos).add(new THREE.Vector3(0,0.5,0.5))

                ikActive = true
            }

            return
        }
    }

    /* ========================= */
    /* MODEL CLICK (fallback) */
    /* ========================= */

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
                }
            }
        }
    }
})


    /* ========================= */
    /* POINTER MOVE (CONTROL) */
    /* ========================= */

    renderer.domElement.addEventListener("pointermove",(event)=>{

        /* --- SUN --- */
        if(selectedSun){

            localSunAzimuth += event.movementX * 0.01
            localSunElevation -= event.movementY * 0.01

            setSunAngles(localSunAzimuth,localSunElevation)
            return
        }

        /* --- POLE --- */
        if(poleActive && poleTarget){

    		const speed = 0.005

    		poleTarget.position.x += event.movementX * speed
    		poleTarget.position.y -= event.movementY * speed

    		updateIK() // 🔥 clave

    		return
		}

        /* --- IK --- */
        if(ikActive && ikTarget){

    		const rect = renderer.domElement.getBoundingClientRect()

    		mouse.x = ((event.clientX - rect.left)/rect.width)*2 - 1
    		mouse.y = -((event.clientY - rect.top)/rect.height)*2 + 1

    		raycaster.setFromCamera(mouse, camera)

   			 // 🔥 intersectar con plano
    		if(raycaster.ray.intersectPlane(dragPlane, dragPoint)){

        		ikTarget.position.copy(dragPoint)
        		updateIK()
    		}

    			return
		}

        /* --- ROTACIÓN NORMAL --- */
        if(!selectedBone) return

        const deltaX = event.movementX
        const deltaY = event.movementY

        const boneName = getBoneName(selectedBone)
        if(!boneName) return

        const allowedAxes = boneAxes[boneName] || ['x','y','z']

        const rotSpeed = 0.01

        if(allowedAxes.includes('y')){

            tempAxis.set(0,1,0)

            tempQuaternion.setFromAxisAngle(tempAxis,deltaX * rotSpeed)

            selectedBone.quaternion.multiplyQuaternions(
                tempQuaternion,
                selectedBone.quaternion
            )
        }

        if(allowedAxes.includes('x')){

            tempAxis.set(1,0,0)

            tempQuaternion.setFromAxisAngle(tempAxis,deltaY * rotSpeed)

            selectedBone.quaternion.multiplyQuaternions(
                tempQuaternion,
                selectedBone.quaternion
            )
        }

        applyBoneConstraints(selectedBone)
    })


    /* ========================= */
    /* POINTER UP (RESET) */
    /* ========================= */

    renderer.domElement.addEventListener("pointerup",()=>{

        selectedSun = false
        poleActive = false
        ikActive = false
    })
}