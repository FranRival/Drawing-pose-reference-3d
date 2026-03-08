import { model } from './core.js'

export function inspectBones(){

const bones = {}

model.traverse(function(object){

if(object.isBone){

bones[object.name] = object
console.log("Bone:", object.name)

}

})

return bones

}
