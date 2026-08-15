// python -m http.server

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { inspectBones, initRaycasting, updateBoneHelper,
         createJointGizmos, updateJointGizmos, updateIK,
         updateAnimation, consumeNeedsUpdate, setGizmosVisible,
         createWireframeOverlay, createLoomisGuide } from './viewer.js'
import { initUI } from './ui.js'
import { SkeletonHelper } from 'three'

export let scene
export let camera
export let renderer
export let model

export let cameraFront
export let cameraSide
export let cameraTop

const orthoSize = 2
export const referenceObjects = []

export let sunLight
export let sunGizmo
export let sunArc
export let skeletonHelper

// ✅ NUEVO: encuadres de cámara preestablecidos, calculados desde la caja
// delimitadora del modelo (Box3). Un solo encuadre para toda la secuencia.
export const SHOT_LABELS = {
    general:       "Plano general",
    medio:         "Plano medio",
    primerPlano:   "Primer plano",
    cenital:       "Cenital",
    contrapicado:  "Contrapicado",
    picado:        "Picado"
}

const SHOTS = {
    general: (center, size, groundY) => ({
        position: new THREE.Vector3(center.x, groundY + size.y * 0.8, center.z + size.y * 2.0),
        target:   new THREE.Vector3(center.x, groundY + size.y * 0.5, center.z)
    }),
    medio: (center, size, groundY) => ({
        position: new THREE.Vector3(center.x, groundY + size.y * 0.75, center.z + size.y * 1.1),
        target:   new THREE.Vector3(center.x, groundY + size.y * 0.65, center.z)
    }),
    primerPlano: (center, size, groundY) => ({
        position: new THREE.Vector3(center.x, groundY + size.y * 0.92, center.z + size.y * 0.55),
        target:   new THREE.Vector3(center.x, groundY + size.y * 0.9, center.z)
    }),
    cenital: (center, size, groundY) => ({
        position: new THREE.Vector3(center.x, groundY + size.y * 2.4, center.z + size.y * 0.05),
        target:   new THREE.Vector3(center.x, groundY + size.y * 0.5, center.z)
    }),
    contrapicado: (center, size, groundY) => ({
        position: new THREE.Vector3(center.x, groundY + size.y * 0.08, center.z + size.y * 1.0),
        target:   new THREE.Vector3(center.x, groundY + size.y * 0.95, center.z)
    }),
    picado: (center, size, groundY) => ({
        position: new THREE.Vector3(center.x, groundY + size.y * 1.8, center.z + size.y * 1.2),
        target:   new THREE.Vector3(center.x, groundY + size.y * 0.35, center.z)
    })
}

function getModelBox(){
    if(!model) return null
    model.updateMatrixWorld(true)
    return new THREE.Box3().setFromObject(model)
}

// Salta la cámara (y su target de OrbitControls) al encuadre elegido.
// Después de esto, el usuario puede seguir orbitando/haciendo zoom libremente.
export function applyCameraShot(shotKey){
    if(!model || !controls) return

    const box = getModelBox()
    if(!box) return

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const groundY = box.min.y

    const preset = SHOTS[shotKey] || SHOTS.general
    const { position, target } = preset(center, size, groundY)

    camera.position.copy(position)
    controls.target.copy(target)
    controls.update()
}

// ✅ NUEVO: oculta/muestra grid, ejes, piso, gizmos del sol y esqueleto
// (usado antes de capturar frames para exportar imágenes "limpias")
export function setHelpersVisible(visible){
    referenceObjects.forEach(obj => { obj.visible = visible })
    if(sunGizmo) sunGizmo.visible = visible
    if(sunArc) sunArc.visible = visible
    if(skeletonHelper) skeletonHelper.visible = visible
    setGizmosVisible(visible)
}




cameraFront = new THREE.OrthographicCamera(
-orthoSize,
orthoSize,
orthoSize,
-orthoSize,
0.1,
100
)

cameraSide = new THREE.OrthographicCamera(
-orthoSize,
orthoSize,
orthoSize,
-orthoSize,
0.1,
100
)

cameraTop = new THREE.OrthographicCamera(
-orthoSize,
orthoSize,
orthoSize,
-orthoSize,
0.1,
100
)


// Configuración de cámaras adicionales para vistas frontales, laterales y superiores

cameraFront.position.set(0,1.5,5)
cameraFront.lookAt(0,1,0)

cameraSide.position.set(5,1.5,0)
cameraSide.lookAt(0,1,0)

