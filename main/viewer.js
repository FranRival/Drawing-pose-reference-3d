import { model } from './core.js'

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
