import { rotateBone } from './viewer.js'

export function initUI(){

/* CABEZA */

const headSlider = document.getElementById("headX")

headSlider.addEventListener("input",(e)=>{

const value = parseFloat(e.target.value)

rotateBone("neck", value, 0, 0)

})

/* BRAZO IZQUIERDO */

const leftArmSlider = document.getElementById("leftArmX")

leftArmSlider.addEventListener("input",(e)=>{

const value = parseFloat(e.target.value)

rotateBone("leftArm", value, 0, 0)

})

/* BRAZO DERECHO */

const rightArmSlider = document.getElementById("rightArmX")

rightArmSlider.addEventListener("input",(e)=>{

const value = parseFloat(e.target.value)

rotateBone("rightArm", value, 0, 0)

})

/* ANTEBRAZO IZQUIERDO */

const leftForeArmSlider = document.getElementById("leftForeArmX")

leftForeArmSlider.addEventListener("input",(e)=>{

const value = parseFloat(e.target.value)

rotateBone("leftForeArm", value, 0, 0)

})

/* ANTEBRAZO DERECHO */

const rightForeArmSlider = document.getElementById("rightForeArmX")

rightForeArmSlider.addEventListener("input",(e)=>{

const value = parseFloat(e.target.value)

rotateBone("rightForeArm", value, 0, 0)

})

}
