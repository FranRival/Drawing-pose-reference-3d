import { rotateBone } from './viewer.js'

export function initUI(){

const headSlider = document.getElementById("headX")

headSlider.addEventListener("input",(e)=>{

const value = parseFloat(e.target.value)

rotateBone("mixamorigHead", value, 0, 0)

})

}
