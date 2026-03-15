import { model, camera, renderer, scene, sunGizmo, sunAzimuth, sunElevation, setSunAngles } from './core.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

export let bones = {}

let selectedSun = false
let skinnedMeshes = []

let selectedBone = null
let boneHelper = null
let isDragging = false
let lastMouseX = 0
let lastMouseY = 0
let localSunAzimuth = 0
let localSunElevation = 0

const tempQuaternion = new THREE.Quaternion()
const tempAxis = new THREE.Vector3()

export function inspectBones() {

    if (!model) return

    bones = {}

    model.traverse((obj) => {

        if (!obj.isBone) return

        const name = obj.name.toLowerCase()

        if (name.includes("head")) bones.head = obj
        else if (name.includes("neck")) bones.neck = obj

        else if (name.includes("spine")) bones.spine = obj
        else if (name.includes("chest")) bones.chest = obj
        else if (name.includes("hips")) bones.hips = obj

        else if (name.includes("leftshoulder")) bones.leftShoulder = obj
        else if (name.includes("rightshoulder")) bones.rightShoulder = obj

        else if (name.includes("leftarm")) bones.leftArm = obj
        else if (name.includes("rightarm")) bones.rightArm = obj

        else if (name.includes("leftforearm")) bones.leftForeArm = obj
        else if (name.includes("rightforearm")) bones.rightForeArm = obj

        else if (name.includes("lefthand")) bones.leftHand = obj
        else if (name.includes("righthand")) bones.rightHand = obj

        else if (name.includes("leftupleg")) bones.leftUpLeg = obj
        else if (name.includes("rightupleg")) bones.rightUpLeg = obj

        else if (name.includes("leftleg")) bones.leftLeg = obj
        else if (name.includes("rightleg")) bones.rightLeg = obj

        else if (name.includes("leftfoot")) bones.leftFoot = obj
        else if (name.includes("rightfoot")) bones.rightFoot = obj

    })

    console.log("Bones detectados:", bones)

}

export function rotateBone(name, x, y, z) {
    if (!bones[name]) return
    bones[name].rotation.x = x
    bones[name].rotation.y = y
    bones[name].rotation.z = z
}

function highlightBone(bone){

    selectedBone = bone

    // eliminar helper anterior
    if(boneHelper){
        scene.remove(boneHelper)
        boneHelper = null
    }

    // crear helper visual
    const geometry = new THREE.SphereGeometry(0.05,16,16)
    const material = new THREE.MeshBasicMaterial({color:0xff0000})

    boneHelper = new THREE.Mesh(geometry, material)

    scene.add(boneHelper)

}

export function updateBoneHelper(){

    if(!selectedBone || !boneHelper) return

    const pos = new THREE.Vector3()

    selectedBone.getWorldPosition(pos)

    boneHelper.position.copy(pos)

}

export function initRaycasting() {
    console.log("Raycasting de precisión activado");

    renderer.domElement.addEventListener("pointerdown", (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        // Forzamos actualización de matrices
        model.updateMatrixWorld(true);

        const sunHit = raycaster.intersectObject(sunGizmo)

        if(sunHit.length > 0){

        console.log("Sun selected")

        selectedSun = true
        isDragging = false
        selectedBone = null
        localSunAngle=sunAngle

        localSunAzimuth = sunAzimuth
        localSunElevation = sunElevation
        return

        }

        // Intersectamos SOLO el modelo
        const intersects = raycaster.intersectObject(model, true);

        if (intersects.length > 0) {
            // Buscamos la malla (SkinnedMesh)
            const hit = intersects.find(i => i.object.isSkinnedMesh || i.object.isMesh);
            
            if (hit && hit.object.isSkinnedMesh) {
                const mesh = hit.object;
                const geometry = mesh.geometry;
                
                // --- TRUCO MAESTRO: Obtener el hueso mediante SkinIndex ---
                // Esto lee directamente qué hueso tiene asignado el vértice que tocaste
                const skinIndex = geometry.attributes.skinIndex;
                if (skinIndex && hit.face) {
                    // Obtenemos el índice del hueso del primer vértice del triángulo tocado
                    const boneIndex = skinIndex.getX(hit.face.a);
                    const detectedBone = mesh.skeleton.bones[boneIndex];

                    if (detectedBone) {
                        console.log("%c HUESO DETECTADO: " + detectedBone.name, "background: #222; color: #bada55; font-size: 1.2em; font-weight: bold;");
                        //esfera roja de deteccion de hueso
                        highlightBone(detectedBone)

                        isDragging = true
                        lastMouseX = event.clientX
                        lastMouseY = event.clientY  
                        return; // Salimos para evitar logs extra
                    }
                }
            }

        } else {
            console.warn("Click fuera del modelo");
        }
    });


renderer.domElement.addEventListener("pointermove", (event) => {

    if(selectedSun){

    localSunAzimuth += event.movementX * 0.01
    localSunElevation -= event.movementY * 0.01

    setSunAngles(localSunAzimuth, localSunElevation)

    return

    }
    if (!isDragging || !selectedBone) return

    const deltaX = event.movementX
    const deltaY = event.movementY
    
    lastMouseX = event.clientX 
    lastMouseY = event.clientY  

    /* rotación básica */

    const rotSpeed = 0.01

    /* eje vertical */

    tempAxis.set(0,1,0)

    tempQuaternion.setFromAxisAngle(tempAxis, deltaX * rotSpeed)

    selectedBone.quaternion.multiplyQuaternions(
        tempQuaternion,
        selectedBone.quaternion
    )

    /* eje horizontal */

    tempAxis.set(1,0,0)

    tempQuaternion.setFromAxisAngle(tempAxis, deltaY * rotSpeed)

    selectedBone.quaternion.multiplyQuaternions(
        tempQuaternion,
        selectedBone.quaternion
    )

})

renderer.domElement.addEventListener("pointerup", () => {

    isDragging = false
    selectedSun = false

})

}