cameraTop.position.set(0,6,0)
cameraTop.lookAt(0,0,0)


cameraFront.zoom = 1.5
cameraSide.zoom = 1.5
cameraTop.zoom = 1.5

cameraFront.updateProjectionMatrix()
cameraSide.updateProjectionMatrix()
cameraTop.updateProjectionMatrix()

const viewsContainer = document.getElementById("views")
const viewer = document.getElementById('viewer')

/* SCENE */
scene = new THREE.Scene()
scene.background = new THREE.Color(0x222222)

const arcRadius = 8
const arcSegments = 64

const arcGeometry = new THREE.BufferGeometry()
const arcPoints = []

for(let i=0;i<=arcSegments;i++){

const t = i/arcSegments * Math.PI

const x = Math.cos(t) * arcRadius
const y = Math.sin(t) * arcRadius
const z = 0

arcPoints.push(new THREE.Vector3(x,y,z))

}

arcGeometry.setFromPoints(arcPoints)

const arcMaterial = new THREE.LineBasicMaterial({
color:0xffff00,
transparent:true,
opacity:0.4
})

sunArc = new THREE.Line(arcGeometry, arcMaterial)

scene.add(sunArc)


const sunGeometry = new THREE.SphereGeometry(0.25, 16, 16)
const sunMaterial = new THREE.MeshBasicMaterial({color:0xffff00})

sunGizmo = new THREE.Mesh(sunGeometry, sunMaterial)
scene.add(sunGizmo)


/* CAMERA */
camera = new THREE.PerspectiveCamera(
    60,
    viewer.clientWidth / viewer.clientHeight,
    0.1,
    1000
)
camera.position.set(0, 1.5, 3)

/* RENDERER */
renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(viewer.clientWidth, viewer.clientHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace

// Crucial: Mantiene la lógica de Raycasting para SkinnedMeshes globalmente


viewer.appendChild(renderer.domElement)

/* CONTROLS */
export const controls = new OrbitControls(camera, renderer.domElement)

/* LIGHTS */
sunLight = new THREE.DirectionalLight(0xffffff, 1.2)

sunLight.position.set(5,5,5)

sunLight.castShadow = true
sunLight.shadow.mapSize.width = 2048
sunLight.shadow.mapSize.height = 2048

sunLight.shadow.camera.near = 0.5
sunLight.shadow.camera.far = 30

sunLight.shadow.camera.left = -10
sunLight.shadow.camera.right = 10
sunLight.shadow.camera.top = 10
sunLight.shadow.camera.bottom = -10

sunLight.shadow.bias = -0.0001

scene.add(sunLight)

const light2 = new THREE.AmbientLight(0xffffff, 0.5)
scene.add(light2)

/* GRID */
const grid = new THREE.GridHelper(10, 10)
scene.add(grid)

const axes = new THREE.AxesHelper(5)
scene.add(axes)

/* FLOOR */
const floorGeometry = new THREE.PlaneGeometry(50, 50)
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 })
const floor = new THREE.Mesh(floorGeometry, floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)
referenceObjects.push(grid)
referenceObjects.push(axes)
referenceObjects.push(floor)

/* MODEL LOADER */
const loader = new GLTFLoader()

loader.load(
    'models/mannequin.glb',
    function (gltf) {
        model = gltf.scene
        scene.add(model)

        console.log("====== MODEL HIERARCHY ======")
        printHierarchy(model)
        console.log("====== END HIERARCHY ======")

        window.model = model

        /* activar sombras y preparar geometría */
        model.traverse((obj) => {
            if (obj.isMesh) {
                obj.geometry.computeBoundingBox()
                obj.geometry.computeBoundingSphere()
                obj.castShadow = true
                obj.receiveShadow = true

                // Aseguramos que cada mesh use el raycast de SkinnedMesh
                if (obj.isSkinnedMesh) {
                    obj.raycast = THREE.SkinnedMesh.prototype.raycast;
                }
            }
        })


        window.skinnedMeshes = []

model.traverse((obj) => {
    if (obj.isSkinnedMesh) {
        window.skinnedMeshes.push(obj)
    }
})


console.log("SkinnedMesh detectado:", window.skinnedMeshes)



        /* inicializar lógica externa */
        inspectBones()
        createJointGizmos()
        createWireframeOverlay()
        initUI()
        initRaycasting()
        skeletonHelper = new THREE.SkeletonHelper(model)
        scene.add(skeletonHelper)

        /* POSICIONAMIENTO CORRECTO SOBRE EL GRID */
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Centramos en X y Z, pero en Y usamos el valor mínimo para que pise el suelo (0)
        model.position.x = -center.x;
        model.position.z = -center.z;
        model.position.y = -box.min.y;

        // Actualizamos matrices después del movimiento para el Raycasting
        model.updateMatrixWorld(true);

        // ✅ NUEVO: guía tipo Loomis (esfera craneal + cilindro de cuello +
        // línea central + línea de ojos), atada al hueso de la cabeza.
        // Radio aproximado: la cabeza suele medir ~1/7-1/8 de la altura total.
        createLoomisGuide(size.y * 0.085)

        /* Ajuste de Cámara y Controles: encuadre por defecto = plano general */
        applyCameraShot('general')

        updateOrthoCameras()

        console.log("Modelo posicionado correctamente sobre el grid.");
    },
    (xhr) => { console.log((xhr.loaded / xhr.total * 100) + '% loaded') },
    (error) => { console.error("Error cargando modelo:", error) }
)

