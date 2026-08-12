import { rotateBone, setBoneAxis, bones, resetPose, addKeyframe, clearKeyframes, getKeyframeCount,
         togglePlay, exportFrameSequence, exportKeyframesOnly,
         setOnKeyframesChange } from './viewer.js'
import { setSunAngle, applyCameraShot } from './core.js'

// ✅ NUEVO: catálogo de todos los huesos/ejes controlables por slider.
// Los rangos vienen de los límites ya definidos en viewer.js (boneLimits).
// Si un hueso no existe en el modelo cargado, simplemente se omite.
const POSE_CONTROLS = [
    { bone: "neck", label: "Cabeza", axes: [
        { axis: "x", label: "Arriba / abajo", min: -0.8, max: 0.8 },
        { axis: "y", label: "Girar izquierda / derecha", min: -0.8, max: 0.8 }
    ]},
    { bone: "leftArm", label: "Brazo izquierdo", axes: [
        { axis: "x", label: "X", min: -1.5, max: 1.5 },
        { axis: "y", label: "Y", min: -1.5, max: 1.5 },
        { axis: "z", label: "Z", min: -1.5, max: 1.5 }
    ]},
    { bone: "rightArm", label: "Brazo derecho", axes: [
        { axis: "x", label: "X", min: -1.5, max: 1.5 },
        { axis: "y", label: "Y", min: -1.5, max: 1.5 },
        { axis: "z", label: "Z", min: -1.5, max: 1.5 }
    ]},
    { bone: "leftForeArm", label: "Antebrazo izquierdo", axes: [
        { axis: "x", label: "Flexión", min: 0, max: 2.2 }
    ]},
    { bone: "rightForeArm", label: "Antebrazo derecho", axes: [
        { axis: "x", label: "Flexión", min: 0, max: 2.2 }
    ]},
    { bone: "leftUpLeg", label: "Pierna sup. izquierda", axes: [
        { axis: "x", label: "X", min: -1.2, max: 1.2 },
        { axis: "y", label: "Y", min: -1.2, max: 1.2 }
    ]},
    { bone: "rightUpLeg", label: "Pierna sup. derecha", axes: [
        { axis: "x", label: "X", min: -1.2, max: 1.2 },
        { axis: "y", label: "Y", min: -1.2, max: 1.2 }
    ]},
    { bone: "leftLeg", label: "Pierna inf. izquierda", axes: [
        { axis: "x", label: "Flexión", min: 0, max: 2.4 }
    ]},
    { bone: "rightLeg", label: "Pierna inf. derecha", axes: [
        { axis: "x", label: "Flexión", min: 0, max: 2.4 }
    ]}
]

// ✅ NUEVO: construye todos los sliders de pose disponibles según los
// huesos que sí detectó inspectBones() en el modelo actual.
function buildPoseControls(){
    const container = document.getElementById("poseControlsContainer")
    if(!container) return

    container.innerHTML = ""

    POSE_CONTROLS.forEach(group => {
        if(!bones[group.bone]) return

        const title = document.createElement("h4")
        title.textContent = group.label
        container.appendChild(title)

        group.axes.forEach(axisDef => {
            const wrapper = document.createElement("div")
            wrapper.className = "control"

            const label = document.createElement("label")
            label.textContent = axisDef.label

            const input = document.createElement("input")
            input.type = "range"
            input.min = axisDef.min
            input.max = axisDef.max
            input.step = 0.01
            input.value = 0

            input.addEventListener("input",(e)=>{
                setBoneAxis(group.bone, axisDef.axis, parseFloat(e.target.value))
            })

            wrapper.appendChild(label)
            wrapper.appendChild(input)
            container.appendChild(wrapper)
        })
    })

    const resetWrapper = document.createElement("div")
    resetWrapper.className = "control"
    const resetBtn = document.createElement("button")
    resetBtn.textContent = "Reset pose"
    resetBtn.addEventListener("click", ()=>{
        resetPose()
        buildPoseControls() // vuelve a poner los sliders en 0 visualmente
    })
    resetWrapper.appendChild(resetBtn)
    container.appendChild(resetWrapper)
}

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
    /* CONTROLES DE POSE (todos los huesos/ejes disponibles) */
    /* ========================= */

    buildPoseControls()

    /* ========================= */
    /* KEYFRAMES / ANIMACIÓN / EXPORT */
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
