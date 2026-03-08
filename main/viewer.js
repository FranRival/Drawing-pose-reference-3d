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

bones[obj.name] = obj
console.log("Bone detected:", obj.name)

}

})

console.log("Total bones:", Object.keys(bones).length)

}

/* ROTAR HUESO */

export function rotateBone(name, x, y, z){

if(!bones[name]){
console.warn("Bone not found:", name)
return
}

bones[name].rotation.x = x
bones[name].rotation.y = y
bones[name].rotation.z = z

}
