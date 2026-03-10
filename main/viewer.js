import { model, camera, renderer, scene} from './core.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()


export let bones = {}

export function inspectBones(){

if(!model){
console.warn("Modelo aún no cargado")
return
}

bones = {}

model.traverse((obj)=>{

if(obj.isBone){

const name = obj.name.toLowerCase()

if(name.includes("head")) bones.head = obj
if(name.includes("neck")) bones.neck = obj

if(name.includes("leftarm")) bones.leftArm = obj
if(name.includes("rightarm")) bones.rightArm = obj

if(name.includes("leftforearm")) bones.leftForeArm = obj
if(name.includes("rightforearm")) bones.rightForeArm = obj

if(name.includes("lefthand")) bones.leftHand = obj
if(name.includes("righthand")) bones.rightHand = obj

console.log("Bone detected:", obj.name)

}

})

window.bones = bones
console.log("Bone registry:", bones)


}

export function rotateBone(name,x,y,z){

if(!bones[name]){
console.warn("Bone not found:",name)
console.log("HEAD BONE:", bones.head)
return
}

bones[name].rotation.x = x
bones[name].rotation.y = y
bones[name].rotation.z = z

}

export function initRaycasting(){

console.log("Raycasting initialized")

const skinnedMeshes = []

/* buscar meshes dentro del armature */

model.traverse((obj)=>{

if(obj.isSkinnedMesh){

obj.frustumCulled = false

skinnedMeshes.push(obj)

console.log("SkinnedMesh detected:", obj.name)

}

})

renderer.domElement.addEventListener("pointerdown",(event)=>{

console.log("Canvas clicked")

/* actualizar matrices antes del raycast */

model.updateWorldMatrix(true, true)

const rect = renderer.domElement.getBoundingClientRect()

mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

raycaster.setFromCamera(mouse, camera)

/* raycast contra los meshes */

const intersects = raycaster.intersectObjects(skinnedMeshes, true)

console.log("Intersections:", intersects)

if(intersects.length > 0){

const hit = intersects[0]

console.log("Hit mesh:", hit.object.name)
console.log("Hit point:", hit.point)

}

})

}
