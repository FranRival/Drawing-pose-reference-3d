// python -m http.server

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { inspectBones } from './viewer.js'
import { initUI } from './ui.js'

export let scene
export let camera
export let renderer
export let model

const viewer = document.getElementById('viewer')

/* SCENE */
scene = new THREE.Scene()
scene.background = new THREE.Color(0x222222)

/* CAMERA */
camera = new THREE.PerspectiveCamera(
60,
viewer.clientWidth / viewer.clientHeight,
0.1,
1000
)

camera.position.set(0,1.5,3)

/* RENDERER */
renderer = new THREE.WebGLRenderer({antialias:true})
renderer.setSize(viewer.clientWidth, viewer.clientHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.physicallyCorrectLights = true
renderer.outputColorSpace = THREE.SRGBColorSpace

viewer.appendChild(renderer.domElement)

/* CONTROLS */
const controls = new OrbitControls(camera, renderer.domElement)

/* TEST CUBE */
const geometry = new THREE.BoxGeometry()
const material = new THREE.MeshStandardMaterial({color:0x00ff00})
const cube = new THREE.Mesh(geometry, material)
scene.add(cube)

/* LIGHTS */
const light1 = new THREE.DirectionalLight(0xffffff,1)
light1.position.set(5,5,5)
light1.castShadow = true
scene.add(light1)

const light2 = new THREE.AmbientLight(0xffffff,0.5)
scene.add(light2)

/* GRID */
const grid = new THREE.GridHelper(10,10)
scene.add(grid)

const axes = new THREE.AxesHelper(5)
scene.add(axes)

/* FLOOR */
const floorGeometry = new THREE.PlaneGeometry(50,50)
const floorMaterial = new THREE.MeshStandardMaterial({color:0x444444})
const floor = new THREE.Mesh(floorGeometry, floorMaterial)

floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true

scene.add(floor)

/* MODEL LOADER */
const loader = new GLTFLoader()

loader.load(
'models/mannequin.glb',

function(gltf){

model = gltf.scene
scene.add(model)

/* activar sombras en el modelo */
model.traverse((obj) => {

if(obj.isMesh){

obj.castShadow = true
obj.receiveShadow = true

}

})

/* ejecutar bone inspector */
inspectBones()

//movimiento de cabeza
initUI()

/* calcular bounding box */
const box = new THREE.Box3().setFromObject(model)
const center = box.getCenter(new THREE.Vector3())
const size = box.getSize(new THREE.Vector3())

/* centrar modelo */
model.position.sub(center)

/* ajustar cámara */
const maxDim = Math.max(size.x, size.y, size.z)

camera.position.set(0, maxDim * 1.2, maxDim * 2)

controls.target.set(0, maxDim * 0.5, 0)
controls.update()

console.log("Modelo centrado:", size)

},

function(xhr){

console.log((xhr.loaded / xhr.total * 100) + '% loaded')

},

function(error){

console.error("Error cargando modelo:", error)

}
)

/* RENDER LOOP */
function animate(){

requestAnimationFrame(animate)

cube.rotation.x += 0.01
cube.rotation.y += 0.01

renderer.render(scene,camera)

}

/* RESIZE HANDLER */
window.addEventListener("resize", () => {

camera.aspect = viewer.clientWidth / viewer.clientHeight
camera.updateProjectionMatrix()

renderer.setSize(viewer.clientWidth, viewer.clientHeight)

})

animate()
