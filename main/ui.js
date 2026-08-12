import { rotateBone, addKeyframe, clearKeyframes, getKeyframeCount,
         togglePlay, exportFrameSequence, exportKeyframesOnly,
         setOnKeyframesChange } from './viewer.js'
import { setSunAngle, applyCameraShot } from './core.js'

export function initUI(){

    /* ========================= */
    /* ENCUADRE (CAMERA SHOT) */
    /* ========================= */

    const cameraShotSelect = document.getElementById("cameraShot")

    if(cameraShotSelect){
        cameraShotSelect.addEventListener("change",(e)=>{
            applyCameraShot(e.target.value)
        })
    }

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

    /* ========================= */
    /* ✅ NUEVO: KEYFRAMES / ANIMACIÓN / EXPORT */
    /* ========================= */

    const btnAddKeyframe    = document.getElementById("btnAddKeyframe")
    const btnClearKeyframes = document.getElementById("btnClearKeyframes")
    const keyframeCountEl   = document.getElementById("keyframeCount")
    const btnPlay           = document.getElementById("btnPlay")
    const frameCountSelect  = document.getElementById("frameCount")
    const imgFormatSelect   = document.getElementById("imgFormat")
    const btnExportSequence = document.getElementById("btnExportSequence")
    const btnExportKeyframes= document.getElementById("btnExportKeyframes")

    function refreshKeyframeCount(){
        if(keyframeCountEl){
            keyframeCountEl.textContent = `${getKeyframeCount()} keyframes`
        }
    }

    setOnKeyframesChange(refreshKeyframeCount)
    refreshKeyframeCount()

    if(btnAddKeyframe){
        btnAddKeyframe.addEventListener("click", ()=>{
            addKeyframe()
        })
    }

    if(btnClearKeyframes){
        btnClearKeyframes.addEventListener("click", ()=>{
            if(confirm("¿Borrar todos los keyframes grabados?")){
                clearKeyframes()
            }
        })
    }

    if(btnPlay){
        btnPlay.addEventListener("click", ()=>{
            const playing = togglePlay()
            btnPlay.textContent = playing ? "⏸ Pausar" : "▶ Reproducir"
        })
    }

    if(btnExportSequence){
        btnExportSequence.addEventListener("click", async ()=>{
            const frameCount = parseInt(frameCountSelect?.value || "24", 10)
            const format = imgFormatSelect?.value || "png"

            btnExportSequence.disabled = true
            btnExportSequence.textContent = "Exportando..."

            await exportFrameSequence(frameCount, format)

            btnExportSequence.disabled = false
            btnExportSequence.textContent = "Exportar secuencia completa (.zip)"
        })
    }

    if(btnExportKeyframes){
        btnExportKeyframes.addEventListener("click", async ()=>{
            const format = imgFormatSelect?.value || "png"

            btnExportKeyframes.disabled = true
            btnExportKeyframes.textContent = "Exportando..."

            await exportKeyframesOnly(format)

            btnExportKeyframes.disabled = false
            btnExportKeyframes.textContent = "Exportar solo keyframes (.zip)"
        })
    }

}
