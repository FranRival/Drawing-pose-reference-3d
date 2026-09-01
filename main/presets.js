import { setSelectedTarget, getTargetAdjust,
         setTargetOffsetX, setTargetOffsetY, setTargetScale, setTargetRotation } from './mode2d.js'

// Guardado / carga de preconfiguraciones.
//
// En vez de mantener a mano una lista de parámetros (que se desactualiza
// cada vez que agregamos un control nuevo), este módulo lee y escribe
// directamente los CONTROLES del DOM. Cualquier slider o <select> que
// agreguemos en el futuro queda cubierto automáticamente, sin tocar este
// archivo.
//
// Excepción: el "Ajuste fino por forma" (targetOffsetX/Y, targetScale,
// targetRotation) NO se guarda leyendo el DOM, porque esos 4 controles
// son dinámicos — muestran los valores de la pieza que esté seleccionada
// en ese momento. Para esos se recorre cada pieza y se guarda su ajuste
// real desde mode2d.js.

const DYNAMIC_IDS = ['targetOffsetX', 'targetOffsetY', 'targetScale', 'targetRotation']

// controles que no describen el personaje (no tiene sentido guardarlos)
const SKIP_IDS = ['mode2DTarget', 'frameCount', 'imgFormat']

function collectControls(){
    const nodes = document.querySelectorAll('input[type="range"], select')
    const out = []
    nodes.forEach(node => {
        if(!node.id) return
        if(DYNAMIC_IDS.includes(node.id)) return
        if(SKIP_IDS.includes(node.id)) return
        out.push(node)
    })
    return out
}

// lista de piezas del "Ajuste fino por forma", leída del propio <select>
// para no duplicar la lista aquí
function shapeTargetKeys(){
    const select = document.getElementById('mode2DTarget')
    if(!select) return []
    return Array.from(select.options).map(o => o.value)
}

export function buildPreset(){
    const controls = {}
    collectControls().forEach(node => {
        controls[node.id] = node.value
    })

    const shapeAdjust = {}
    shapeTargetKeys().forEach(key => {
        const adj = getTargetAdjust(key)
        if(adj){
            shapeAdjust[key] = {
                x: adj.x,
                y: adj.y,
                scale: adj.scale,
                rotationDeg: adj.rotationDeg
            }
        }
    })

    return {
        format: 'animemakerpro-preset',
        version: 1,
        savedAt: new Date().toISOString(),
        controls,
        shapeAdjust
    }
}

export function downloadPreset(filename){
    const preset = buildPreset()
    const text = JSON.stringify(preset, null, 2)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename || `personaje-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

// Aplica un valor a un control y dispara su evento, para que el módulo
// correspondiente reaccione igual que si lo hubiera movido el usuario.
function applyControl(id, value){
    const node = document.getElementById(id)
    if(!node) return false
    node.value = value
    const evtName = node.tagName === 'SELECT' ? 'change' : 'input'
    node.dispatchEvent(new Event(evtName, { bubbles: true }))
    return true
}

export function applyPreset(preset){
    if(!preset || preset.format !== 'animemakerpro-preset'){
        throw new Error('El archivo no parece una preconfiguración válida.')
    }

    let applied = 0
    let missing = 0

    // 1) controles normales
    if(preset.controls){
        Object.entries(preset.controls).forEach(([id, value]) => {
            if(applyControl(id, value)) applied++
            else missing++
        })
    }

    // 2) ajuste fino por forma — se selecciona cada pieza y se aplican sus
    // 4 valores, respetando el flujo normal de mode2d.js
    if(preset.shapeAdjust){
        const previous = document.getElementById('mode2DTarget')?.value
        Object.entries(preset.shapeAdjust).forEach(([key, adj]) => {
            setSelectedTarget(key)
            if(typeof adj.x === 'number') setTargetOffsetX(adj.x)
            if(typeof adj.y === 'number') setTargetOffsetY(adj.y)
            if(typeof adj.scale === 'number') setTargetScale(adj.scale)
            if(typeof adj.rotationDeg === 'number') setTargetRotation(adj.rotationDeg)
        })
        // se restaura la pieza que estaba seleccionada antes de cargar
        if(previous){
            setSelectedTarget(previous)
            const select = document.getElementById('mode2DTarget')
            if(select) select.value = previous
            refreshShapeSliders(previous)
        }
    }

    return { applied, missing }
}

// deja los 4 sliders dinámicos mostrando los valores de la pieza activa
function refreshShapeSliders(key){
    const adj = getTargetAdjust(key)
    if(!adj) return
    const pairs = [
        ['targetOffsetX', adj.x, 2],
        ['targetOffsetY', adj.y, 2],
        ['targetScale', adj.scale, 2],
        ['targetRotation', adj.rotationDeg, 0]
    ]
    pairs.forEach(([id, value, decimals]) => {
        const node = document.getElementById(id)
        if(node) node.value = value
        const label = document.getElementById(id + 'Value')
        if(label) label.textContent = Number(value).toFixed(decimals)
    })
}

export function loadPresetFromFile(file){
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            try {
                const preset = JSON.parse(reader.result)
                resolve(applyPreset(preset))
            } catch(err){
                reject(err)
            }
        }
        reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
        reader.readAsText(file)
    })
}
