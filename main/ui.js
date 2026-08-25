import { rotateBone, setBoneAxis, bones, resetPose, addKeyframe, clearKeyframes, deleteKeyframe, reorderKeyframes, getKeyframeCount,
         togglePlay, exportFrameSequence, exportKeyframesOnly, setGizmoOpacity, setMeshDisplayMode,
         setLoomisGuideVisible, setLoomisOffsetX, setLoomisOffsetY, setLoomisOffsetZ, setLoomisScale, setLoomisRespectOcclusion,
         setLoomisStretchX, setLoomisStretchY, setLoomisStretchZ,
         setEarRadius,
         setJawWidth, setJawChinDrop, setJawChinForward, setJawChinWidth, setSideProfileAngle,
         deselectBone,
         setOnKeyframesChange } from './viewer.js'
import { setEyeWidth, setEyeHeightRatio, setEyeGap, setEyeTilt, setEyeVerticalOffset } from './eyes.js'
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

// ✅ NUEVO: posiciona el rectángulo de "área de exportación" para que calce
// exactamente con lo que recorta captureFrameBlob() en viewer.js — mismo
// criterio en ambos lados: canvas completo menos header y footer.
// ✅ NUEVO: rectángulo de "zona segura" en los 4 lados, no solo arriba/abajo.
// Arriba/abajo excluyen exactamente el header/footer (igual que el recorte
// real de exportación). Izquierda/derecha dejan un margen de aviso — el
// canvas exporta hasta el borde real, pero si la pose cruza esta línea
// (manos, pies, etc.) es señal de que se va a cortar en la imagen final.
// ✅ NUEVO: encuadre fijo 16:9 (widescreen, estándar anime/TV) centrado en el
// espacio disponible del visor — ya no sigue la forma vertical de la
// pantalla del celular. El mismo cálculo se replica en viewer.js
// (getExportCropRect) para que la exportación coincida exactamente con lo
// que se ve dentro de este rectángulo.
const TARGET_ASPECT = 16 / 9

function updateCaptureAreaGuide(){
    const guide = document.getElementById("captureAreaGuide")
    const viewer = document.getElementById("viewer")
    const headerBar = document.getElementById("posePresetsBar")
    const footerBar = document.getElementById("poseTimelineBar")
    if(!guide || !viewer) return

    const topPx = headerBar ? headerBar.offsetHeight : 0
    const bottomPx = footerBar ? footerBar.offsetHeight : 0

    const availableWidth = viewer.clientWidth
    const availableHeight = Math.max(viewer.clientHeight - topPx - bottomPx, 1)

    let guideWidth, guideHeight
    if(availableWidth / availableHeight > TARGET_ASPECT){
        // el espacio disponible es más ancho que 16:9 → la altura manda
        guideHeight = availableHeight
        guideWidth = guideHeight * TARGET_ASPECT
    } else {
        // el espacio disponible es más angosto que 16:9 (como en celular) → el ancho manda
        guideWidth = availableWidth
        guideHeight = guideWidth / TARGET_ASPECT
    }

    const leftPx = (availableWidth - guideWidth) / 2
    const topOffset = topPx + (availableHeight - guideHeight) / 2

    guide.style.top = `${topOffset}px`
    guide.style.left = `${leftPx}px`
    guide.style.width = `${guideWidth}px`
    guide.style.height = `${guideHeight}px`
    guide.style.right = "auto"
    guide.style.bottom = "auto"
}

