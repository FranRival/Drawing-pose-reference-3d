import { rotateBone, setBoneAxis, bones, resetPose, addKeyframe, clearKeyframes, deleteKeyframe, reorderKeyframes, getKeyframeCount,
         togglePlay, exportFrameSequence, exportKeyframesOnly, setGizmoOpacity, setMeshDisplayMode,
         setLoomisGuideVisible, setLoomisOffsetX, setLoomisOffsetY, setLoomisOffsetZ, setLoomisScale,
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

// ✅ NUEVO: poses preestablecidas, sin categorizar (todo en una sola barra).
// Cada preset es {hueso: {eje: valor}}. Se aplica siempre partiendo de la
// pose neutra (T-pose) via resetPose(), así no se mezcla con la pose anterior.
// ⚠️ Valores de partida sin probar visualmente — hay que afinarlos a ojo
// una vez que se vean en el visor real.
const POSE_PRESETS = {
    carrera: {
        neck:        { x: 0.1,  y: 0.15 },
        leftArm:     { x: -0.9, z: 0.3 },
        rightArm:    { x: 0.9,  z: -0.3 },
        leftForeArm: { x: 1.4 },
        rightForeArm:{ x: 1.2 },
        leftUpLeg:   { x: -0.6 },
        rightUpLeg:  { x: 0.7 },
        leftLeg:     { x: 1.0 },
        rightLeg:    { x: 0.3 }
    },
    guardia: {
        neck:        { x: 0.05 },
        leftArm:     { x: -0.3, z: 0.2 },
        rightArm:    { x: -0.4, z: -0.2 },
        leftForeArm: { x: 1.8 },
        rightForeArm:{ x: 1.9 },
        leftUpLeg:   { x: -0.15 },
        rightUpLeg:  { x: 0.15 },
        leftLeg:     { x: 0.3 },
        rightLeg:    { x: 0.2 }
    },
    jab: {
        neck:        { x: 0.05, y: -0.1 },
        leftArm:     { x: -0.4, z: 0.3 },
        rightArm:    { x: 0.1, y: 0.2, z: -1.3 },
        leftForeArm: { x: 1.7 },
        rightForeArm:{ x: 0.2 },
        leftUpLeg:   { x: -0.15 },
        rightUpLeg:  { x: 0.15 },
        leftLeg:     { x: 0.3 },
        rightLeg:    { x: 0.2 }
    },
    patada: {
        neck:        { x: 0.05 },
        leftArm:     { x: -0.5, z: 0.4 },
        rightArm:    { x: -0.6, z: -0.4 },
        rightUpLeg:  { x: -1.1 },
        rightLeg:    { x: 0.2 },
        leftUpLeg:   { x: 0.1 },
        leftLeg:     { x: 0.3 }
    },
    bloqueo: {
        neck:        { x: -0.1 },
        leftArm:     { x: 0.4, y: 0.3, z: 0.6 },
        rightArm:    { x: 0.4, y: -0.3, z: -0.6 },
        leftForeArm: { x: 2.0 },
        rightForeArm:{ x: 2.0 }
    },
    grito: {
        neck:        { x: -0.3 },
        leftArm:     { x: 1.3, z: 0.3 },
        rightArm:    { x: 1.3, z: -0.3 },
        leftForeArm: { x: 0.3 },
        rightForeArm:{ x: 0.3 },
        leftUpLeg:   { x: -0.2 },
        rightUpLeg:  { x: 0.2 }
    },
    agachado: {
        neck:        { x: 0.1 },
        leftArm:     { x: -0.3, z: 0.4 },
        rightArm:    { x: -0.3, z: -0.4 },
        leftUpLeg:   { x: -0.7, y: 0.1 },
        rightUpLeg:  { x: -0.7, y: -0.1 },
        leftLeg:     { x: 1.0 },
        rightLeg:    { x: 1.0 }
    }
}

// ✅ NUEVO: aplica un preset completo, partiendo siempre de la pose neutra
function applyPosePreset(presetKey){
    const preset = POSE_PRESETS[presetKey]
    if(!preset) return

    resetPose()

    Object.entries(preset).forEach(([boneName, axes])=>{
        if(!bones[boneName]) return // el hueso no existe en este modelo
        Object.entries(axes).forEach(([axis, value])=>{
            setBoneAxis(boneName, axis, value)
        })
    })

    buildPoseControls() // refresca los sliders para que reflejen la nueva pose
}

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
            input.value = bones[group.bone].rotation[axisDef.axis] || 0

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
    /* MALLA (WIREFRAME) */
    /* ========================= */

    const meshModeSelect = document.getElementById("meshMode")

    if(meshModeSelect){
        meshModeSelect.addEventListener("change",(e)=>{
            setMeshDisplayMode(e.target.value)
        })
    }

    const loomisGuideToggle = document.getElementById("loomisGuideToggle")

    if(loomisGuideToggle){
        loomisGuideToggle.addEventListener("change",(e)=>{
            setLoomisGuideVisible(e.target.checked)
        })
    }

    const loomisOffsetXSlider = document.getElementById("loomisOffsetX")
    const loomisOffsetXValue  = document.getElementById("loomisOffsetXValue")

    if(loomisOffsetXSlider){
        loomisOffsetXSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setLoomisOffsetX(value)
            if(loomisOffsetXValue) loomisOffsetXValue.textContent = value.toFixed(2)
        })
    }

    const loomisOffsetSlider = document.getElementById("loomisOffsetY")
    const loomisOffsetYValue = document.getElementById("loomisOffsetYValue")

    if(loomisOffsetSlider){
        loomisOffsetSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setLoomisOffsetY(value)
            if(loomisOffsetYValue) loomisOffsetYValue.textContent = value.toFixed(2)
        })
    }

    const loomisOffsetZSlider = document.getElementById("loomisOffsetZ")
    const loomisOffsetZValue  = document.getElementById("loomisOffsetZValue")

    if(loomisOffsetZSlider){
        loomisOffsetZSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setLoomisOffsetZ(value)
            if(loomisOffsetZValue) loomisOffsetZValue.textContent = value.toFixed(2)
        })
    }

    const loomisScaleSlider = document.getElementById("loomisScale")
    const loomisScaleValue  = document.getElementById("loomisScaleValue")

    if(loomisScaleSlider){
        loomisScaleSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setLoomisScale(value)
            if(loomisScaleValue) loomisScaleValue.textContent = value.toFixed(2)
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

    const gizmoOpacitySlider = document.getElementById("gizmoOpacity")
    if(gizmoOpacitySlider){
        gizmoOpacitySlider.addEventListener("input",(e)=>{
            setGizmoOpacity(parseFloat(e.target.value))
        })
    }

    buildPoseControls()

    /* ========================= */
    /* POSES PREESTABLECIDAS */
    /* ========================= */

    document.querySelectorAll(".posePresetBtn").forEach(btn=>{
        btn.addEventListener("click", ()=>{
            applyPosePreset(btn.dataset.preset)
        })
    })

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
    const btnFooterSavePose = document.getElementById("btnFooterSavePose")
    const cardsContainer    = document.getElementById("keyframeCardsContainer")

    // ✅ NUEVO: dibuja las tarjetas "Pose 1", "Pose 2"... en el footer,
    // cada una con su botón de borrado individual (×) y arrastrables
    // (mouse o dedo) para reordenar la secuencia.
    let dragState = null

    function renderKeyframeCards(){
        if(!cardsContainer) return
        cardsContainer.innerHTML = ""

        const count = getKeyframeCount()
        for(let i = 0; i < count; i++){
            const card = document.createElement("div")
            card.dataset.originalIndex = i
            card.style.cssText = "display:flex; align-items:center; gap:4px; background:#333; color:#fff; padding:4px 8px; border-radius:4px; font-size:13px; touch-action:none; cursor:grab; user-select:none;"

            const label = document.createElement("span")
            label.textContent = `Pose ${i + 1}`

            const delBtn = document.createElement("button")
            delBtn.textContent = "×"
            delBtn.title = "Eliminar esta pose"
            delBtn.className = "deleteBtn"
            delBtn.style.cssText = "cursor:pointer; line-height:1;"
            delBtn.addEventListener("click", (e)=>{
                e.stopPropagation()
                deleteKeyframe(i)
            })

            card.appendChild(label)
            card.appendChild(delBtn)
            cardsContainer.appendChild(card)

            attachDragHandlers(card)
        }
    }

    // ✅ NUEVO: arrastrar una tarjeta reordena visualmente en vivo;
    // al soltar, se confirma el nuevo orden en el arreglo de keyframes.
    function attachDragHandlers(card){

        card.addEventListener("pointerdown",(e)=>{
            if(e.target.closest(".deleteBtn")) return

            dragState = { card }
            card.setPointerCapture(e.pointerId)
            card.style.opacity = "0.5"
            card.style.cursor = "grabbing"
        })

        card.addEventListener("pointermove",(e)=>{
            if(!dragState || dragState.card !== card) return

            const siblings = Array.from(cardsContainer.children)
            const overCard = siblings.find(c => {
                const rect = c.getBoundingClientRect()
                return e.clientX >= rect.left && e.clientX <= rect.right
            })

            if(overCard && overCard !== card){
                const overIndex = siblings.indexOf(overCard)
                const cardIndex = siblings.indexOf(card)
                if(overIndex < cardIndex){
                    cardsContainer.insertBefore(card, overCard)
                } else {
                    cardsContainer.insertBefore(card, overCard.nextSibling)
                }
            }
        })

        card.addEventListener("pointerup",(e)=>{
            if(!dragState || dragState.card !== card) return

            card.style.opacity = "1"
            card.style.cursor = "grab"

            const finalIndex = Array.from(cardsContainer.children).indexOf(card)
            const originalIndex = parseInt(card.dataset.originalIndex, 10)

            dragState = null

            if(finalIndex !== originalIndex){
                reorderKeyframes(originalIndex, finalIndex)
            }
        })

        card.addEventListener("pointercancel",()=>{
            if(dragState && dragState.card === card){
                card.style.opacity = "1"
                card.style.cursor = "grab"
                dragState = null
                renderKeyframeCards() // por si quedó a medio mover, restaura el orden real
            }
        })
    }

    function refreshKeyframeCount(){
        if(keyframeCountEl){
            keyframeCountEl.textContent = `${getKeyframeCount()} keyframes`
        }
        renderKeyframeCards()
    }

    setOnKeyframesChange(refreshKeyframeCount)
    refreshKeyframeCount()

    if(btnAddKeyframe){
        btnAddKeyframe.addEventListener("click", ()=>{
            addKeyframe()
        })
    }

    if(btnFooterSavePose){
        btnFooterSavePose.addEventListener("click", ()=>{
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