function printHierarchy(object, level = 0) {
    const indent = " ".repeat(level * 2)
    console.log(indent + "↳ " + object.type + (object.name ? " | " + object.name : ""))
    for (const child of object.children) {
        printHierarchy(child, level + 1)
    }
}

function updateOrthoCameras(){

if(!model) return

const box = new THREE.Box3().setFromObject(model)
const size = box.getSize(new THREE.Vector3())
const center = box.getCenter(new THREE.Vector3())

const maxDim = Math.max(size.x, size.y, size.z)
const padding = 1.2

const half = (maxDim * padding) / 2

cameraFront.left = -half
cameraFront.right = half
cameraFront.top = half
cameraFront.bottom = -half

cameraSide.left = -half
cameraSide.right = half
cameraSide.top = half
cameraSide.bottom = -half

cameraTop.left = -half
cameraTop.right = half
cameraTop.top = half
cameraTop.bottom = -half

cameraFront.position.set(center.x, center.y, center.z + maxDim)
cameraFront.lookAt(center)

cameraSide.position.set(center.x + maxDim, center.y, center.z)
cameraSide.lookAt(center)

cameraTop.position.set(center.x, center.y + maxDim, center.z)
cameraTop.lookAt(center)

cameraFront.updateProjectionMatrix()
cameraSide.updateProjectionMatrix()
cameraTop.updateProjectionMatrix()

}

export let sunAzimuth = 0
export let sunElevation = 0.6

function updateSun(){

const radius = 8

const x = Math.cos(sunElevation) * Math.cos(sunAzimuth) * radius
const z = Math.cos(sunElevation) * Math.sin(sunAzimuth) * radius
const y = Math.sin(sunElevation) * radius

sunLight.position.set(x,y,z)

sunLight.lookAt(0,1,0)

sunGizmo.position.set(x,y,z)

sunArc.rotation.y = sunAzimuth
sunArc.position.set(0,1,0)

}

export function setSunAngles(azimuth, elevation){

sunAzimuth = azimuth

sunElevation = THREE.MathUtils.clamp(elevation, -1.2, 1.2)

}

/* RENDER LOOP */
function animate() {
    requestAnimationFrame(animate)

    const delta = 0.016
    updateAnimation(delta)

    if(consumeNeedsUpdate()){
        updateIK()
        updateBoneHelper()
        updateJointGizmos()
    }

    updateOrthoCameras()
    updateSun()
    renderer.render(scene, camera)

    views.forEach(view=>{
        referenceObjects.forEach(obj=>{ obj.visible = false })
        view.renderer.render(scene, view.camera)
        referenceObjects.forEach(obj=>{ obj.visible = true })
    })
}

/* RESIZE */
window.addEventListener("resize", () => {
    camera.aspect = viewer.clientWidth / viewer.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(viewer.clientWidth, viewer.clientHeight)
})


const views = []
//paneles de vistas
function createView(camera){

    const viewRenderer = new THREE.WebGLRenderer({antialias:true})
    viewRenderer.setSize(200,200)

    // ✅ FIX: evitar crash si el contenedor no existe
    if(viewsContainer){
        viewsContainer.appendChild(viewRenderer.domElement)
    } else {
        console.warn("⚠️ #views no existe en el HTML")
    }

    return {camera, renderer:viewRenderer}

}


export function setSunAngle(v){

    // Usamos azimuth como control principal del slider
    sunAzimuth = v

}


views.push(createView(cameraFront))
views.push(createView(cameraSide))
views.push(createView(cameraTop))

animate()