export function initUI(){

    updateCaptureAreaGuide()
    window.addEventListener("resize", updateCaptureAreaGuide)

    const btnReleaseBone = document.getElementById("btnReleaseBone")
    if(btnReleaseBone){
        btnReleaseBone.addEventListener("click", ()=>{
            deselectBone()
        })
    }

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

    const loomisOcclusionToggle = document.getElementById("loomisOcclusionToggle")

    if(loomisOcclusionToggle){
        loomisOcclusionToggle.addEventListener("change",(e)=>{
            setLoomisRespectOcclusion(e.target.checked)
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

    const loomisStretchXSlider = document.getElementById("loomisStretchX")
    const loomisStretchXValue  = document.getElementById("loomisStretchXValue")

    if(loomisStretchXSlider){
        loomisStretchXSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setLoomisStretchX(value)
            if(loomisStretchXValue) loomisStretchXValue.textContent = value.toFixed(2)
        })
    }

    const loomisStretchYSlider = document.getElementById("loomisStretchY")
    const loomisStretchYValue  = document.getElementById("loomisStretchYValue")

    if(loomisStretchYSlider){
        loomisStretchYSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setLoomisStretchY(value)
            if(loomisStretchYValue) loomisStretchYValue.textContent = value.toFixed(2)
        })
    }

    const loomisStretchZSlider = document.getElementById("loomisStretchZ")
    const loomisStretchZValue  = document.getElementById("loomisStretchZValue")

    if(loomisStretchZSlider){
        loomisStretchZSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setLoomisStretchZ(value)
            if(loomisStretchZValue) loomisStretchZValue.textContent = value.toFixed(2)
        })
    }

    const earRadiusSlider = document.getElementById("earRadius")
    const earRadiusValue  = document.getElementById("earRadiusValue")

    if(earRadiusSlider){
        earRadiusSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setEarRadius(value)
            if(earRadiusValue) earRadiusValue.textContent = value.toFixed(2)
        })
    }

    /* ========================= */
    /* OJOS (eyes.js) */
    /* ========================= */

    const eyeWidthSlider = document.getElementById("eyeWidth")
    const eyeWidthValue  = document.getElementById("eyeWidthValue")

    if(eyeWidthSlider){
        eyeWidthSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setEyeWidth(value)
            if(eyeWidthValue) eyeWidthValue.textContent = value.toFixed(2)
        })
    }

    const eyeHeightRatioSlider = document.getElementById("eyeHeightRatio")
    const eyeHeightRatioValue  = document.getElementById("eyeHeightRatioValue")

    if(eyeHeightRatioSlider){
        eyeHeightRatioSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setEyeHeightRatio(value)
            if(eyeHeightRatioValue) eyeHeightRatioValue.textContent = value.toFixed(2)
        })
    }

    const eyeGapSlider = document.getElementById("eyeGap")
    const eyeGapValue  = document.getElementById("eyeGapValue")

    if(eyeGapSlider){
        eyeGapSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setEyeGap(value)
            if(eyeGapValue) eyeGapValue.textContent = value.toFixed(2)
        })
    }

    const eyeTiltSlider = document.getElementById("eyeTilt")
    const eyeTiltValue  = document.getElementById("eyeTiltValue")

    if(eyeTiltSlider){
        eyeTiltSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setEyeTilt(value)
            if(eyeTiltValue) eyeTiltValue.textContent = value.toFixed(0)
        })
    }

    const eyeVerticalOffsetSlider = document.getElementById("eyeVerticalOffset")
    const eyeVerticalOffsetValue  = document.getElementById("eyeVerticalOffsetValue")

    if(eyeVerticalOffsetSlider){
        eyeVerticalOffsetSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setEyeVerticalOffset(value)
            if(eyeVerticalOffsetValue) eyeVerticalOffsetValue.textContent = value.toFixed(2)
        })
    }

    const jawWidthSlider = document.getElementById("jawWidth")
    const jawWidthValue  = document.getElementById("jawWidthValue")

    if(jawWidthSlider){
        jawWidthSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setJawWidth(value)
            if(jawWidthValue) jawWidthValue.textContent = value.toFixed(2)
        })
    }

    const jawChinDropSlider = document.getElementById("jawChinDrop")
    const jawChinDropValue  = document.getElementById("jawChinDropValue")

    if(jawChinDropSlider){
        jawChinDropSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setJawChinDrop(value)
            if(jawChinDropValue) jawChinDropValue.textContent = value.toFixed(2)
        })
    }

    const jawChinForwardSlider = document.getElementById("jawChinForward")
    const jawChinForwardValue  = document.getElementById("jawChinForwardValue")

    if(jawChinForwardSlider){
        jawChinForwardSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setJawChinForward(value)
            if(jawChinForwardValue) jawChinForwardValue.textContent = value.toFixed(2)
        })
    }

    const jawChinWidthSlider = document.getElementById("jawChinWidth")
    const jawChinWidthValue  = document.getElementById("jawChinWidthValue")

    if(jawChinWidthSlider){
        jawChinWidthSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setJawChinWidth(value)
            if(jawChinWidthValue) jawChinWidthValue.textContent = value.toFixed(2)
        })
    }

    const sideProfileAngleSlider = document.getElementById("sideProfileAngle")
    const sideProfileAngleValue  = document.getElementById("sideProfileAngleValue")

    if(sideProfileAngleSlider){
        sideProfileAngleSlider.addEventListener("input",(e)=>{
            const value = parseFloat(e.target.value)
            setSideProfileAngle(value)
            if(sideProfileAngleValue) sideProfileAngleValue.textContent = value.toFixed(0)
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
    const numberFramesCheck = document.getElementById("numberFrames")
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
            const showLabel = numberFramesCheck ? numberFramesCheck.checked : true

            btnExportSequence.disabled = true
            btnExportSequence.textContent = "Exportando..."

            await exportFrameSequence(frameCount, format, showLabel)

            btnExportSequence.disabled = false
            btnExportSequence.textContent = "Exportar secuencia completa (.zip)"
        })
    }

    if(btnExportKeyframes){
        btnExportKeyframes.addEventListener("click", async ()=>{
            const format = imgFormatSelect?.value || "png"
            const showLabel = numberFramesCheck ? numberFramesCheck.checked : true

            btnExportKeyframes.disabled = true
            btnExportKeyframes.textContent = "Exportando..."

            await exportKeyframesOnly(format, showLabel)

            btnExportKeyframes.disabled = false
            btnExportKeyframes.textContent = "Exportar solo keyframes (.zip)"
        })
    }

}
