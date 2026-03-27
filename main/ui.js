import { rotateBone } from './viewer.js'
import { setSunAngle } from './core.js'



export function initUI(){

    /* ========================= */
    /* SUN CONTROL */
    /* ========================= */

    const sunSlider = document.getElementById("sunAngle")

    if(sunSlider){
        sunSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setSunAngle(value)
        })
    }

    /* ========================= */
    /* CABEZA */
    /* ========================= */

    const headSlider = document.getElementById("headX")

    if(headSlider){
        headSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            rotateBone("neck", value, 0, 0)
        })
    }

    /* ========================= */
    /* BRAZO IZQUIERDO */
    /* ========================= */

    const leftArmSlider = document.getElementById("leftArmX")

    if(leftArmSlider){
        leftArmSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            rotateBone("leftArm", value, 0, 0)
        })
    }

    /* ========================= */
    /* BRAZO DERECHO */
    /* ========================= */

    const rightArmSlider = document.getElementById("rightArmX")

    if(rightArmSlider){
        rightArmSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            rotateBone("rightArm", value, 0, 0)
        })
    }

    /* ========================= */
    /* ANTEBRAZO IZQUIERDO */
    /* ========================= */

    const leftForeArmSlider = document.getElementById("leftForeArmX")

    if(leftForeArmSlider){
        leftForeArmSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            rotateBone("leftForeArm", value, 0, 0)
        })
    }

    /* ========================= */
    /* ANTEBRAZO DERECHO */
    /* ========================= */

    const rightForeArmSlider = document.getElementById("rightForeArmX")

    if(rightForeArmSlider){
        rightForeArmSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            rotateBone("rightForeArm", value, 0, 0)
        })
    }

}